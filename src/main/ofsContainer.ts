// Copyright (c) 2026 quietsource. Licensed under the MIT License; see LICENSE.
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflateAsync = promisify(zlib.deflateRaw);
const inflateAsync = promisify(zlib.inflateRaw);

// ============================================================================
// CONSTANTS & BINARY SIGNATURES
// ============================================================================

const HEADER_MAGIC = Buffer.from('OFS\x01', 'ascii');
const FOOTER_MAGIC = Buffer.from('OFS_EOF\x00', 'ascii');
const HEADER_SIZE = 64;
const FOOTER_SIZE = 64;

export enum CompressionCodec {
  NONE = 0,
  DEFLATE = 1, // Built-in fast LZ77 + Huffman
}

// Automatically skip compression on pre-compressed media/archives for write speed
const INCOMPRESSIBLE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mkv', '.mp3',
  '.zip', '.gz', '.zst', '.br', '.7z', '.woff2', '.pdf'
]);

// ============================================================================
// DATA INTERFACES
// ============================================================================

export interface OFSVersionRecord {
  version: number;          // 1-based sequential version number
  timestampNs: bigint;      // High-resolution creation timestamp
  offset: bigint;           // Physical byte offset in the .ofs file
  compressedSize: number;   // Stored byte length on disk
  uncompressedSize: number; // Original byte length
  codec: CompressionCodec;  // Compression algorithm used
  crc32: number;            // Fast hardware-accelerated integrity checksum
  sha256: Uint8Array;       // 32-byte content hash for O(1) deduplication
  isTombstone: boolean;     // True if this version marks a logical deletion
  metadata?: Record<string, string>;
}

export interface OFSFileStat {
  path: string;
  latestVersion: number;
  totalVersions: number;
  latestSize: number;
  compressedSize: number;
  updatedAtNs: bigint;
  isDeleted: boolean;
}

export interface OFSContainerStats {
  fileSize: number;
  generationId: bigint;
  totalFiles: number;
  totalVersions: number;
  uniqueContentBlocks: number;
  wastedBytes: bigint;
  fragmentationRatio: number;
}

interface ContentBlockPointer {
  offset: bigint;
  compressedSize: number;
  uncompressedSize: number;
  codec: CompressionCodec;
  crc32: number;
}

