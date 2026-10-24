import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagedModelFormat } from '../shared/types';

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('Could not allocate an inference port.')));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

/** Use larger prompt chunks only when the GPU has enough free memory to absorb the extra workspace. */
async function tunedPrefillChunkTokens() {
  try {
    const child = spawn('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const result = await new Promise<number | undefined>(resolve => {
      const timeout = setTimeout(() => { child.kill(); resolve(undefined); }, 1500);
      child.stdout?.on('data', chunk => { output = (output + String(chunk)).slice(-256); });
      child.once('error', () => { clearTimeout(timeout); resolve(undefined); });
      child.once('close', code => {
        clearTimeout(timeout);
        const free = Number.parseInt(output.trim().split(/\s+/)[0] ?? '', 10);
        resolve(code === 0 && Number.isFinite(free) ? free : undefined);
      });
    });
    // Leave at least a few GiB for model weights, KV cache growth, and the desktop.
    if (result !== undefined && result >= 14_000) return 2048;
    if (result !== undefined && result >= 8_000) return 1024;
  } catch { /* Non-NVIDIA hosts use the conservative runtime default. */ }
  return 512;
}

/** Orion's locally managed inference runtime for supported model formats. */
export class OrionInferenceRuntime {
  private child: ChildProcess | null = null;
  private port = 0;
  private activeModel = '';
  private activeContext = 0;
  private log = '';
  private generation = 0;
  private disposed = false;
  private lifecycle: Promise<unknown> = Promise.resolve();

  constructor(private readonly resourceRoot: string) {}

  private executable() {
    const name = process.platform === 'win32' ? 'orion-inference.exe' : 'orion-inference';
    return path.join(this.resourceRoot, 'build', 'inference-runtime', name);
  }

  async isInstalled() {
    return fs.access(this.executable()).then(() => true, () => false);
  }

  async verify() {
    const binary = this.executable();
    if (!await fs.access(binary).then(() => true, () => false)) throw new Error('Orion’s bundled inference runtime is missing. Repair or reinstall Orion.');
    return true;
  }

  async ensureServer(modelPath: string, context: number, format: ManagedModelFormat = 'gguf') {
    if (this.disposed) throw new Error('Orion inference is shutting down.');
    const generation = this.generation;
    const operation = this.lifecycle.then(() => this.start(modelPath, context, generation, format));
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  private async start(modelPath: string, context: number, generation: number, format: ManagedModelFormat) {
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('Orion inference startup was cancelled.'); };
    check();
    if (!await fs.stat(modelPath).then(stat => stat.isFile(), () => false)) throw new Error('The selected model file is missing. Re-download it from Models.');
    await this.verify();
    const key = `${modelPath}\0${context}\0${format}`;
    if (this.child && this.child.exitCode === null && !this.child.killed && this.activeModel === key) {
      const healthy = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false);
      check();
      if (healthy) return `http://127.0.0.1:${this.port}`;
    }
    await this.stopChild();
    check();
    this.port = await freePort();
    const modelDirectory = path.dirname(modelPath);
    const modelFile = path.basename(modelPath);
    const prefillChunk = await tunedPrefillChunkTokens();
    check();
    const args = ['serve', '-m', modelDirectory];
    if (format === 'gguf') args.push('-f', modelFile);
    else args.push('--format', 'plain');
    args.push('--max-model-len', String(context), '--max-seqs', '1', '--max-prefill-chunk-tokens', String(prefillChunk), '--host', '127.0.0.1', '--port', String(this.port), '--no-ui');
    this.log = '';
    const child = spawn(this.executable(), args, { cwd: path.dirname(this.executable()), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, CUDA_MODULE_LOADING: 'LAZY' } });
    child.stderr?.on('data', chunk => { this.log = (this.log + String(chunk)).slice(-12000); });
    this.child = child;
    const spawnError: { value: Error | null } = { value: null };
    child.once('error', error => { spawnError.value = error; if (this.child === child) this.child = null; });
    child.once('exit', () => { if (this.child === child) this.child = null; });
    this.activeModel = key;
    this.activeContext = context;
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      check();
      if (!this.child || this.child.killed || this.child.exitCode !== null) throw new Error(spawnError.value ? `Could not start Orion inference: ${spawnError.value.message}` : `Orion inference stopped while loading the model.\n${this.log.trim()}`);
      if (await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false)) {
        check();
        return `http://127.0.0.1:${this.port}`;
      }
      await delay(800);
    }
    await this.stopChild();
    throw new Error('Orion inference did not finish loading this model within eight minutes.');
  }

  async stop() {
    this.generation++;
    await this.stopChild();
    await this.lifecycle;
  }

  async dispose() { this.disposed = true; await this.stop(); }

  private async stopChild() {
    const child = this.child;
    if (child && child.exitCode === null) {
      if (process.platform === 'win32' && child.pid) {
        await new Promise<void>(resolve => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          const timeout = setTimeout(() => { child.kill(); resolve(); }, 6000);
          killer.once('error', () => { clearTimeout(timeout); child.kill(); resolve(); });
          killer.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
      } else {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
          child.kill('SIGTERM');
        });
      }
    }
    if (this.child === child) this.child = null;
    this.activeModel = '';
    this.activeContext = 0;
  }
}
