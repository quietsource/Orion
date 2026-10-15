import { parseTextToolCalls } from './native-tools';
import type { OrionSubagentRole } from './subagents';
import { SUBAGENT_PROMPTS } from './subagents';

type Tool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
type ToolCall = { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } };

/** Run an isolated, bounded, read-only local research/review turn. */
export async function runSubagentInference(input: {
  role: OrionSubagentRole;
  task: string;
  baseUrl: string;
  workspaceTools: Tool[];
  workspace: string;
  memoryText: string;
  diffText: string;
  executeReadTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}) {
  const roleTask = input.role === 'quality_control' ? 'Review focus: ' : 'Research question: ';
  const userContent = [
    roleTask + input.task.slice(0, 3000),
    input.workspace ? 'Workspace root: ' + input.workspace : '',
    input.memoryText ? 'Relevant Orion memory excerpts:\n' + input.memoryText.slice(0, 5000) : '',
    input.role === 'quality_control' ? 'Current private workspace diff:\n' + (input.diffText || 'No staged changes are available.') : '',
    'Use read-only tools selectively. Ground claims in evidence. Return a concise result.'
  ].filter(Boolean).join('\n\n');
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SUBAGENT_PROMPTS[input.role] },
    { role: 'user', content: userContent },
  ];
  const allowed = new Set(input.workspaceTools.map(tool => tool.function.name));
  let finalText = '';
  for (let round = 0; round < 8; round++) {
    const response = await fetch(input.baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'orion-local', messages, tools: input.workspaceTools,
        ...(input.workspaceTools.length ? { tool_choice: 'auto' } : {}),
        temperature: 0.15, max_tokens: 1000, stream: false,
      }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(8 * 60_000)]),
    });
    if (!response.ok) throw new Error('Local subagent inference failed (' + response.status + '): ' + (await response.text()).slice(0, 700));
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; tool_calls?: ToolCall[] } }> };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error('The local subagent returned an empty response.');
    const text = typeof message.content === 'string' ? message.content : '';
    let calls = message.tool_calls ?? [];
    if (!calls.length && input.workspaceTools.length) {
      const parsed = parseTextToolCalls(text, input.workspaceTools);
      if (parsed.calls.length) {
        finalText = parsed.visibleText;
        calls = parsed.calls.map(call => ({ id: crypto.randomUUID(), function: { name: call.name, arguments: call.arguments } }));
      }
    }
    if (!calls.length) { finalText = text || finalText; break; }
    messages.push({ role: 'assistant', content: text || null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name ?? '';
      if (!allowed.has(name)) {
        messages.push({ role: 'tool', tool_call_id: call.id ?? crypto.randomUUID(), content: 'Rejected: subagents only have read-only tools.' });
        continue;
      }
      let args: Record<string, unknown> = {};
      try { args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) as Record<string, unknown> : call.function?.arguments ?? {}; }
      catch { /* Invalid arguments stay empty and are safely rejected by the read tool. */ }
      const result = await input.executeReadTool(name, args);
      messages.push({ role: 'tool', tool_call_id: call.id ?? crypto.randomUUID(), content: result.slice(0, 4000) });
    }
    input.onProgress((input.role === 'research' ? 'Researching project evidence' : 'Reviewing workspace changes') + ' · step ' + (round + 1));
  }
  return finalText.trim() || 'The subagent reached its eight-step research limit. Review the evidence it gathered.';
}
