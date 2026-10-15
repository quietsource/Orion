import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rendererDirectory = path.join(root, 'dist', 'renderer');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sourceHtml = await readFile(path.join(root, 'index.html'), 'utf8');

await rm(rendererDirectory, { recursive: true, force: true });
await mkdir(rendererDirectory, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(root, 'src', 'renderer', 'renderer.ts')],
  outdir: rendererDirectory,
  target: 'browser',
  splitting: true,
  minify: true,
  define: { __ORION_VERSION__: JSON.stringify(packageInfo.version) },
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}

const stylesheet = result.outputs.find(output => output.kind === 'asset' && output.path.endsWith('.css'));
if (!stylesheet) throw new Error('Bun did not emit the renderer stylesheet.');

const html = sourceHtml
  .replaceAll('__ORION_VERSION__', packageInfo.version)
  .replace('<script type="module" src="/src/renderer/renderer.ts"></script>', '<script type="module" src="./renderer.js"></script>')
  .replace('</head>', '<link rel="stylesheet" href="./renderer.css"></head>');
await writeFile(path.join(rendererDirectory, 'index.html'), html);