// ============================================================================
// FAST CRC32 IMPLEMENTATION (Precomputed Lookup Table)
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC32_TABLE[(crc ^ buf[i]!) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================================
// CORE ORIONFS CONTAINER (.OFS) ENGINE
// ============================================================================

export class OFSContainer {
  private handle!: fs.FileHandle;
  private filePath: string;
  private readOnly: boolean;

  // In-Memory O(1) Lookups
  private index: Map<string, OFSVersionRecord[]> = new Map();
  // Content-Addressable Store Map: Hex(SHA-256) -> Physical Disk Pointer
  private casMap: Map<string, ContentBlockPointer> = new Map();

  // Container State
  private containerUuid: Uint8Array = new Uint8Array(16);
  private createdAtNs: bigint = 0n;
  private generationId: bigint = 0n;
  private writeCursor: bigint = BigInt(HEADER_SIZE);
  private lastIndexBytes: bigint = 0n;
  private wastedBytes: bigint = 0n;
  private dirty: boolean = false;

  private constructor(filePath: string, readOnly: boolean) {
    this.filePath = filePath;
    this.readOnly = readOnly;
  }

  /**
   * Opens an existing .ofs container or creates a brand new one.
   */
  public static async open(
    filePath: string,
    options: { readOnly?: boolean; createIfMissing?: boolean } = {}
  ): Promise<OFSContainer> {
    const readOnly = options.readOnly ?? false;
    const createIfMissing = options.createIfMissing ?? !readOnly;
    const container = new OFSContainer(filePath, readOnly);

    try {
      const flags = readOnly ? 'r' : 'r+';
      container.handle = await fs.open(filePath, flags);
      await container.loadExistingContainer();
    } catch (err: any) {
      if (err.code === 'ENOENT' && createIfMissing && !readOnly) {
        container.handle = await fs.open(filePath, 'w+');
        await container.initializeNewContainer();
      } else {
        throw err;
      }
    }

    return container;
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION & BOOTSTRAPPING
  // --------------------------------------------------------------------------

  private async initializeNewContainer(): Promise<void> {
    this.containerUuid = crypto.randomBytes(16);
    this.createdAtNs = BigInt(Date.now()) * 1_000_000n;
    this.generationId = 1n;
    this.writeCursor = BigInt(HEADER_SIZE);

    const headerBuf = this.serializeHeader();
    await this.writeAll(headerBuf, 0);
    await this.commit();
  }

  private async loadExistingContainer(): Promise<void> {
    const stat = await this.handle.stat();
    if (stat.size < HEADER_SIZE + FOOTER_SIZE) {
      throw new Error(`Invalid .ofs file: File smaller than minimum 128 bytes.`);
    }

    // 1. Read and validate the stable superblock.
    const headerBuf = Buffer.allocUnsafe(HEADER_SIZE);
    await this.handle.read(headerBuf, 0, HEADER_SIZE, 0);

    // Validate Header Magic
    if (!headerBuf.subarray(0, 4).equals(HEADER_MAGIC)) {
      throw new Error(`Invalid .ofs header magic.`);
    }
    this.containerUuid = Uint8Array.from(headerBuf.subarray(16, 32));
    this.createdAtNs = headerBuf.readBigUInt64LE(32);

    const tryFooter = async (footerOffset: number) => {
      if (footerOffset < HEADER_SIZE || footerOffset + FOOTER_SIZE > stat.size) return null;
      const footer = Buffer.allocUnsafe(FOOTER_SIZE);
      await this.handle.read(footer, 0, FOOTER_SIZE, footerOffset);
      if (!footer.subarray(56, 64).equals(FOOTER_MAGIC) || crc32(footer.subarray(0, 52)) !== footer.readUInt32LE(52)) return null;
      const indexOffset = footer.readBigUInt64LE(0);
      const compSize = footer.readBigUInt64LE(8);
      const rawSize = footer.readBigUInt64LE(16);
      if (indexOffset < BigInt(HEADER_SIZE) || indexOffset + compSize !== BigInt(footerOffset) || compSize > BigInt(Number.MAX_SAFE_INTEGER) || rawSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      const compressedIndex = Buffer.allocUnsafe(Number(compSize));
      await this.handle.read(compressedIndex, 0, compressedIndex.byteLength, Number(indexOffset));
      if (crc32(compressedIndex) !== footer.readUInt32LE(48)) return null;
      return { footer, footerOffset, indexOffset, compSize: Number(compSize), rawSize: Number(rawSize), compressedIndex };
    };

    // Most opens use the final footer. If the process died during an append,
    // scan backward for the previous fully committed generation and discard
    // only the incomplete tail when opening writable.
    let committed = await tryFooter(stat.size - FOOTER_SIZE);
    if (!committed) {
      const scanBytes = 64 * 1024;
      let end = stat.size;
      while (end > HEADER_SIZE && !committed) {
        const start = Math.max(HEADER_SIZE, end - scanBytes);
        const window = Buffer.allocUnsafe(end - start);
        await this.handle.read(window, 0, window.byteLength, start);
        let found = window.lastIndexOf(FOOTER_MAGIC);
        while (found >= 0 && !committed) {
          const magicOffset = start + found;
          const candidateOffset = magicOffset - 56;
          committed = await tryFooter(candidateOffset);
          found = window.lastIndexOf(FOOTER_MAGIC, found - 1);
        }
        if (start === HEADER_SIZE) break;
        end = start + FOOTER_MAGIC.length - 1;
      }
    }
    if (!committed) throw new Error('No intact .ofs commit footer was found; the encrypted snapshot has been preserved.');

    const { footer, footerOffset, indexOffset, compSize: indexCompSize, rawSize: indexRawSize, compressedIndex } = committed;
    this.generationId = footer.readBigUInt64LE(24);
    this.wastedBytes = footer.readBigUInt64LE(40);

    const rawIndex =
      indexCompSize === indexRawSize
        ? compressedIndex
        : await inflateAsync(compressedIndex);

    this.deserializeIndex(rawIndex);

    // Preserve committed generations; append new payload and index bytes after the
    // current footer so an interrupted write leaves the old generation recoverable.
    this.lastIndexBytes = BigInt(indexCompSize + FOOTER_SIZE);
    this.writeCursor = BigInt(footerOffset + FOOTER_SIZE);
    if (!this.readOnly && footerOffset + FOOTER_SIZE !== stat.size) {
      await this.handle.truncate(footerOffset + FOOTER_SIZE);
      await this.handle.datasync();
    }
  }

  // --------------------------------------------------------------------------
  // BLAZING FAST WRITE & VERSIONING API
  // --------------------------------------------------------------------------

  /**
   * Writes a file into the container. Automatically creates a new version if the
   * path already exists, and deduplicates physical storage via SHA-256 CAS.
   */
  public async put(
    logicalPath: string,
    data: Uint8Array | Buffer | string,
    options: { compress?: boolean; metadata?: Record<string, string> } = {}
  ): Promise<OFSVersionRecord> {
    if (this.readOnly) throw new Error(`Container is opened in read-only mode.`);

    const normalizedPath = this.normalizePath(logicalPath);
    const rawBuffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
    const uncompressedSize = rawBuffer.byteLength;

    // 1. Compute SHA-256 for Content-Addressable Deduplication
    const sha256 = crypto.createHash('sha256').update(rawBuffer).digest();
    const shaHex = sha256.toString('hex');

    let blockPtr = this.casMap.get(shaHex);

    // 2. Only write to disk if this exact payload does not already exist in the container!
    if (!blockPtr) {
      const shouldCompress =
        options.compress ?? this.shouldCompressFile(normalizedPath, uncompressedSize);

      let payloadToWrite: Buffer = rawBuffer;
      let codec = CompressionCodec.NONE;

      if (shouldCompress) {
        const compressed = await deflateAsync(rawBuffer, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
        // Only keep compressed payload if it actually saves disk space
        if (compressed.byteLength < uncompressedSize) {
          payloadToWrite = compressed;
          codec = CompressionCodec.DEFLATE;
        }
      }

      const blockCrc = crc32(payloadToWrite);
      const offset = this.writeCursor;

      // Positional append to Data Arena
      await this.writeAll(payloadToWrite, Number(offset));

      this.writeCursor += BigInt(payloadToWrite.byteLength);

      blockPtr = {
        offset,
        compressedSize: payloadToWrite.byteLength,
        uncompressedSize,
        codec,
        crc32: blockCrc,
      };
      this.casMap.set(shaHex, blockPtr);
    }

    // 3. Append New Version Record to In-Memory History
    const history = this.index.get(normalizedPath) ?? [];
    const nextVersion = history.length > 0 ? history[history.length - 1]!.version + 1 : 1;

    const record: OFSVersionRecord = {
      version: nextVersion,
      timestampNs: BigInt(Date.now()) * 1_000_000n,
      offset: blockPtr.offset,
      compressedSize: blockPtr.compressedSize,
      uncompressedSize: blockPtr.uncompressedSize,
      codec: blockPtr.codec,
      crc32: blockPtr.crc32,
      sha256: new Uint8Array(sha256),
      isTombstone: false,
      metadata: options.metadata,
    };

    history.push(record);
    this.index.set(normalizedPath, history);
    this.dirty = true;

    return record;
  }

  /**
   * High-speed batch insertion: writes multiple files before a single index commit.
   */
  public async putBatch(
    entries: Array<{ path: string; data: Uint8Array | Buffer | string; metadata?: Record<string, string> }>
  ): Promise<OFSVersionRecord[]> {
    const results: OFSVersionRecord[] = [];
    for (const entry of entries) {
      results.push(await this.put(entry.path, entry.data, { metadata: entry.metadata }));
    }
    await this.commit();
    return results;
  }

  /**
   * Soft-deletes a file by appending a 0-byte Tombstone version record.
   * Historical versions remain intact and queryable.
   */
  public delete(logicalPath: string): OFSVersionRecord {
    if (this.readOnly) throw new Error(`Container is opened in read-only mode.`);
    const normalizedPath = this.normalizePath(logicalPath);
    const history = this.index.get(normalizedPath);

    if (!history || history.length === 0) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    const nextVersion = history[history.length - 1]!.version + 1;
    const tombstone: OFSVersionRecord = {
      version: nextVersion,
      timestampNs: BigInt(Date.now()) * 1_000_000n,
      offset: 0n,
      compressedSize: 0,
      uncompressedSize: 0,
      codec: CompressionCodec.NONE,
      crc32: 0,
      sha256: new Uint8Array(32),
      isTombstone: true,
    };

    history.push(tombstone);
    this.dirty = true;
    return tombstone;
  }

  // --------------------------------------------------------------------------
  // O(1) POSITIONAL READS & VERSION TIME-TRAVEL
  // --------------------------------------------------------------------------

  /**
   * Reads a file in O(1) time by seeking directly to its physical byte offset.
   * Optional `version` parameter enables instant time-travel to any past state.
   */
  public async get(
    logicalPath: string,
    options: { version?: number; verifyChecksum?: boolean } = {}
  ): Promise<Buffer> {
    const record = this.getRecord(logicalPath, options.version);

    if (record.isTombstone) {
      throw new Error(
        `File "${logicalPath}" (v${record.version}) is marked as deleted (Tombstone).`
      );
    }

    if (record.uncompressedSize === 0) {
      return Buffer.alloc(0);
    }

    // Single positional syscall read (`pread`) - safe for concurrent parallel reads!
    const diskBuf = Buffer.allocUnsafe(record.compressedSize);
    const { bytesRead } = await this.handle.read(
      diskBuf,
      0,
      record.compressedSize,
      Number(record.offset)
    );

    if (bytesRead !== record.compressedSize) {
      throw new Error(`Unexpected EOF while reading block at offset ${record.offset}`);
    }

    if (options.verifyChecksum ?? true) {
      const actualCrc = crc32(diskBuf);
      if (actualCrc !== record.crc32) {
        throw new Error(
          `Data corruption detected in "${logicalPath}" v${record.version}: CRC32 mismatch.`
        );
      }
    }

    const output = record.codec === CompressionCodec.DEFLATE ? await inflateAsync(diskBuf) : diskBuf;
    const actualHash = crypto.createHash('sha256').update(output).digest();
    if (!actualHash.equals(Buffer.from(record.sha256))) throw new Error(`Data corruption detected in "${logicalPath}" v${record.version}: SHA-256 mismatch.`);
    if (output.byteLength !== record.uncompressedSize) throw new Error(`Data corruption detected in "${logicalPath}" v${record.version}: size mismatch.`);
    return output;
  }

  /**
   * Returns full version history metadata for a specific file path in O(1) memory time.
   */
  public getHistory(logicalPath: string): ReadonlyArray<OFSVersionRecord> {
    const normalizedPath = this.normalizePath(logicalPath);
    const history = this.index.get(normalizedPath);
    if (!history) throw new Error(`File not found: ${normalizedPath}`);
    return history;
  }

  /**
   * Lists all files currently tracked in the container.
   */
  public listFiles(options: { includeDeleted?: boolean; prefix?: string } = {}): OFSFileStat[] {
    const results: OFSFileStat[] = [];
    const prefix = options.prefix ? this.normalizePath(options.prefix) : '';

    for (const [path, history] of this.index.entries()) {
      if (prefix && !path.startsWith(prefix)) continue;
      const latest = history[history.length - 1];
      if (!latest) continue;
      if (latest.isTombstone && !options.includeDeleted) continue;

      results.push({
        path,
        latestVersion: latest.version,
        totalVersions: history.length,
        latestSize: latest.uncompressedSize,
        compressedSize: latest.compressedSize,
        updatedAtNs: latest.timestampNs,
        isDeleted: latest.isTombstone,
      });
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // ATOMIC COMMIT, COMPACTION (VACUUM) & LIFECYCLE
  // --------------------------------------------------------------------------

  /**
   * Flushes the in-memory Versioned Index Table and Master Tail Footer to disk.
   */
  public async commit(): Promise<void> {
    if (this.readOnly || (!this.dirty && this.generationId > 1n)) return;

    const rawIndex = this.serializeIndex();
    const compressedIndex = await deflateAsync(rawIndex);
    const indexCrc = crc32(compressedIndex);

    const indexOffset = this.writeCursor;
    const nextWastedBytes = this.wastedBytes + this.lastIndexBytes;
    const footerBuf = this.serializeFooter(
      indexOffset,
      BigInt(compressedIndex.byteLength),
      BigInt(rawIndex.byteLength),
      indexCrc,
      this.generationId + 1n,
      nextWastedBytes
    );

    // Combine Index + Footer into a single sequential write operation
    const commitPayload = Buffer.concat([compressedIndex, footerBuf]);
    await this.writeAll(commitPayload, Number(indexOffset));

    // Truncate any leftover tail bytes if the new index is smaller than a previous index
    await this.handle.truncate(Number(indexOffset) + commitPayload.byteLength);
    await this.handle.datasync();

    this.generationId += 1n;
    this.wastedBytes = nextWastedBytes;
    this.lastIndexBytes = BigInt(compressedIndex.byteLength + FOOTER_SIZE);
    this.dirty = false;
  }

  /**
   * Vacuum / Compaction: Prunes old versions (keeping `keepVersions` most recent)
   * and rewrites only live, referenced blocks to a fresh container, reclaiming 100% of dead space.
   */
  public async compact(options: { keepVersions?: number; dropDeleted?: boolean } = {}): Promise<void> {
    if (this.readOnly) throw new Error(`Cannot compact a read-only container.`);
    const keepVersions = options.keepVersions ?? Infinity;
    const dropDeleted = options.dropDeleted ?? true;

    const tempPath = `${this.filePath}.compact.tmp`;
    const tempContainer = await OFSContainer.open(tempPath, { createIfMissing: true });

    const newCasMap = new Map<string, ContentBlockPointer>();
    const newIndex = new Map<string, OFSVersionRecord[]>();

    for (const [path, history] of this.index.entries()) {
      const latest = history[history.length - 1];
      if (!latest) continue;
      if (latest.isTombstone && dropDeleted) continue;

      const slicedHistory = history.slice(-keepVersions);
      const migratedHistory: OFSVersionRecord[] = [];

      for (let i = 0; i < slicedHistory.length; i++) {
        const rec = slicedHistory[i];
        if (!rec) continue;
        if (rec.isTombstone) {
          migratedHistory.push({ ...rec, version: i + 1 });
          continue;
        }

        const shaHex = Buffer.from(rec.sha256).toString('hex');
        let ptr = newCasMap.get(shaHex);

        if (!ptr) {
          // Copy compressed block directly without decompressing/recompressing!
          const rawBlock = Buffer.allocUnsafe(rec.compressedSize);
          await this.handle.read(rawBlock, 0, rec.compressedSize, Number(rec.offset));

          const newOffset = tempContainer.writeCursor;
          await tempContainer.writeAll(rawBlock, Number(newOffset));
          tempContainer.writeCursor += BigInt(rawBlock.byteLength);

          ptr = {
            offset: newOffset,
            compressedSize: rec.compressedSize,
            uncompressedSize: rec.uncompressedSize,
            codec: rec.codec,
            crc32: rec.crc32,
          };
          newCasMap.set(shaHex, ptr);
        }

        migratedHistory.push({
          ...rec,
          version: i + 1,
          offset: ptr.offset,
        });
      }

      if (migratedHistory.length > 0) {
        newIndex.set(path, migratedHistory);
      }
    }

    tempContainer.index = newIndex;
    tempContainer.casMap = newCasMap;
    tempContainer.wastedBytes = 0n;
    tempContainer.dirty = true;

    await tempContainer.commit();
    await tempContainer.close();
    await this.handle.close();

    // Atomic file replacement
    await fs.rename(tempPath, this.filePath);
    this.handle = await fs.open(this.filePath, 'r+');
    await this.loadExistingContainer();
  }

  public async stats(): Promise<OFSContainerStats> {
    const fileStat = await this.handle.stat();
    let totalVersions = 0;
    for (const history of this.index.values()) {
      totalVersions += history.length;
    }

    return {
      fileSize: fileStat.size,
      generationId: this.generationId,
      totalFiles: this.index.size,
      totalVersions,
      uniqueContentBlocks: this.casMap.size,
      wastedBytes: this.wastedBytes,
      fragmentationRatio: fileStat.size > 0 ? Number(this.wastedBytes) / fileStat.size : 0,
    };
  }

  public async close(): Promise<void> {
    if (this.dirty && !this.readOnly) {
      await this.commit();
    }
    await this.handle.close();
  }

  // --------------------------------------------------------------------------
  // BINARY SERIALIZATION & DESERIALIZATION HELPERS
  // --------------------------------------------------------------------------

  private serializeHeader(): Buffer {
    const buf = Buffer.alloc(HEADER_SIZE, 0);
    HEADER_MAGIC.copy(buf, 0);
    buf.writeUInt16LE(1, 4); // Major v1
    buf.writeUInt16LE(0, 6); // Minor v0
    buf.writeUInt32LE(1, 8); // Flags: Compressed Index
    buf.writeUInt32LE(4 * 1024 * 1024, 12); // Default 4MB chunk alignment hint
    Buffer.from(this.containerUuid).copy(buf, 16);
    buf.writeBigUInt64LE(this.createdAtNs, 32);
    return buf;
  }

  private serializeFooter(
    indexOffset: bigint,
    indexCompSize: bigint,
    indexRawSize: bigint,
    indexCrc: number,
    generationId: bigint,
    wastedBytes: bigint
  ): Buffer {
    const buf = Buffer.alloc(FOOTER_SIZE, 0);
    buf.writeBigUInt64LE(indexOffset, 0);
    buf.writeBigUInt64LE(indexCompSize, 8);
    buf.writeBigUInt64LE(indexRawSize, 16);
    buf.writeBigUInt64LE(generationId, 24);
    buf.writeBigUInt64LE(BigInt(this.index.size), 32);
    buf.writeBigUInt64LE(wastedBytes, 40);
    buf.writeUInt32LE(indexCrc, 48);

    const footerCrc = crc32(buf.subarray(0, 52));
    buf.writeUInt32LE(footerCrc, 52);
    FOOTER_MAGIC.copy(buf, 56);
    return buf;
  }

  private async writeAll(buffer: Buffer, position: number): Promise<void> {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesWritten } = await this.handle.write(buffer, offset, buffer.byteLength - offset, position + offset);
      if (bytesWritten <= 0) throw new Error('Could not finish writing the .ofs container.');
      offset += bytesWritten;
    }
  }

  /**
   * Tightly packs the entire file tree and version history into a contiguous binary buffer.
   */
  private serializeIndex(): Buffer {
    const chunks: Buffer[] = [];
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(this.index.size, 0);
    chunks.push(header);

    for (const [path, history] of this.index.entries()) {
      const pathBytes = Buffer.from(path, 'utf-8');
      const entryHeader = Buffer.allocUnsafe(6);
      entryHeader.writeUInt16LE(pathBytes.byteLength, 0);
      entryHeader.writeUInt32LE(history.length, 2);
      chunks.push(entryHeader, pathBytes);

      for (const rec of history) {
        const metaBytes = rec.metadata
          ? Buffer.from(JSON.stringify(rec.metadata), 'utf-8')
          : Buffer.alloc(0);

        // Fixed 70 bytes per version record + variable metadata length
        const vBuf = Buffer.allocUnsafe(70);
        vBuf.writeUInt32LE(rec.version, 0);
        vBuf.writeBigUInt64LE(rec.timestampNs, 4);
        vBuf.writeBigUInt64LE(rec.offset, 12);
        vBuf.writeUInt32LE(rec.compressedSize, 20);
        vBuf.writeUInt32LE(rec.uncompressedSize, 24);
        vBuf.writeUInt8(rec.codec, 28);
        vBuf.writeUInt8(rec.isTombstone ? 1 : 0, 29);
        vBuf.writeUInt32LE(rec.crc32, 30);
        Buffer.from(rec.sha256).copy(vBuf, 34); // 32 bytes (34..66)
        vBuf.writeUInt32LE(metaBytes.byteLength, 66);

        chunks.push(vBuf);
        if (metaBytes.byteLength > 0) chunks.push(metaBytes);
      }
    }

    return Buffer.concat(chunks);
  }

  private deserializeIndex(buf: Buffer): void {
    this.index.clear();
    this.casMap.clear();

    let offset = 0;
    const totalFiles = buf.readUInt32LE(offset);
    offset += 4;

    for (let i = 0; i < totalFiles; i++) {
      const pathLen = buf.readUInt16LE(offset);
      const versionCount = buf.readUInt32LE(offset + 2);
      offset += 6;

      const path = buf.subarray(offset, offset + pathLen).toString('utf-8');
      offset += pathLen;

      const history: OFSVersionRecord[] = [];
      for (let v = 0; v < versionCount; v++) {
        const version = buf.readUInt32LE(offset);
        const timestampNs = buf.readBigUInt64LE(offset + 4);
        const blockOffset = buf.readBigUInt64LE(offset + 12);
        const compressedSize = buf.readUInt32LE(offset + 20);
        const uncompressedSize = buf.readUInt32LE(offset + 24);
        const codec = buf.readUInt8(offset + 28) as CompressionCodec;
        const isTombstone = buf.readUInt8(offset + 29) === 1;
        const blockCrc = buf.readUInt32LE(offset + 30);
        const sha256 = Uint8Array.from(buf.subarray(offset + 34, offset + 66));
        const metaLen = buf.readUInt32LE(offset + 66);
        offset += 70;

        let metadata: Record<string, string> | undefined;
        if (metaLen > 0) {
          metadata = JSON.parse(buf.subarray(offset, offset + metaLen).toString('utf-8'));
          offset += metaLen;
        }

        const record: OFSVersionRecord = {
          version,
          timestampNs,
          offset: blockOffset,
          compressedSize,
          uncompressedSize,
          codec,
          crc32: blockCrc,
          sha256,
          isTombstone,
          metadata,
        };
        history.push(record);

        if (!isTombstone && uncompressedSize > 0) {
          const shaHex = Buffer.from(sha256).toString('hex');
          this.casMap.set(shaHex, {
            offset: blockOffset,
            compressedSize,
            uncompressedSize,
            codec,
            crc32: blockCrc,
          });
        }
      }

      this.index.set(path, history);
    }
  }

  private getRecord(logicalPath: string, version?: number): OFSVersionRecord {
    const normalizedPath = this.normalizePath(logicalPath);
    const history = this.index.get(normalizedPath);
    if (!history || history.length === 0) {
      throw new Error(`File not found in .ofs container: "${normalizedPath}"`);
    }

    if (version === undefined) {
      return history[history.length - 1]!;
    }

    // Binary search for the requested version (versions are strictly increasing)
    let low = 0;
    let high = history.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const record = history[mid];
      if (!record) break;
      const midVer = record.version;
      if (midVer === version) return record;
      if (midVer < version) low = mid + 1;
      else high = mid - 1;
    }

    throw new Error(`Version ${version} not found for file "${normalizedPath}"`);
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private shouldCompressFile(path: string, byteLength: number): boolean {
    if (byteLength < 64) return false; // Too small to benefit from compression headers
    const dotIdx = path.lastIndexOf('.');
    if (dotIdx === -1) return true;
    const ext = path.slice(dotIdx).toLowerCase();
    return !INCOMPRESSIBLE_EXT.has(ext);
  }
}
