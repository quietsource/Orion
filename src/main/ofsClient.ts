import { Worker } from 'node:worker_threads';
import type { OrionFS, OFSConfig } from '../../ofs';

export class OFSClient {
  private readonly worker: Worker;
  private sequence = 0;
  private failed: Error | null = null;
  private closing = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(config: OFSConfig, workerPath: string) {
    this.worker = new Worker(workerPath, { workerData: config });
    this.worker.on('message', (response: { id: number; result?: unknown; error?: string }) => {
      const request = this.pending.get(response.id); if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
    });
    const fail = (error: Error) => { this.failed = error; for (const request of this.pending.values()) request.reject(error); this.pending.clear(); };
    this.worker.on('error', fail);
    this.worker.on('exit', code => { if (!this.closing || this.pending.size) fail(new Error(`OrionFS worker exited (${code})`)); });
  }
  private call<T>(method: string, args: unknown[] = []): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.closing && method !== 'close') return Promise.reject(new Error('OrionFS is closing'));
    return new Promise<T>((resolve, reject) => { const id = ++this.sequence; this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker.postMessage({ id, method, args }); });
  }
  ingestTurn(...args: Parameters<OrionFS['ingestTurn']>) { return this.call<void>('ingest', args); }
  recall(...args: Parameters<OrionFS['recall']>) { return this.call<Awaited<ReturnType<OrionFS['recall']>>>('recall', args); }
  getStats(...args: Parameters<OrionFS['getStats']>) { return this.call<ReturnType<OrionFS['getStats']>>('stats', args); }
  listMemories(...args: Parameters<OrionFS['listMemories']>) { return this.call<ReturnType<OrionFS['listMemories']>>('list', args); }
  removeConversation(id: string) { return this.call<void>('remove', [id]); }
  async close() {
    if (this.closing) return;
    this.closing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.call<void>('close'), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { if (timer) clearTimeout(timer); await this.worker.terminate(); }
  }
}
