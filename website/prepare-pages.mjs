import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
await import('./build.mjs');
const directory = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(directory, '../docs');
await mkdir(path.join(docs, 'assets'), { recursive: true });
for (const name of ['index.html', '.nojekyll']) await copyFile(path.join(directory, name), path.join(docs, name));
for (const file of await readdir(path.join(directory, 'assets'), { withFileTypes: true })) {
  if (file.isFile()) await copyFile(path.join(directory, 'assets', file.name), path.join(docs, 'assets', file.name));
}
console.log('Prepared docs/ for GitHub Pages. Existing documentation is preserved.');
