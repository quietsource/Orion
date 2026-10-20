import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pack, unpack } from '../src/platform/codec';

const root = process.argv[2];
if (!root) throw Error('Pass the path of an installed local voice model directory. Models are only read.');
const native = path.join(root, `runtime-1.13.8/sherpa-onnx-${process.platform === 'win32' ? 'win' : 'linux'}-x64`);
const executable = path.resolve(`src-tauri/binaries/orion-service-${process.platform === 'win32' ? 'x86_64-pc-windows-msvc.exe' : 'x86_64-unknown-linux-gnu'}`);
async function worker(kind: 'dictation' | 'speech') {
  const child = spawn(executable, ['--voice-worker'], { windowsHide: true, env: { ...process.env, PATH: `${native}${path.delimiter}${process.env.PATH}`, LD_LIBRARY_PATH: native }, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let serial = 0;
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => { try {
    const message = JSON.parse(line); if (!message.$voice) return;
    const value = unpack(message.payload), item = pending.get(value.id); if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(value.error)) : item.resolve(value.result);
  } catch {} });
  child.on('exit', code => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(`Voice worker exited ${code}`)); } pending.clear(); });
  const call = (method: string, ...args: unknown[]) => new Promise<any>((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => reject(Error(`Voice check timeout: ${method}`)), 120000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify(pack({ id, method, args })) + '\n');
  });
  try {
    assert.equal(await call('init', root, kind), true);
    if (kind === 'dictation') {
      assert.equal(await call('reset'), true);
      const recognized = await call('accept', new Float32Array(16000), 16000);
      assert.equal(typeof recognized.text, 'string');
      const finished = await call('finish'); assert.equal(finished.final, true);
      console.log('PASS: compiled Bun process loads streaming recognition and accepts real Float32 audio frames.');
    } else {
      const audio = await call('speak', 'Hello. This is a local Orion voice check.', { speaker: 3, accent: 'us' }, 1);
      assert(audio.samples instanceof Float32Array); assert(audio.samples.length > 1000); assert(audio.sampleRate >= 16000);
      assert(audio.samples.some((value: number) => Math.abs(value) > 0.001));
      console.log(`PASS: compiled Bun process synthesizes non-silent neural speech (${audio.samples.length} samples at ${audio.sampleRate} Hz).`);
    }
  } finally { reader.close(); child.kill(); }
}
await worker('dictation'); await worker('speech');
