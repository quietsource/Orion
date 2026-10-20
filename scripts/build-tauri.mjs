import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
process.chdir(root);
async function run(command, args) { const child = Bun.spawn([command, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' }); if (await child.exited !== 0) throw Error(`${command} ${args.join(' ')} failed`); }
await run('bun', ['scripts/generate-highlight-languages.mjs']);
await run('bun', ['run', 'typecheck']);
await mkdir('dist/main', { recursive: true });
const worker = await Bun.build({ entrypoints: ['src/main/ofsWorker.ts'], outdir: 'dist/main', target: 'bun', minify: false });
if (!worker.success) throw Error(worker.logs.map(String).join('\n'));
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? (process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu');
const extension = process.platform === 'win32' ? '.exe' : '';
await run('bun', ['build', '--compile', '--target=bun', 'src/main/service.ts', '--outfile', `src-tauri/binaries/orion-service-${target}${extension}`]);
await run('bun', ['scripts/build-renderer.mjs']);
console.log(`Built Orion frontend, OFS worker and bundled Bun service for ${target}.`);
