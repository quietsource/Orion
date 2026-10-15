export type ContextBudgetPlan = {
  outputReserveTokens: number;
  toolHistoryReserveTokens: number;
  memoryBudgetTokens: number;
};

export const MEMORY_CONTEXT_FRACTION = 0.4;
export const RECENT_CONTEXT_FRACTION = 0.32;

export function planRecentPromptBudget(input: {
  contextTokens: number;
  systemPromptTokens: number;
  summaryPromptTokens: number;
  toolSchemaPromptTokens?: number;
  toolsEnabled: boolean;
}) {
  const contextTokens = Math.max(0, Math.floor(input.contextTokens));
  const reserves = planContextBudget({ ...input, recentPromptTokens: 0 });
  const fixedTokens = Math.max(0, input.systemPromptTokens) +
    Math.max(0, input.summaryPromptTokens) + Math.max(0, input.toolSchemaPromptTokens ?? 0);
  const available = Math.max(0, contextTokens - fixedTokens - reserves.outputReserveTokens - reserves.toolHistoryReserveTokens - 64);
  return Math.min(Math.floor(contextTokens * RECENT_CONTEXT_FRACTION), available);
}

export function planContextBudget(input: {
  contextTokens: number;
  recentPromptTokens: number;
  systemPromptTokens: number;
  summaryPromptTokens: number;
  toolSchemaPromptTokens?: number;
  toolsEnabled: boolean;
}): ContextBudgetPlan {
  const contextTokens = Math.max(0, Math.floor(input.contextTokens));
  // Reserve enough room for long-form answers, including code. The old 15%
  // cap limited an 8K context to roughly 1.2K generated tokens.
  const outputReserveTokens = Math.max(512, Math.min(32_768, Math.floor(contextTokens * 0.45)));
  // Keep enough of the prompt budget for live tool responses so small local
  // models can read an inspected file before deciding to inspect it again.
  const toolHistoryReserveTokens = input.toolsEnabled ? Math.floor(contextTokens * 0.1) : 0;
  const fixedPromptTokens = Math.max(0, input.recentPromptTokens) +
    Math.max(0, input.systemPromptTokens) + Math.max(0, input.summaryPromptTokens);
  const toolSchemaPromptTokens = Math.max(0, input.toolSchemaPromptTokens ?? 0);
  const memoryBudgetTokens = Math.min(
    Math.floor(contextTokens * MEMORY_CONTEXT_FRACTION),
    Math.max(0, contextTokens - fixedPromptTokens - toolSchemaPromptTokens - outputReserveTokens - toolHistoryReserveTokens - 64)
  );
  return { outputReserveTokens, toolHistoryReserveTokens, memoryBudgetTokens };
}
