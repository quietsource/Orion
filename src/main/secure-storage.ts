import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_MAGIC = Buffer.from('ORIONENC1');
const KEY_MAGIC = Buffer.from('ORIONKEY1');
const SQLITE_ARCHIVE_MAGIC = Buffer.from('OFSSNAP1');
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
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Orion cannot start because the operating system secure storage service is unavailable. Sign in to your desktop keychain or password manager and restart Orion.');
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown';
  if (process.platform === 'linux' && backend === 'basic_text') throw new Error('Orion needs a desktop keyring (GNOME Keyring, KWallet, or Secret Service) to encrypt private data. Enable a system keyring and restart Orion.');
  const keyFile = path.join(root, 'data-key.bin');
  try {
    const stored = await fs.readFile(keyFile);
    if (!stored.subarray(0, KEY_MAGIC.length).equals(KEY_MAGIC)) throw new Error('The Orion data encryption key has an unknown format.');
    dataKey = Buffer.from(safeStorage.decryptString(stored.subarray(KEY_MAGIC.length)), 'base64');
    if (dataKey.length !== 32) throw new Error('The Orion data encryption key is invalid.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Could not unlock Orion's local data key: ${error instanceof Error ? error.message : String(error)}`);
    dataKey = crypto.randomBytes(32);
    const protectedKey = safeStorage.encryptString(dataKey.toString('base64'));
    await writeAtomic(keyFile, Buffer.concat([KEY_MAGIC, protectedKey]));
  }
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

export function secureStorageLocation() { return app.getPath('userData'); }
