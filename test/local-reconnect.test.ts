import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { fetchWithLocalReconnect } from '../src/main/localReconnect';

test('follow-up inference resolves the current runtime port after a model handoff', async () => {
  const server = createServer((request, response) => {
    expect(request.url).toBe('/v1/chat/completions');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ content: 'Image created.' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let resolutions = 0;
  try {
    const response = await fetchWithLocalReconnect(async () => {
      resolutions++;
      return resolutions === 1 ? 'http://127.0.0.1:0/v1/chat/completions' : `http://127.0.0.1:${address.port}/v1/chat/completions`;
    }, { method: 'POST', body: '{}' }, 'test runtime', 2);
    expect(await response.json()).toEqual({ content: 'Image created.' });
    expect(resolutions).toBe(2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('cancelling during reconnect stops endpoint resolution and retries', async () => {
  const controller = new AbortController();
  let resolutions = 0;
  const operation = fetchWithLocalReconnect(async () => {
    resolutions++;
    return 'http://127.0.0.1:0/v1/chat/completions';
  }, { signal: controller.signal }, 'test runtime');
  setTimeout(() => controller.abort(), 30);
  await expect(operation).rejects.toThrow();
  expect(resolutions).toBe(1);
});
