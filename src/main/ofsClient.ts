import { Worker } from 'node:worker_threads';
import type { OrionFS, OFSConfig } from '../../ofs';

type StorageLifecycle = { prepare(): Promise<void>; seal(): Promise<void>; idleMs?: number };

export class OFSClient {
  private worker: Worker | null = null;
  private startPromise: Promise<Worker> | null = null;
  private stopPromise: Promise<void> | null = null;
  private sequence = 0;
  private failed: Error | null = null;
  private closed = false;
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private prepared = false;
  private statsCache = new Map<string, ReturnType<OrionFS['getStats']>>();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly config: OFSConfig, private readonly workerPath: string, private readonly storage?: StorageLifecycle) {}

  private async startWorker() {
    if (this.worker) return this.worker;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      if (this.stopPromise) await this.stopPromise;
      await this.storage?.prepare();
      this.prepared = true;
      const worker = new Worker(this.workerPath, { workerData: this.config });
      this.worker = worker;
      worker.on('message', (response: { id: number; result?: unknown; error?: string }) => {
        const request = this.pending.get(response.id);
        if (!request) return;
        this.pending.delete(response.id);
        if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
      });
      const fail = (error: Error) => {
        this.failed = error;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
      };
      worker.on('error', fail);
      worker.on('exit', code => {
        if (this.worker === worker) this.worker = null;
        if (!this.closed && !this.stopPromise) fail(new Error(`OrionFS worker exited (${code})`));
      });
      return worker;
    })().catch(async error => {
      if (this.prepared) { await this.storage?.seal().catch(() => undefined); this.prepared = false; }
      throw error;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async call<T>(method: string, args: unknown[] = []): Promise<T> {
    if (this.closed) throw new Error('OrionFS is closing');
    if (this.failed) throw this.failed;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.inFlight++;
    try {
      const worker = await this.startWorker();
      return await new Promise<T>((resolve, reject) => {
        const id = ++this.sequence;
        this.pending.set(id, { resolve: value => resolve(value as T), reject });
        worker.postMessage({ id, method, args });
      });
    } finally {
      this.inFlight--;
      this.scheduleIdleSeal();
    }
  }

  private scheduleIdleSeal() {
    if (this.closed || !this.storage || !this.worker || this.inFlight || this.pending.size) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.inFlight && !this.pending.size) void this.stopWorker();
    }, this.storage.idleMs ?? 20_000);
    this.idleTimer.unref?.();
  }

  private async stopWorker() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = (async () => {
      const worker = this.worker;
      if (worker) {
        const id = ++this.sequence;
        const closed = new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 5000);
          this.pending.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: () => { clearTimeout(timer); resolve(); } });
        });
        worker.postMessage({ id, method: 'close', args: [] });
        await closed;
        await worker.terminate().catch(() => 0);
        if (this.worker === worker) this.worker = null;
      }
      if (this.prepared) { await this.storage?.seal(); this.prepared = false; }
      this.failed = null;
    })().finally(() => { this.stopPromise = null; this.startPromise = null; });
    return this.stopPromise;
  }

  ingestTurn(...args: Parameters<OrionFS['ingestTurn']>) { this.statsCache.clear(); return this.call<void>('ingest', args); }
  recall(...args: Parameters<OrionFS['recall']>) { return this.call<Awaited<ReturnType<OrionFS['recall']>>>('recall', args); }
  async getStats(...args: Parameters<OrionFS['getStats']>) {
    const cacheKey = JSON.stringify(args);
    if(this.statsCache.size>64)this.statsCache.clear();
    if (!this.worker && !this.startPromise && this.statsCache.has(cacheKey)) return this.statsCache.get(cacheKey)!;
    const value = await this.call<ReturnType<OrionFS['getStats']>>('stats', args);
    this.statsCache.set(cacheKey, value);
    return value;
  }
  listMemories(...args: Parameters<OrionFS['listMemories']>) { return this.call<ReturnType<OrionFS['listMemories']>>('list', args); }
  exportSnapshot() { return this.call<Awaited<ReturnType<OrionFS['exportSnapshot']>>>('export'); }
  importSnapshot(...args: Parameters<OrionFS['importSnapshot']>) { this.statsCache.clear(); return this.call<void>('import', args); }
  forgetMemories(conversationId: string, ids: string[]) { this.statsCache.clear(); return this.call<void>('forget', [conversationId, ids]); }
  removeConversation(id: string) { this.statsCache.clear(); return this.call<void>('remove', [id]); }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    await this.startPromise?.catch(() => undefined);
    await this.stopWorker();
  }
}
