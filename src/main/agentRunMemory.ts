import { lexicalScores } from './memory';

type AgentMemoryAction = { name: string; args: Record<string, unknown>; output: string; success: boolean; at: number };
type AgentMemoryRun = { request: string; actions: AgentMemoryAction[]; checkpoint: string; updatedAt: number };

/** Short lived, in-process tool progress used only to compact long agent turns. */
export class AgentRunMemory {
  private agentRuns = new Map<string, AgentMemoryRun>();

  recordAgentAction(conversationId: string, runId: string, request: string, action: Omit<AgentMemoryAction, 'at'>) {
    const key = conversationId + ':' + runId;
    const run = this.agentRuns.get(key) ?? { request: request.slice(0, 8000), actions: [], checkpoint: '', updatedAt: Date.now() };
    run.request = request.slice(0, 8000);
    run.actions.push({ ...action, at: Date.now(), args: JSON.parse(JSON.stringify(action.args)) as Record<string, unknown>, output: action.output.slice(0, 4000) });
    if (run.actions.length > 64) run.actions.splice(0, run.actions.length - 64);
    run.updatedAt = Date.now(); this.agentRuns.set(key, run);
  }

  createAgentCheckpoint(conversationId: string, runId: string, request: string, checkpoint: { reason: string; elapsedMs: number; actionsSinceCheckpoint: number }, maxCharacters = 1800) {
    const key = conversationId + ':' + runId;
    const run = this.agentRuns.get(key) ?? { request: request.slice(0, 8000), actions: [], checkpoint: '', updatedAt: Date.now() };
    run.request = request.slice(0, 8000);
    const scores = lexicalScores(run.request, run.actions.map(item => item.name + ' ' + JSON.stringify(item.args) + ' ' + item.output));
    const candidates = run.actions.map((item, index) => ({ item, index, score: scores[index] ?? 0 }));
    const retrieved = candidates.sort((a, b) => (b.score + b.index / Math.max(1, run.actions.length) * 0.15) - (a.score + a.index / Math.max(1, run.actions.length) * 0.15)).slice(0, 5);
    const recent = run.actions.slice(-2);
    const actions = [...new Map([...retrieved.map(row => row.item), ...recent].map(item => [item.at + ':' + item.name, item])).values()];
    const header = 'Focus checkpoint (progress only; no new model context was generated).';
    const task = 'Task: ' + run.request.replace(/\s+/g, ' ').slice(0, 260);
    const progress = actions.map(item => {
      const args = JSON.stringify(item.args).replace(/\s+/g, ' ').slice(0, 110);
      const output = item.output.replace(/\s+/g, ' ').slice(0, 150);
      return '- ' + (item.success ? 'Done' : 'Failed') + ' ' + item.name + '(' + args + '): ' + output;
    });
    const next = 'Resume from the next unfinished part of the task. Re-read the user request and current system instructions, trust these recorded results, and do not repeat completed actions.';
    let summary = [header, task, 'Recent verified actions (' + checkpoint.actionsSinceCheckpoint + ' since prior checkpoint):', ...progress, next].join('\n');
    if (summary.length > maxCharacters) summary = summary.slice(0, Math.max(0, maxCharacters - 1)).trimEnd() + '…';
    run.checkpoint = summary; run.updatedAt = Date.now(); this.agentRuns.set(key, run);
    return run.checkpoint;
  }

  clearAgentRun(conversationId: string, runId: string) { this.agentRuns.delete(conversationId + ':' + runId); }
}
