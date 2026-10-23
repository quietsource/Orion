import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
process.chdir(root);
async function run(command, args) { const child = Bun.spawn([command, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' }); if (await child.exited !== 0) throw Error(`${command} ${args.join(' ')} failed`); }
await run('bun', ['scripts/generate-highlight-languages.mjs']);
await run('bun', ['run', 'typecheck']);
await run('bun', ['scripts/build-inference-runtime.mjs']);
for (const directory of ['dist/main', 'dist/ocr', 'dist/native-canvas']) await rm(directory, { recursive: true, force: true });
await mkdir('dist/main', { recursive: true });
await mkdir('dist/ocr', { recursive: true });
await mkdir('dist/native-canvas', { recursive: true });
const canvasPackage = process.platform === 'win32' && process.arch === 'x64' ? 'canvas-win32-x64-msvc'
  : process.platform === 'linux' && process.arch === 'x64' ? 'canvas-linux-x64-gnu'
    : process.platform === 'linux' && process.arch === 'arm64' ? 'canvas-linux-arm64-gnu'
      : process.platform === 'darwin' && process.arch === 'arm64' ? 'canvas-darwin-arm64'
        : process.platform === 'darwin' && process.arch === 'x64' ? 'canvas-darwin-x64' : null;
if (!canvasPackage) throw Error(`No managed @napi-rs/canvas binary is available for ${process.platform}-${process.arch}.`);
const canvasPackageDir = `node_modules/@napi-rs/${canvasPackage}`;
for (const file of await readdir(canvasPackageDir)) if (/\.node$/.test(file) || file === 'icudtl.dat') await cp(path.join(canvasPackageDir, file), path.join('dist/native-canvas', file));
await cp('node_modules/tesseract.js/dist/worker.min.js', 'dist/ocr/worker.min.js');
for (const file of await readdir('node_modules/tesseract.js-core')) if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)) await cp(path.join('node_modules/tesseract.js-core', file), path.join('dist/ocr', file));
const worker = await Bun.build({ entrypoints: ['src/main/ofsWorker.ts'], outdir: 'dist/main', target: 'bun', minify: false });
if (!worker.success) throw Error(worker.logs.map(String).join('\n'));
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? (process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu');
const extension = process.platform === 'win32' ? '.exe' : '';
await run('bun', ['build', '--compile', '--target=bun', 'src/main/service.ts', '--outfile', `src-tauri/binaries/orion-service-${target}${extension}`]);
await run('bun', ['scripts/build-renderer.mjs']);
console.log(`Built Orion frontend, OFS worker and bundled Bun service for ${target}.`);
