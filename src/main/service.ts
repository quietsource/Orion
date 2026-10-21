// This binary contains Bun and the backend. There is no Electron or system Node dependency.
import path from 'node:path';
import fs from 'node:fs';

// Native N-API addons must remain next to Orion's packaged resources when the
// Bun service is compiled. Point @napi-rs/canvas at that managed copy before
// loading the backend bundle.
const rawResourceRoot = process.env.ORION_RESOURCE_ROOT;
const resourceRoot = process.platform === 'win32' && rawResourceRoot
  ? rawResourceRoot.startsWith('\\\\?\\UNC\\')
    ? `\\\\${rawResourceRoot.slice(8)}`
    : rawResourceRoot.startsWith('\\\\?\\') ? rawResourceRoot.slice(4) : rawResourceRoot
  : rawResourceRoot;
if (resourceRoot) {
  process.env.ORION_RESOURCE_ROOT = resourceRoot;
  const nativeName = process.platform === 'win32' && process.arch === 'x64'
    ? 'skia.win32-x64-msvc.node'
    : process.platform === 'linux' && process.arch === 'x64'
      ? 'skia.linux-x64-gnu.node'
      : process.platform === 'linux' && process.arch === 'arm64'
        ? 'skia.linux-arm64-gnu.node'
        : process.platform === 'darwin' && process.arch === 'arm64'
          ? 'skia.darwin-arm64.node'
          : process.platform === 'darwin' && process.arch === 'x64'
            ? 'skia.darwin-x64.node'
            : null;
  const nativePath = nativeName && path.join(resourceRoot, 'dist', 'native-canvas', nativeName);
  if (nativePath && fs.existsSync(nativePath)) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
}

if (process.argv.includes('--voice-worker')) {
  await import('./voiceWorker');
} else {
  // stdout is the private, framed native bridge. Never mix application logs into it.
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  await import('./main');
}
export {};
