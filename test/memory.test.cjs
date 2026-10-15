const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MemoryEngine } = require('../dist/main/memory.js');

function unitVector(axis, score = 1, background = 0) {
  const values = Array(8).fill(background);
  values[axis] = score;
  const remaining = Math.sqrt(Math.max(0, 1 - values.reduce((sum, value) => sum + value * value, 0)));
  values[axis + 4] = remaining;
  return values;
}

function fakeEmbedding(input) {
  const normalized = input.toLocaleLowerCase();
  if (normalized.startsWith('task: search result')) {
    if (normalized.includes('charger')) return unitVector(0);
    if (normalized.includes('sign off')) return unitVector(1);
    if (normalized.includes('bicycle')) return unitVector(2);
    if (normalized.includes('meeting room carpet')) return unitVector(3);
  }
  if (normalized.includes('prototype battery')) return unitVector(0, 0.288, 0.05);
  if (normalized.includes('legal team')) return unitVector(1, 0.334, 0.05);
  if (normalized.includes('graphite dark interface')) return unitVector(2, 0.267, 0.05);
  if (normalized.includes('amber status light')) return unitVector(2, 0.267, 0.05);
  return unitVector(0, 0.16, 0.03);
}

test('memory recovers distinctive paraphrases without returning weak unrelated matches', async t => {
  const originalFetch = global.fetch;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-memory-test-'));
  t.after(async () => {
    global.fetch = originalFetch;
    await fs.promises.rm(userData, { recursive: true, force: true });
  });

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return Response.json({ models: [{ name: 'embeddinggemma:latest', capabilities: ['embedding'] }] });
    }
    if (String(url).endsWith('/api/embed')) {
      const body = JSON.parse(options.body);
      return Response.json({ embeddings: body.input.map(fakeEmbedding), prompt_eval_count: body.input.length * 40 });
    }
    throw new Error(`Unexpected network request in memory test: ${url}`);
  };

  const now = Date.now();
  const conversation = {
    id: 'recall-test', title: 'Recall test', model: 'local-test', createdAt: now, updatedAt: now + 4,
    messages: [
      { id: 'battery', role: 'user', createdAt: now, content: 'The prototype battery target is 14 hours of field operation.' },
      { id: 'legal', role: 'assistant', createdAt: now + 1, content: 'The draft should be reviewed by the legal team before external release.' },
      { id: 'interface', role: 'user', createdAt: now + 2, content: 'User prefers a graphite dark interface with no bright white panels.' },
      { id: 'indicator', role: 'user', createdAt: now + 3, content: 'The amber status light uses a triple pulse.' },
      { id: 'filler', role: 'assistant', createdAt: now + 4, content: 'Unrelated note: confirm delivery timing with the procurement team.' }
    ]
  };
  const engine = new MemoryEngine(userData);
  await engine.rebuildConversations([conversation], 'http://127.0.0.1:11434');
  await engine.ensureSemanticIndex('http://127.0.0.1:11434');

  const battery = await engine.retrieve('How long should the device run away from a charger?', 'http://127.0.0.1:11434', 1200);
  assert.ok(battery.some(chunk => chunk.messageId === 'battery'), 'a distinctive low-cosine paraphrase should survive the adaptive cutoff');

  const legal = await engine.retrieve('Who needs to sign off before we publish?', 'http://127.0.0.1:11434', 1200);
  assert.ok(legal.some(chunk => chunk.messageId === 'legal'), 'a paraphrased approval decision should be retrieved');

  const bicycle = await engine.retrieve('What color is my bicycle?', 'http://127.0.0.1:11434', 1200);
  assert.deepEqual(bicycle, [], 'a weak nearest neighbor should not be returned as a memory');

  const carpet = await engine.retrieve('What color is the meeting room carpet?', 'http://127.0.0.1:11434', 1200);
  assert.deepEqual(carpet, [], 'one generic overlapping word should not surface an unrelated color memory');

  const excluded = await engine.retrieve('How long should the device run away from a charger?', 'http://127.0.0.1:11434', 1200, new Set(['battery']));
  assert.ok(!excluded.some(chunk => chunk.messageId === 'battery'), 'messages already present in live context must stay excluded');
});

test('memory cap preserves conversation openings while staying within one million tokens', () => {
  const engine = new MemoryEngine(os.tmpdir());
  const chunks = Array.from({ length: 120 }, (_, index) => ({
    id: `conversation-${Math.floor(index / 10)}:message-${index}`,
    conversationId: `conversation-${Math.floor(index / 10)}`,
    title: `Conversation ${Math.floor(index / 10)}`,
    messageId: `message-${index}`,
    role: 'user',
    text: `Excerpt ${index}`,
    createdAt: index,
    tokens: 15_000
  }));
  const retained = engine.cap(chunks);
  const retainedIds = new Set(retained.map(chunk => chunk.id));
  assert.ok(retained.reduce((sum, chunk) => sum + chunk.tokens, 0) <= 1_000_000);
  for (let conversation = 0; conversation < 12; conversation++) {
    assert.ok(retainedIds.has(`conversation-${conversation}:message-${conversation * 10}`), `opening excerpt for conversation ${conversation} should be retained`);
  }
});

test('memory cap reserves a majority share for user-authored excerpts', () => {
  const engine = new MemoryEngine(os.tmpdir());
  const chunks = Array.from({ length: 100 }, (_, index) => ({
    id: `conversation:message-${index}`,
    conversationId: 'conversation',
    title: 'Conversation',
    messageId: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `Excerpt ${index}`,
    createdAt: index,
    tokens: 20_000
  }));
  const retained = engine.cap(chunks);
  const userMessages = retained.filter(chunk => chunk.role === 'user').length;
  const assistantMessages = retained.filter(chunk => chunk.role === 'assistant').length;
  assert.ok(retained.reduce((sum, chunk) => sum + chunk.tokens, 0) <= 1_000_000);
  assert.ok(userMessages > assistantMessages, 'more of the capped archive should come from user-authored statements');
});
