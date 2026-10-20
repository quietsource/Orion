import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 4173), async fetch(request) {
  const url = new URL(request.url);
  const relative = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) return new Response('Not found', { status: 404 });
  const file = Bun.file(target);
  return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
} });
console.log(`Orion landing page: ${server.url}`);
