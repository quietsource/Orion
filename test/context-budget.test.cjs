const assert = require('node:assert/strict');
const test = require('node:test');
const { planContextBudget, planRecentPromptBudget } = require('../dist/main/contextBudget.js');

test('context planner reserves output and tool history before allocating memory', () => {
  const plan = planContextBudget({
    contextTokens: 8192,
    recentPromptTokens: 2000,
    systemPromptTokens: 600,
    summaryPromptTokens: 200,
    toolsEnabled: true
  });
  assert.equal(plan.outputReserveTokens, 3686);
  assert.equal(plan.toolHistoryReserveTokens, 819);
  assert.equal(plan.memoryBudgetTokens, 823);
  assert.ok(2000 + 600 + 200 + plan.memoryBudgetTokens + plan.outputReserveTokens + plan.toolHistoryReserveTokens + 64 <= 8192);
});

test('context planner never gives memories space after fixed prompt content consumes the budget', () => {
  const plan = planContextBudget({
    contextTokens: 4096,
    recentPromptTokens: 2800,
    systemPromptTokens: 1000,
    summaryPromptTokens: 200,
    toolsEnabled: false
  });
  assert.equal(plan.memoryBudgetTokens, 0);
  assert.equal(plan.toolHistoryReserveTokens, 0);
});

test('context planner reserves Ollama tool-schema tokens before assigning memory', () => {
  const plan = planContextBudget({
    contextTokens: 8192,
    recentPromptTokens: 1000,
    systemPromptTokens: 600,
    summaryPromptTokens: 200,
    toolSchemaPromptTokens: 1300,
    toolsEnabled: true
  });
  assert.equal(plan.memoryBudgetTokens, 523);
  assert.ok(1000 + 600 + 200 + 1300 + plan.memoryBudgetTokens + plan.outputReserveTokens + plan.toolHistoryReserveTokens + 64 <= 8192);
});

test('recent prompt allowance shrinks when tool schemas and fixed instructions need room', () => {
  const recentTokens = planRecentPromptBudget({
    contextTokens: 8192,
    systemPromptTokens: 600,
    summaryPromptTokens: 200,
    toolSchemaPromptTokens: 2500,
    toolsEnabled: true
  });
  assert.equal(recentTokens, 512);
  assert.ok(recentTokens + 600 + 200 + 2500 + 3497 + 819 + 64 <= 8192);
});

test('small contexts preserve room for the newest user request before reserving output', () => {
  const recentTokens = planRecentPromptBudget({
    contextTokens: 4096,
    systemPromptTokens: 900,
    summaryPromptTokens: 0,
    toolSchemaPromptTokens: 1800,
    toolsEnabled: true
  });
  assert.ok(recentTokens >= 256);
});
