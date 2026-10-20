import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(directory, 'assets');
await mkdir(assets, { recursive: true });
const result = await Bun.build({ entrypoints: [path.join(directory, 'site.ts')], outdir: assets, target: 'browser', minify: true });
if (!result.success) { for (const error of result.logs) console.error(error); process.exit(1); }
await copyFile(path.join(directory, '../build/icons/orion-512.png'), path.join(assets, 'icon.png'));
await copyFile(path.join(directory, '../build/icons/orion-1024.png'), path.join(assets, 'metal.png'));
console.log('Built website/assets/site.js and site.css. Ready for static hosting.');
