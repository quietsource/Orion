// Run with Electron's embedded runtime: ELECTRON_RUN_AS_NODE=1 electron --test test/ofs-worker.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

test('OFS worker persists, scopes, supersedes and recalls with model endpoints disabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-ofs-worker-'));
  const config = { dbPath: path.join(root, 'memory.sqlite'), maxContextTokens: 8192, reservedOutputTokens: 1024, memoryBudgetRatio: 0.25 };
  let worker, requests, sequence;
  const open = () => {
    requests = new Map(); sequence = 0;
    worker = new Worker(`global.fetch = () => { throw new Error('OFS must not call a model or network'); }; require(${JSON.stringify(path.resolve('dist/main/ofsWorker.js'))});`, { eval: true, workerData: config });
    worker.on('message', message => { const request = requests.get(message.id); if (!request) return; requests.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); });
    worker.on('error', error => { for (const request of requests.values()) request.reject(error); requests.clear(); });
  };
  const call = (method, ...args) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
  const ingest = (messageId, content, conversationId = 'a') => call('ingest', 'user', content, { messageId, conversationId });
  try {
    open();
    await ingest('1', 'My favorite automobile is an electric vehicle.');
    await ingest('1', 'My favorite automobile is an electric vehicle.');
    assert.equal((await call('stats', 'a')).activeMemories, 1);
    await ingest('2', 'I live in Paris.');
    await ingest('3', 'I now live in Toronto.');
    await ingest('4', 'My favorite automobile is a private blue truck.', 'b');
    const page = await call('list', 50, 0);
    assert.ok(page.items.some(node => node.content.includes('Toronto')));
    assert.ok(!page.items.some(node => node.content.includes('Paris')));
    const recall = await call('recall', 'Which car do I prefer?', 1000, 'a');
    assert.ok(recall.some(node => node.content.includes('electric vehicle')));
    assert.ok(recall.every(node => node.conversationId === 'a'));
    const excluded = await call('recall', 'Which car do I prefer?', 1000, 'a', ['1']);
    assert.ok(!excluded.some(node => node.sourceMessageId === '1'));
    await call('close'); await worker.terminate();
    // Upgrade vectors from a prior external embedding format without losing stored statements.
    const database = new DatabaseSync(config.dbPath);
    database.prepare('UPDATE ofs_memories SET embedding = ?').run(new Uint8Array(new Float32Array(384).buffer));
    database.exec("DELETE FROM ofs_metadata WHERE key = 'encoding'"); database.close();
    open(); assert.equal((await call('stats', 'a')).activeMemories, 2);
    assert.ok((await call('recall', 'Which car do I prefer?', 1000, 'a')).some(node => node.content.includes('electric vehicle')));
    await call('remove', 'a'); assert.equal((await call('stats', 'a')).activeMemories, 0);
    assert.equal((await call('stats', 'b')).activeMemories, 1);
    await call('close'); await worker.terminate();
  } finally { if (worker) await worker.terminate(); await fs.rm(root, { recursive: true, force: true }); }
});

test('llama dispose terminates a real managed child and its process tree', async () => {
  const { LlamaManager } = require('../dist/main/llama.js');
  const manager = new LlamaManager(os.tmpdir(), () => {});
  const child = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const nested=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); console.log(nested.pid); setInterval(()=>{},1000);`], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let nestedPid;
  try {
    let timer;
    try { const data = await Promise.race([once(child.stdout, 'data'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test child failed to start')), 5000); })]); nestedPid = Number(String(data[0]).trim()); }
    finally { clearTimeout(timer); }
    assert.ok(nestedPid > 0);
    manager.process = child;
    await manager.dispose();
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'managed child should exit or report its termination signal');
    // taskkill /T must clean the descendant on Windows, where detached groups are unavailable.
    if (process.platform === 'win32') assert.throws(() => process.kill(nestedPid, 0));
  } finally { child.kill('SIGKILL'); if (nestedPid) { try { process.kill(nestedPid, 'SIGKILL'); } catch {} } }
});
