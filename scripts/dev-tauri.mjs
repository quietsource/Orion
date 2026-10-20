import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'dist', 'renderer');
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4173,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const relative = path.normalize(pathname.replace(/^[/\\]+/, '') || 'index.html');
    const file = path.resolve(renderer, relative);
    if (file !== renderer && !file.startsWith(`${renderer}${path.sep}`)) return new Response('Not found', { status: 404 });
    const data = Bun.file(file);
    if (!(await data.exists())) return new Response('Not found', { status: 404 });
    return new Response(data, { headers: { 'content-type': mimeTypes.get(path.extname(file)) ?? 'application/octet-stream' } });
  },
});

const cli = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'dev', '--no-watch'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

const stop = signal => {
  if (!cli.killed) cli.kill(signal);
  server.stop(true);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
cli.on('exit', (code, signal) => {
  server.stop(true);
  process.exitCode = code ?? (signal ? 1 : 0);
});
