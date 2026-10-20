export async function connectOrion(port = 9224, predicate = page => page.title === 'Orion') {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(predicate); if (!page) throw Error('Orion webview not found.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const waiting = new Map(); const handlers = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const item = waiting.get(message.id); if (!item) return; waiting.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); }
    else for (const callback of handlers.get(message.method) ?? []) callback(message.params);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 120000);
    waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    call,
    async evaluate(expression) { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; },
    on(name, callback) { let callbacks = handlers.get(name); if (!callbacks) handlers.set(name, callbacks = new Set()); callbacks.add(callback); },
    async screenshot(file) { const result = await call('Page.captureScreenshot', { format: 'png' }); await Bun.write(file, Buffer.from(result.data, 'base64')); },
    close() { socket.close(); },
  };
}
