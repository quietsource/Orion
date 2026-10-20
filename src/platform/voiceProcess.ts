import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { pack, unpack } from './codec';

export class VoiceProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  readonly stdout;
  readonly stderr;
  constructor(environment: NodeJS.ProcessEnv) {
    super();
    const development = process.execPath.toLowerCase().endsWith('bun.exe') || process.execPath.endsWith('/bun');
    const args = development ? [process.env.ORION_SERVICE_ENTRY!, '--voice-worker'] : ['--voice-worker'];
    this.child = spawn(process.execPath, args, { env: environment, windowsHide: true, stdio: 'pipe' });
    this.stdout = this.child.stdout; this.stderr = this.child.stderr;
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => { try { const value = JSON.parse(line); if (value.$voice) this.emit('message', unpack(value.payload)); } catch { /* Native runtime diagnostics never enter transcript or logs. */ } });
    this.child.on('exit', () => { lines.close(); this.emit('exit'); });
    this.child.on('error', () => { lines.close(); this.emit('exit'); });
  }
  postMessage(value: unknown) { this.child.stdin.write(JSON.stringify(pack(value)) + '\n'); }
  kill() { this.child.kill(); }
}
export function createVoiceWorkerPort() {
  const source = createInterface({ input: process.stdin, crlfDelay: Infinity });
  return {
    on(_name: 'message', callback: (event: { data: any }) => void) { source.on('line', line => { try { callback({ data: unpack(JSON.parse(line)) }); } catch { /* A malformed packet is ignored without logging speech. */ } }); source.on('close', () => process.exit(0)); },
    postMessage(value: unknown) { process.stdout.write(JSON.stringify({ $voice: true, payload: pack(value) }) + '\n'); },
  };
}
