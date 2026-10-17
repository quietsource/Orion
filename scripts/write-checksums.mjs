import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directoryPath = fileURLToPath(new URL('../release/', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const distributableExtensions = new Set(['.AppImage', '.deb', '.dmg', '.exe', '.rpm', '.zip']);

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const entries = await readdir(directoryPath, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.includes(version) && [...distributableExtensions].some((extension) => entry.name.endsWith(extension)))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) throw new Error(`No distributable packages found in ${directoryPath}`);

const lines = await Promise.all(files.map(async (filename) => `${await sha256(join(directoryPath, filename))}  ${basename(filename)}`));
await writeFile(join(directoryPath, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote SHA256SUMS for ${files.length} package(s).`);
