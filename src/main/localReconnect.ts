import { setTimeout as delay } from 'node:timers/promises';

// Managed runtimes can change ports when a model is restored. Resolve the
// endpoint again on every attempt rather than retaining a dead server address.
export async function fetchWithLocalReconnect(endpoint: string | (() => Promise<string>), init: RequestInit, service: string, attempts = 7): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    init.signal?.throwIfAborted();
    try { return await fetch(typeof endpoint === 'function' ? await endpoint() : endpoint, init); }
    catch (error) {
      init.signal?.throwIfAborted();
      lastError = error;
      if (attempt + 1 < attempts) await delay(Math.min(5000, 350 * 2 ** attempt), undefined, { signal: init.signal ?? undefined });
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'connection refused');
  throw new Error(`Could not reconnect to ${service}: ${reason}`);
}
