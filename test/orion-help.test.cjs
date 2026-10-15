const assert = require('node:assert/strict');
const test = require('node:test');
const { isOrionHelpQuestion, searchOrionHelp } = require('../dist/main/orionHelp.js');

test('Orion guide lookup returns concise relevant feature help', () => {
  const result = searchOrionHelp('How do I change the context limit in Orion?');
  assert.match(result, /context selector/i);
  assert.doesNotMatch(result, /Image and video generation:/);
  assert.ok(result.length < 4500);
});

test('Orion help detection only targets product questions', () => {
  assert.equal(isOrionHelpQuestion('How do I change memory settings in Orion?'), true);
  assert.equal(isOrionHelpQuestion('How do I write a JavaScript function?'), false);
});
