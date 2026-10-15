const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeLocal, extractLocal } = require('../ofs-local.ts');
const similarity = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

test('local representations connect supported paraphrases and separate unrelated topics', () => {
  const memory = encodeLocal('My favorite automobile is an electric vehicle');
  assert.ok(similarity(memory, encodeLocal('Which car do I prefer?')) > similarity(memory, encodeLocal('Configure the SQLite database cache')) + 0.15);
  assert.deepEqual(encodeLocal('東京 project Ω'), encodeLocal('東京 project Ω'));
  assert.ok([...memory].every(Number.isFinite));
});
test('statement capture preserves attribution and does not invent user facts from assistant replies', () => {
  const knowledge = extractLocal('Your favorite car might be a Volvo.', 'assistant');
  assert.equal(knowledge.facts[0].type, 'episodic');
  assert.equal(knowledge.facts[0].content, 'Assistant: Your favorite car might be a Volvo.');
  assert.equal(knowledge.facts[0].supersedesEntityAttribute, undefined);
  const state = extractLocal('I now live in Toronto.', 'user').facts[0];
  assert.equal(state.supersedesEntityAttribute.attribute, 'live in');
});
test('long turns remain represented across bounded local nodes', () => {
  const text = 'A'.repeat(2000) + ' important final decision is to use Bun';
  const knowledge = extractLocal(text);
  assert.ok(knowledge.facts.some(fact => fact.content.includes('important final decision')));
  assert.ok(knowledge.facts.every(fact => fact.content.length <= 1411));
});
