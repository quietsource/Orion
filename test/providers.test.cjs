const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { normalizeProvider, providerModelKey, resolveProviderModel, discoverProviderModels } = require('../dist/main/providers.js');
const provider = { id: 'test', name: ' Example ', baseUrl: 'http://localhost:1234/v1/', models: [' org/model:v2 ', 'org/model:v2'], tools: true, apiKey: 'secret' };
test('normalizes configuration and preserves distinct remote model IDs', () => {
 const normalized = normalizeProvider(provider);
 assert.equal(normalized.baseUrl, 'http://localhost:1234/v1');
 assert.deepEqual(normalized.models, ['org/model:v2']);
 const key = providerModelKey('test', 'org/model:v2');
 assert.equal(resolveProviderModel([normalized], key).model, 'org/model:v2');
 assert.throws(() => resolveProviderModel([], key), /no longer configured/);
 assert.throws(() => normalizeProvider({...provider, baseUrl:'https://user:secret@example.com/v1'}));
 assert.throws(() => normalizeProvider({...provider, baseUrl:'file:///tmp/api'}));
});
test('discovers models with bearer authentication and handles incompatible endpoints', async () => {
 let fail = false;
 const server = createServer((req, res) => {
  assert.equal(req.url, '/v1/models'); assert.equal(req.headers.authorization, 'Bearer secret');
  res.writeHead(fail ? 401 : 200, {'content-type':'application/json'});
  res.end(fail ? '{}' : JSON.stringify({data:[{id:'one'},{id:'one'},{id:'org/two'}]}));
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const config = {...provider, baseUrl:`http://127.0.0.1:${server.address().port}/v1`};
  assert.deepEqual(await discoverProviderModels(config), ['one','org/two']);
  fail = true; await assert.rejects(discoverProviderModels(config), /HTTP 401/);
 } finally { await new Promise(resolve => server.close(resolve)); }
});
