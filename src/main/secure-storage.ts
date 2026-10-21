import { app, nativeCall } from '../platform/nativeHost';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateRaw, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { OFSContainer } from './ofsContainer';

const DATA_MAGIC = Buffer.from('ORIONENC1');
const KEY_MAGIC = Buffer.from('ORIONKEY1');
const SQLITE_ARCHIVE_MAGIC = Buffer.from('OFSSNAP1');
const OFS_FILE_MAGIC = Buffer.from('ORIONOFS1');
const OFS_CONTAINER_MAGIC = Buffer.from('OFS\x01', 'ascii');
const OFS_CHUNK_BYTES = 1024 * 1024;
const deflate = promisify(deflateRaw), inflate = promisify(inflateRaw);
let ofsBenchmarkReported = false;
let dataKey: Buffer | null = null;

async function writeAtomic(file: string, data: Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function initializeSecureStorage(root: string) {
  await fs.mkdir(root, { recursive: true });
  const encoded = await nativeCall<string>('storage-key', { root });
  dataKey = Buffer.from(encoded, 'base64');
  if(dataKey.length !== 32)throw Error('The native Orion storage key is invalid.');
}

function key() {
  if (!dataKey) throw new Error('Orion encrypted storage has not been initialized.');
  return dataKey;
}

export function encryptBytes(plaintext: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([DATA_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBytes(envelope: Buffer) {
  if (envelope.length < DATA_MAGIC.length + 28 || !envelope.subarray(0, DATA_MAGIC.length).equals(DATA_MAGIC)) throw new Error('Encrypted Orion data is damaged or has an unsupported format.');
  const ivStart = DATA_MAGIC.length;
  const tagStart = ivStart + 12;
  const payloadStart = tagStart + 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), envelope.subarray(ivStart, tagStart));
  decipher.setAuthTag(envelope.subarray(tagStart, payloadStart));
  return Buffer.concat([decipher.update(envelope.subarray(payloadStart)), decipher.final()]);
}

export async function readEncryptedText(file: string) {
  let contents: Buffer;
  try { contents = await fs.readFile(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error; throw error; }
  if (contents.subarray(0, DATA_MAGIC.length).equals(DATA_MAGIC)) return decryptBytes(contents).toString('utf8');
  const legacy = contents.toString('utf8');
  await writeEncryptedText(file, legacy);
  return legacy;
}

export async function writeEncryptedText(file: string, plaintext: string) {
  await writeAtomic(file, encryptBytes(Buffer.from(plaintext, 'utf8')));
}

export async function openEncryptedDatabase(encryptedFile: string, workingFile: string) {
  await fs.mkdir(path.dirname(workingFile), { recursive: true });
  const exists = await fs.access(workingFile).then(() => true, () => false);
  if (exists) return; // Recover a database left by an interrupted shutdown; it will be sealed after use.
  try {
    const archive = decryptBytes(await fs.readFile(encryptedFile));
    if (archive.subarray(0, SQLITE_ARCHIVE_MAGIC.length).equals(SQLITE_ARCHIVE_MAGIC)) {
      const manifestLength = archive.readUInt32BE(SQLITE_ARCHIVE_MAGIC.length);
      const manifestStart = SQLITE_ARCHIVE_MAGIC.length + 4;
      const entries = JSON.parse(archive.subarray(manifestStart, manifestStart + manifestLength).toString('utf8')) as Array<{ name: string; size: number }>;
      let offset = manifestStart + manifestLength;
      for (const entry of entries) {
        if (!['', '-wal', '-shm'].includes(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || offset + entry.size > archive.length) throw new Error('The encrypted OrionFS snapshot is invalid.');
        await writeAtomic(`${workingFile}${entry.name}`, archive.subarray(offset, offset + entry.size));
        offset += entry.size;
      }
      if (offset !== archive.length || !entries.some(entry => entry.name === '')) throw new Error('The encrypted OrionFS snapshot is incomplete.');
    } else {
      // Read the early encrypted snapshot format for forward compatibility.
      await writeAtomic(workingFile, archive);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

export async function sealEncryptedDatabase(encryptedFile: string, workingFile: string) {
  const entries: Array<{ name: string; size: number }> = [];
  const chunks: Buffer[] = [];
  for (const name of ['', '-wal', '-shm']) {
    const data = await fs.readFile(`${workingFile}${name}`).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (data) { entries.push({ name, size: data.length }); chunks.push(data); }
  }
  if (!entries.some(entry => entry.name === '')) return;
  const manifest = Buffer.from(JSON.stringify(entries));
  const header = Buffer.alloc(SQLITE_ARCHIVE_MAGIC.length + 4);
  SQLITE_ARCHIVE_MAGIC.copy(header);
  header.writeUInt32BE(manifest.length, SQLITE_ARCHIVE_MAGIC.length);
  await writeAtomic(encryptedFile, encryptBytes(Buffer.concat([header, manifest, ...chunks])));
  await Promise.all(['', '-wal', '-shm'].map(suffix => fs.rm(`${workingFile}${suffix}`, { force: true })));
}

type OFSSnapshotManifest = { version: 1; chunkBytes: number; files: Array<{ name: ''|'-wal'|'-shm'; size: number; chunks: number; sha256: string }> };
const ofsSuffix = (name: OFSSnapshotManifest['files'][number]['name']) => name === '' ? 'main' : name.slice(1);
const ofsChunkName = (name: string, index: number) => `snapshot/${name}/chunk-${String(index).padStart(8, '0')}`;

async function restoreOFSContainer(payload: Buffer, workingFile: string) {
  const containerPath = `${workingFile}.container.tmp`;
  await writeAtomic(containerPath, payload);
  const container = await OFSContainer.open(containerPath, { readOnly: true });
  try {
    const manifestBytes = await container.get('snapshot/manifest.json');
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as OFSSnapshotManifest;
    if (manifest.version !== 1 || manifest.chunkBytes !== OFS_CHUNK_BYTES || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 3) throw Error('Unsupported encrypted OrionFS snapshot manifest.');
    let hasMain = false;
    // SQLite rebuilds these transient coordination files. Never let a stale
    // WAL or shared-memory file from an interrupted session contaminate restore.
    await Promise.all(['-wal', '-shm'].map(suffix => fs.rm(`${workingFile}${suffix}`, { force: true })));
    for (const entry of manifest.files) {
      if (!['', '-wal', '-shm'].includes(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.chunks) || entry.chunks < 0 || entry.chunks !== Math.ceil(entry.size / OFS_CHUNK_BYTES)) throw Error('An OrionFS snapshot entry is invalid.');
      const pieces = await Promise.all(Array.from(
        { length: entry.chunks },
        (_, index) => container.get(ofsChunkName(ofsSuffix(entry.name), index)),
      ));
      const data = Buffer.concat(pieces);
      if (data.length !== entry.size || crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) throw Error('An OrionFS snapshot failed its integrity check.');
      await writeAtomic(`${workingFile}${entry.name}`, data);
      if (entry.name === '') hasMain = true;
    }
    if (!hasMain) throw Error('The encrypted OrionFS container has no database snapshot.');
  } finally {
    await container.close();
    await fs.rm(containerPath, { force: true });
  }
}

async function readLegacyVersionedSnapshot(payload: Buffer, workingFile: string) {
  const manifestLength = payload.readUInt32BE(OFS_FILE_MAGIC.length), start = OFS_FILE_MAGIC.length + 4;
  if (manifestLength <= 0 || manifestLength > 1024 * 1024 || start + manifestLength > payload.length) throw new Error('The OrionFS manifest is invalid.');
  const manifest = JSON.parse(payload.subarray(start, start + manifestLength).toString('utf8')) as { version: number; compression: string; files: Array<{ name: string; size: number; packedSize: number; sha256: string }> };
  if (manifest.version !== 1 || manifest.compression !== 'deflate-raw' || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 3) throw new Error('Unsupported OrionFS container version.');
  let offset = start + manifestLength, hasMain = false;
  for (const entry of manifest.files) {
    if (!['', '-wal', '-shm'].includes(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.packedSize) || entry.packedSize < 0 || offset + entry.packedSize > payload.length) throw new Error('An OrionFS data block is invalid.');
    const block = await inflate(payload.subarray(offset, offset + entry.packedSize)); offset += entry.packedSize;
    if (block.length !== entry.size || crypto.createHash('sha256').update(block).digest('hex') !== entry.sha256) throw new Error('An OrionFS data block failed its integrity check.');
    await writeAtomic(`${workingFile}${entry.name}`, block); if (entry.name === '') hasMain = true;
  }
  if (!hasMain || offset !== payload.length) throw new Error('The OrionFS container is incomplete.');
}

/** Encrypted OrionFS container; its payload arena is append-only and content-addressed. */
export async function openEncryptedOfsDatabase(ofsFile: string, legacyFile: string, workingFile: string) {
  const startedAt = performance.now();
  await fs.mkdir(path.dirname(workingFile), { recursive: true });
  // A crash can leave the transient plaintext OFS container behind. The
  // last AES-GCM committed envelope remains authoritative, so discard the temp.
  await fs.rm(`${workingFile}.container.tmp`, { force: true });
  if (await fs.access(workingFile).then(() => true, () => false)) return;
  try {
    const payload = decryptBytes(await fs.readFile(ofsFile));
    if (payload.subarray(0, OFS_CONTAINER_MAGIC.length).equals(OFS_CONTAINER_MAGIC)) await restoreOFSContainer(payload, workingFile);
    else if (payload.subarray(0, OFS_FILE_MAGIC.length).equals(OFS_FILE_MAGIC)) await readLegacyVersionedSnapshot(payload, workingFile);
    else throw new Error('Unsupported OrionFS container. Your encrypted data has been preserved.');
    const storedBytes = (await fs.stat(ofsFile)).size;
    console.info(`[OrionFS] local open benchmark: encrypted OFS ${storedBytes.toLocaleString()} B on disk · ${Math.round(performance.now() - startedAt)} ms decrypt, index load, checksum verification, and extraction.`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await openEncryptedDatabase(legacyFile, workingFile);
  const legacyBytes = await fs.stat(legacyFile).then(stat => stat.size, () => 0);
  if (legacyBytes) console.info(`[OrionFS] local open benchmark: legacy encrypted SQLite ${legacyBytes.toLocaleString()} B on disk · ${Math.round(performance.now() - startedAt)} ms decrypt and extraction.`);
}

export async function sealEncryptedOfsDatabase(ofsFile: string, workingFile: string, legacyFile?: string) {
  const startedAt = performance.now(), containerPath = `${workingFile}.container.tmp`;
  const oldOfsBytes = await fs.stat(ofsFile).then(stat => stat.size, () => 0);
  const legacyBytes = legacyFile ? await fs.stat(legacyFile).then(stat => stat.size, () => 0) : 0;
  const sourceFiles: Array<{ name: OFSSnapshotManifest['files'][number]['name']; raw: Buffer }> = [];
  for (const name of ['', '-wal'] as const) {
    const raw = await fs.readFile(`${workingFile}${name}`).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error));
    if (raw && (name === '' || raw.length > 0)) sourceFiles.push({ name, raw });
  }
  const main = sourceFiles.find(file => file.name === '');
  if (!main) return;

  const manifest: OFSSnapshotManifest = { version: 1, chunkBytes: OFS_CHUNK_BYTES, files: [] };
  const entries: Array<{ path: string; data: Buffer }> = [];
  for (const file of sourceFiles) {
    const chunks = Math.ceil(file.raw.length / OFS_CHUNK_BYTES);
    manifest.files.push({ name: file.name, size: file.raw.length, chunks, sha256: crypto.createHash('sha256').update(file.raw).digest('hex') });
    const prefix = ofsSuffix(file.name);
    for (let index = 0; index < chunks; index++) entries.push({ path: ofsChunkName(prefix, index), data: file.raw.subarray(index * OFS_CHUNK_BYTES, Math.min(file.raw.length, (index + 1) * OFS_CHUNK_BYTES)) });
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  entries.push({ path: 'snapshot/manifest.json', data: manifestBytes });
  const currentPaths = new Set(entries.map(entry => entry.path));

  let container: OFSContainer | undefined;
  try {
    const existing = await fs.readFile(ofsFile).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error));
    let existingOFS = false;
    if (existing) {
      const payload = decryptBytes(existing);
      if (payload.subarray(0, OFS_CONTAINER_MAGIC.length).equals(OFS_CONTAINER_MAGIC)) { existingOFS = true; await writeAtomic(containerPath, payload); }
      else if (!payload.subarray(0, OFS_FILE_MAGIC.length).equals(OFS_FILE_MAGIC)) throw new Error('Unsupported OrionFS container. Your encrypted data has been preserved.');
    }
    container = await OFSContainer.open(containerPath, { createIfMissing: true });
    const activeContainer = container;
    if (!activeContainer) throw Error('Could not open the encrypted OFS snapshot.');
    let compactedHistory = false;
    let compactedHistorySummary = '';
    if (existingOFS) {
      try {
        const savedManifest = await activeContainer.get('snapshot/manifest.json');
        if (savedManifest.equals(manifestBytes)) {
          const staleChunks = activeContainer.listFiles({ prefix: 'snapshot/' }).filter(file => !currentPaths.has(file.path));
          let stats = await activeContainer.stats();
          if (staleChunks.length || (stats.totalFiles > 0 && stats.totalVersions > stats.totalFiles)) {
            for (const file of staleChunks) activeContainer.delete(file.path);
            await activeContainer.compact({ keepVersions: 1, dropDeleted: true });
            stats = await activeContainer.stats();
            await activeContainer.close(); container = undefined;
            const compacted = await fs.readFile(containerPath);
            await writeAtomic(ofsFile, encryptBytes(compacted));
            compactedHistory = true;
            compactedHistorySummary = `${stats.totalVersions} current records, ${(await fs.stat(ofsFile)).size.toLocaleString()} B encrypted`;
          } else {
            await activeContainer.close(); container = undefined;
          }
          if (legacyFile) await fs.rm(legacyFile, { force: true });
          await Promise.all(['', '-wal', '-shm'].map(suffix => fs.rm(`${workingFile}${suffix}`, { force: true })));
          console.info(compactedHistory
            ? `[OrionFS] unchanged snapshot; removed obsolete chunks and compacted to one current version per record (${compactedHistorySummary}); skipped redundant seal (${Math.round(performance.now() - startedAt)} ms).`
            : `[OrionFS] encrypted OFS snapshot unchanged; skipped redundant seal (${oldOfsBytes.toLocaleString()} B, ${Math.round(performance.now() - startedAt)} ms comparison).`);
          return;
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('File not found in .ofs container')) throw error;
      }
    }
    for (const file of activeContainer.listFiles({ prefix: 'snapshot/' })) {
      if (!currentPaths.has(file.path)) activeContainer.delete(file.path);
    }
    for (const entry of entries) await activeContainer.put(entry.path, entry.data);
    await activeContainer.compact({ keepVersions: 1, dropDeleted: true });
    const stats = await activeContainer.stats();
    await activeContainer.close(); container = undefined;
    const archive = await fs.readFile(containerPath);
    await writeAtomic(ofsFile, encryptBytes(archive));
    const storedBytes = (await fs.stat(ofsFile)).size;
    if (legacyFile) await fs.rm(legacyFile, { force: true });
    await Promise.all(['', '-wal', '-shm'].map(suffix => fs.rm(`${workingFile}${suffix}`, { force: true })));
    if (!ofsBenchmarkReported) {
      ofsBenchmarkReported = true;
      const elapsed = Math.round(performance.now() - startedAt);
      if (legacyBytes > 0) {
        const savedPercent = ((1 - storedBytes / legacyBytes) * 100).toFixed(1);
        console.info(`[OrionFS] local format comparison: previous encrypted snapshot ${legacyBytes.toLocaleString()} B → encrypted OFS ${storedBytes.toLocaleString()} B (${savedPercent}% smaller); ${stats.totalFiles} records, ${stats.totalVersions} version entries, ${stats.uniqueContentBlocks} unique blocks; ${elapsed} ms seal.`);
      } else if (oldOfsBytes > 0) {
        const delta = storedBytes - oldOfsBytes;
        console.info(`[OrionFS] encrypted OFS snapshot updated: ${oldOfsBytes.toLocaleString()} B → ${storedBytes.toLocaleString()} B (${delta >= 0 ? '+' : ''}${delta.toLocaleString()} B); ${stats.totalFiles} records, ${stats.totalVersions} version entries, ${stats.uniqueContentBlocks} unique blocks; ${elapsed} ms seal.`);
      } else {
        console.info(`[OrionFS] initial encrypted OFS snapshot: ${storedBytes.toLocaleString()} B; ${stats.totalFiles} records, ${stats.totalVersions} version entries, ${stats.uniqueContentBlocks} unique blocks; ${elapsed} ms seal.`);
      }
    }
  } finally {
    await container?.close().catch(() => undefined);
    await fs.rm(containerPath, { force: true });
  }
}

export function secureStorageLocation() { return app.getPath('userData'); }
