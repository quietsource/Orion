const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

test('concurrent llama requests share one ready process and shutdown forbids restart', async () => {
  const originalSpawn = childProcess.spawn, originalFetch = global.fetch;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-llama-lifecycle-'));
  const model = path.join(root, 'model.gguf'); await fs.writeFile(model, 'fake');
  let spawns = 0, exits = 0;
  childProcess.spawn = () => {
    spawns++;
    const child = new EventEmitter(); child.exitCode = null; child.killed = false;
    child.kill = () => { child.killed = true; queueMicrotask(() => { child.exitCode = 0; exits++; child.emit('exit', 0); }); return true; };
    return child;
  };
  global.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true }; };
  try {
    // Bun's CJS compilation retains the node:child_process namespace reference.
    const { LlamaManager } = require('../dist/main/llama.js');
    const manager = new LlamaManager(root, () => {});
    manager.state = { backend: 'cpu', cpuBinary: path.join(root, 'runtime-cpu', 'fake'), serverBinary: 'fake' };
    manager.runtimeEnvironment = async () => process.env;
    const urls = await Promise.all([manager.ensureServer(model, 8192), manager.ensureServer(model, 8192), manager.ensureServer(model, 8192)]);
    assert.equal(spawns, 1); assert.equal(new Set(urls).size, 1);
    await manager.dispose(); assert.equal(exits, 1);
    await assert.rejects(manager.ensureServer(model, 8192), /shutting down/);
    assert.equal(spawns, 1);
  } finally { childProcess.spawn = originalSpawn; global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});
