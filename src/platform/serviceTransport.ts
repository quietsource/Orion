import { createInterface } from 'node:readline';
import { pack, unpack } from './codec';

type Request = { id: number; channel: string; args: any[]; window: string };
let serial = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let dispatcher: ((request: Request) => Promise<unknown>) | undefined;
let eventReceiver: ((event: any) => void) | undefined;
const deferred: Request[] = [];
export function writeProtocol(value: unknown) { process.stdout.write(JSON.stringify(pack(value)) + '\n'); }
export function nativeCall<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Native operation timed out: ${method}`)); }, method === 'dialog-open' ? 30 * 60_000 : 30_000);
    pending.set(id, { resolve, reject, timer }); writeProtocol({ type: 'native', id, method, args });
  });
}
async function dispatch(request: Request) {
  try { writeProtocol({ type: 'response', id: request.id, value: await dispatcher!(request) }); }
  catch (error) { writeProtocol({ type: 'response', id: request.id, error: error instanceof Error ? error.message : String(error) }); }
}
export function setDispatcher(value: typeof dispatcher) { dispatcher = value; for (const request of deferred.splice(0)) void dispatch(request); }
export function setEventReceiver(value: typeof eventReceiver) { eventReceiver = value; }
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', line => {
  let value: any;
  try { value = unpack(JSON.parse(line)); } catch { return; }
  if (value.type === 'native-result') {
    const item = pending.get(value.id); if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer);
    value.error ? item.reject(Error(value.error)) : item.resolve(value.value);
  } else if (value.type === 'request') {
    if (dispatcher) void dispatch(value); else deferred.push(value);
  } else if (value.type === 'host-event') eventReceiver?.(value);
});
reader.on('close', () => eventReceiver?.({ event: 'parent-exited' }));
