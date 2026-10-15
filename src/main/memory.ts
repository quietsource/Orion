import fs from 'node:fs/promises';
import path from 'node:path';
import type { Conversation, Message } from '../shared/types';

export const MEMORY_LIMIT_TOKENS = 1_000_000;
// Keep a bounded staging buffer until Ollama has measured the actual input
// tokens. Character estimates can be materially high for English and low for
// code or non-Latin scripts, so applying the final cap before embedding would
// discard useful history prematurely.
const MEMORY_STAGING_LIMIT_TOKENS = MEMORY_LIMIT_TOKENS * 2;
export type MemoryChunk = { id: string; conversationId: string; title: string; messageId: string; role: string; text: string; createdAt: number; tokens: number; embeddingModel?: string; embeddingFormat?: string; embedding?: number[] };
type MemoryFile = { version: 1; chunks: MemoryChunk[] };
type OllamaModel = { name: string; capabilities?: string[] };

const stopWords = new Set('a an and are as at be but by can did do does for from had has have he her hers him his how i if in into is it its me my of on or our ours she so than that the their theirs them then there these they this those to too up us user assistant was we were what when where which who why will with would you your yours'.split(' '));
const terms = (text: string): string[] => (text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).filter(term => !stopWords.has(term));
const tokenEstimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));
export function lexicalScores(query: string, documents: string[]) {
  return lexicalSearch(query, documents).scores;
}
function lexicalSearch(query: string, documents: string[]) {
  const queryTerms = terms(query); if (!queryTerms.length || !documents.length) return { scores: documents.map(() => 0), matchedTerms: documents.map(() => 0), queryTerms };
  const tokenized = documents.map(text => terms(text)); const averageLength = Math.max(1, tokenized.reduce((sum, row) => sum + row.length, 0) / tokenized.length);
  const frequencies = new Map<string, number>();
  for (const term of new Set<string>(queryTerms)) frequencies.set(term, tokenized.reduce<number>((n, row) => n + (row.includes(term) ? 1 : 0), 0));
  const scores = tokenized.map((row, i) => {
    const counts = new Map<string, number>(); for (const term of row) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0; if (!tf) continue;
      const df = frequencies.get(term) ?? 0; const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * row.length / averageLength));
    }
    const normalizedQuery = query.toLocaleLowerCase().trim();
    const text = documents[i]?.toLocaleLowerCase() ?? '';
    if (normalizedQuery.length >= 8 && text.includes(normalizedQuery)) score += 2.5;
    return score;
  });
  const queryTermSet = new Set(queryTerms);
  const matchedTerms = tokenized.map(row => {
    const documentTerms = new Set(row);
    return [...queryTermSet].filter(term => documentTerms.has(term)).length;
  });
  return { scores, matchedTerms, queryTerms };
}
const cosine = (a?: number[], b?: number[]) => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};
function makeChunks(text: string, maxChars = 1500, overlap = 180) {
  const normalized = text.replace(/\r\n/g, '\n').trim(); if (!normalized) return [];
  const chunks: string[] = []; let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const split = Math.max(normalized.lastIndexOf('\n\n', end), normalized.lastIndexOf('\n', end), normalized.lastIndexOf('. ', end));
      if (split > start + maxChars * 0.55) end = split + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
function conversationChunks(conversation: Conversation, prior: MemoryChunk[]) {
  const previous = new Map(prior.map(chunk => [chunk.id, chunk]));
  const generated: MemoryChunk[] = [];
  const pushText = (messageId: string, role: string, text: string, createdAt: number) => {
    makeChunks(text).forEach((chunk, i) => {
      const id = conversation.id + ':' + messageId + ':' + i;
      const old = previous.get(id);
      generated.push({ id, conversationId: conversation.id, title: conversation.title, messageId, role, text: chunk, createdAt, tokens: tokenEstimate(chunk), ...(old?.text === chunk ? { embeddingModel: old.embeddingModel, embeddingFormat: old.embeddingFormat, embedding: old.embedding } : {}) });
    });
  };
  for (const message of conversation.messages) {
    pushText(message.id, message.role, message.content, message.createdAt);
    if (message.toolCalls?.length) for (const call of message.toolCalls) {
      pushText(message.id + ':tool:' + call.id, 'tool', call.name + '\n' + JSON.stringify(call.input) + '\n' + (call.output ?? ''), message.createdAt);
    }
  }
  if (conversation.summary) pushText('rolling-summary', 'summary', conversation.summary, conversation.updatedAt);
  return generated;
}

type AgentMemoryAction = { name: string; args: Record<string, unknown>; output: string; success: boolean; at: number };
type AgentMemoryRun = { request: string; actions: AgentMemoryAction[]; checkpoint: string; updatedAt: number };

export class MemoryEngine {
  private file: string;
  private agentRuns = new Map<string, AgentMemoryRun>();
  private queue: Promise<unknown> = Promise.resolve();
  private embeddingQueue: Promise<void> = Promise.resolve();
  private embeddingRetryTimer: NodeJS.Timeout | null = null;
  private embeddingRetryBaseUrl = '';
  private cachedIndex: MemoryFile | null = null;
  private indexRead: Promise<MemoryFile> | null = null;
  private recoveryWarning: string | null = null;
  private embeddingModels = new Map<string, { model: string; expiresAt: number }>();
  private paused = false;
  private embeddingAbort = new AbortController();
  setPaused(paused: boolean) { this.paused = paused; if (paused) { this.cancelEmbeddingRetry(); this.embeddingAbort.abort(); } else if (this.embeddingAbort.signal.aborted) this.embeddingAbort = new AbortController(); }
  constructor(userDataPath: string) { this.file = path.join(userDataPath, 'orion', 'memory-index.json'); }

  /** Store per-turn agent progress in Orion's bounded in-memory memory layer. */
  recordAgentAction(conversationId: string, runId: string, request: string, action: Omit<AgentMemoryAction, 'at'>) {
    const key = conversationId + ':' + runId;
    const run = this.agentRuns.get(key) ?? { request: request.slice(0, 8000), actions: [], checkpoint: '', updatedAt: Date.now() };
    run.request = request.slice(0, 8000);
    run.actions.push({ ...action, at: Date.now(), args: JSON.parse(JSON.stringify(action.args)) as Record<string, unknown>, output: action.output.slice(0, 4000) });
    if (run.actions.length > 64) run.actions.splice(0, run.actions.length - 64);
    run.updatedAt = Date.now(); this.agentRuns.set(key, run);
  }
  /** Create a compact checkpoint through Orion memory and retrieve only its bounded summary. */
  createAgentCheckpoint(conversationId: string, runId: string, request: string, checkpoint: { reason: string; elapsedMs: number; actionsSinceCheckpoint: number }, maxCharacters = 1800) {
    const key = conversationId + ':' + runId;
    const run = this.agentRuns.get(key) ?? { request: request.slice(0, 8000), actions: [], checkpoint: '', updatedAt: Date.now() };
    run.request = request.slice(0, 8000);
    const scores = lexicalScores(run.request, run.actions.map(item => item.name + ' ' + JSON.stringify(item.args) + ' ' + item.output));
    const candidates = run.actions.map((item, index) => ({ item, index, score: scores[index] ?? 0 }));
    const retrieved = candidates.sort((a, b) => (b.score + b.index / Math.max(1, run.actions.length) * 0.15) - (a.score + a.index / Math.max(1, run.actions.length) * 0.15)).slice(0, 5);
    const recent = run.actions.slice(-2);
    const actions = [...new Map([...retrieved.map(row => row.item), ...recent].map(item => [item.at + ':' + item.name, item])).values()];
    const header = 'Focus checkpoint from Orion Memory (progress only; no new model context was generated).';
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
  private async read(): Promise<MemoryFile> {
    if (this.cachedIndex) return this.cachedIndex;
    if (this.indexRead) return this.indexRead;
    const operation = (async (): Promise<MemoryFile> => {
      let contents: string;
      try { contents = await fs.readFile(this.file, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.cachedIndex = { version: 1, chunks: [] };
        throw error;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(contents); }
      catch { return this.preserveDamagedIndex('The memory index contained invalid JSON.'); }
      if (!this.isMemoryFile(parsed)) return this.preserveDamagedIndex('The memory index had an unsupported or invalid structure.');
      return this.cachedIndex = parsed;
    })();
    this.indexRead = operation;
    try { return await operation; }
    finally { if (this.indexRead === operation) this.indexRead = null; }
  }
  private isMemoryFile(value: unknown): value is MemoryFile {
    if (!value || typeof value !== 'object') return false;
    const file = value as Partial<MemoryFile>;
    return file.version === 1 && Array.isArray(file.chunks) && file.chunks.every(chunk =>
      !!chunk && typeof chunk.id === 'string' && typeof chunk.conversationId === 'string' &&
      typeof chunk.messageId === 'string' && typeof chunk.text === 'string' &&
      typeof chunk.role === 'string' && typeof chunk.title === 'string' &&
      Number.isFinite(chunk.tokens) && chunk.tokens >= 0 && Number.isFinite(chunk.createdAt) &&
      (chunk.embedding === undefined || Array.isArray(chunk.embedding)) &&
      (chunk.embeddingModel === undefined || typeof chunk.embeddingModel === 'string') &&
      (chunk.embeddingFormat === undefined || typeof chunk.embeddingFormat === 'string')
    );
  }
  private async preserveDamagedIndex(reason: string): Promise<MemoryFile> {
    const backup = `${this.file}.corrupt-${Date.now()}-${crypto.randomUUID()}.json`;
    await fs.rename(this.file, backup);
    this.recoveryWarning = `${reason} The original was preserved at ${backup}; Orion is rebuilding memory from saved conversations.`;
    console.error(`Orion: ${this.recoveryWarning}`);
    return this.cachedIndex = { version: 1, chunks: [] };
  }
  private async write(index: MemoryFile) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(index), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, this.file);
      this.cachedIndex = index;
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  async stats(conversationId?: string) {
    const index = await this.read();
    const chunks = conversationId !== undefined ? index.chunks.filter(chunk => chunk.conversationId === conversationId) : index.chunks;
    return { indexedTokens: chunks.reduce((n, c) => n + c.tokens, 0), limitTokens: MEMORY_LIMIT_TOKENS, chunks: chunks.length, embeddedChunks: chunks.filter(c => !!c.embedding).length, embeddingModel: chunks.find(c => c.embeddingModel)?.embeddingModel ?? null, semantic: chunks.some(c => !!c.embedding), recoveryWarning: this.recoveryWarning };
  }
  private async enforceTokenCap(limitTokens = MEMORY_LIMIT_TOKENS) {
    const operation = this.queue.then(async () => {
      const latest = await this.read();
      const capped = this.cap(latest.chunks, limitTokens);
      const unchanged = capped.length === latest.chunks.length && capped.every((chunk, index) => {
        const current = latest.chunks[index];
        return current?.id === chunk.id && current.tokens === chunk.tokens;
      });
      if (!unchanged) await this.write({ version: 1, chunks: capped });
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
  private async chooseEmbeddingModel(baseUrl: string, existing: MemoryChunk[]) {
    const cached = this.embeddingModels.get(baseUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.model;
    const current = existing.find(c => c.embeddingModel)?.embeddingModel;
    try {
      if (this.paused) return null;
      const response = await fetch(baseUrl + '/api/tags', { signal: AbortSignal.any([this.embeddingAbort.signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) { const model = current ?? ''; this.embeddingModels.set(baseUrl, { model, expiresAt: Date.now() + 300_000 }); return model; }
      const models = ((await response.json()) as { models?: OllamaModel[] }).models ?? [];
      const known = models.find(m => m.name === current);
      if (known) { this.embeddingModels.set(baseUrl, { model: known.name, expiresAt: Date.now() + 300_000 }); return known.name; }
      // Prefer Ollama's advertised capability so new embedding models work
      // without Orion needing a release for every model name. Keep known name
      // matching for Ollama versions that do not return capabilities.
      const embedding = models.find(m => m.capabilities?.includes('embedding')) ??
        models.find(m => /nomic-embed|mxbai-embed|all-minilm|snowflake-arctic-embed|bge-|embeddinggemma|granite-embedding/i.test(m.name));
      const model = embedding?.name ?? '';
      this.embeddingModels.set(baseUrl, { model, expiresAt: Date.now() + 300_000 });
      return model;
    } catch { const model = current ?? ''; this.embeddingModels.set(baseUrl, { model, expiresAt: Date.now() + 300_000 }); return model; }
  }
  private async embed(baseUrl: string, model: string, texts: string[]): Promise<{ embeddings: number[][]; promptEvalCount?: number } | null> {
    if (!texts.length || !model) return { embeddings: [] };
    try {
      if (this.paused) return null;
      const response = await fetch(baseUrl + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts }), signal: AbortSignal.any([this.embeddingAbort.signal, AbortSignal.timeout(60000)]) });
      if (!response.ok) return null;
      const data = await response.json() as { embeddings?: number[][]; prompt_eval_count?: number };
      return Array.isArray(data.embeddings) && data.embeddings.length === texts.length
        ? { embeddings: data.embeddings, ...(Number.isFinite(data.prompt_eval_count) ? { promptEvalCount: data.prompt_eval_count } : {}) }
        : null;
    } catch { return null; }
  }
  private embeddingFormat(model: string) { return /embeddinggemma/i.test(model) ? 'embeddinggemma-retrieval-v1' : 'raw-v1'; }
  private embeddingDocument(model: string, chunk: MemoryChunk) {
    return this.embeddingFormat(model) === 'embeddinggemma-retrieval-v1'
      ? `title: ${chunk.title || 'none'} | text: [${chunk.role}] ${chunk.text}`
      : chunk.text;
  }
  private embeddingQuery(model: string, query: string) {
    return this.embeddingFormat(model) === 'embeddinggemma-retrieval-v1'
      ? `task: search result | query: ${query}`
      : query;
  }
  indexConversation(conversation: Conversation, baseUrl: string) {
    const operation = this.queue.then(() => this.indexConversationLocked(conversation, baseUrl));
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  rebuildConversations(conversations: Conversation[], baseUrl: string, onProgress: (completed: number) => void = () => undefined) {
    const operation = this.queue.then(async () => {
      const index = await this.read();
      const priorByConversation = new Map<string, MemoryChunk[]>();
      for (const chunk of index.chunks) {
        const entries = priorByConversation.get(chunk.conversationId) ?? [];
        entries.push(chunk); priorByConversation.set(chunk.conversationId, entries);
      }
      const generated: MemoryChunk[] = [];
      for (let i = 0; i < conversations.length; i++) {
        const conversation = conversations[i]!;
        generated.push(...conversationChunks(conversation, priorByConversation.get(conversation.id) ?? []));
        onProgress(i + 1);
      }
      const conversationIds = new Set(conversations.map(conversation => conversation.id));
      const retained = this.cap([...index.chunks.filter(chunk => !conversationIds.has(chunk.conversationId)), ...generated], MEMORY_STAGING_LIMIT_TOKENS);
      const unchanged = retained.length === index.chunks.length && retained.every((chunk, i) => {
        const old = index.chunks[i];
        return old?.id === chunk.id && old.text === chunk.text && old.role === chunk.role && old.title === chunk.title && old.createdAt === chunk.createdAt && old.tokens === chunk.tokens;
      });
      if (!unchanged) await this.write({ version: 1, chunks: retained });
      this.scheduleEmbeddings(baseUrl, generated);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  removeConversation(conversationId: string) {
    const operation = this.queue.then(async () => {
      const index = await this.read();
      await this.write({ version: 1, chunks: index.chunks.filter(chunk => chunk.conversationId !== conversationId) });
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  retainConversations(conversationIds: Set<string>) {
    const operation = this.queue.then(async () => {
      const index = await this.read();
      const chunks = index.chunks.filter(chunk => conversationIds.has(chunk.conversationId));
      if (chunks.length !== index.chunks.length) await this.write({ version: 1, chunks });
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async indexConversationLocked(conversation: Conversation, baseUrl: string) {
    const index = await this.read();
    const priorConversation = index.chunks.filter(c => c.conversationId === conversation.id);
    const prior = new Map(priorConversation.map(chunk => [chunk.id, chunk]));
    const generated = conversationChunks(conversation, priorConversation);
    const unchanged = generated.length === priorConversation.length && generated.every(chunk => {
      const old = prior.get(chunk.id);
      return old?.text === chunk.text && old.role === chunk.role && old.title === conversation.title && old.createdAt === chunk.createdAt;
    });
    if (unchanged) return;
    const others = index.chunks.filter(c => c.conversationId !== conversation.id);
    const retained = this.cap([...others, ...generated], MEMORY_STAGING_LIMIT_TOKENS);
    await this.write({ version: 1, chunks: retained });
    // Save lexical chunks before doing any model work. A slow or unavailable
    // embedding endpoint must never leave a newly saved conversation unindexed.
    this.scheduleEmbeddings(baseUrl, generated);
  }
  private cap(chunks: MemoryChunk[], limitTokens = MEMORY_LIMIT_TOKENS) {
    const byConversation = new Map<string, MemoryChunk[]>();
    for (const chunk of chunks) {
      const group = byConversation.get(chunk.conversationId) ?? [];
      group.push(chunk);
      byConversation.set(chunk.conversationId, group);
    }
    // Reserve each conversation's opening excerpt first. For archives larger
    // than the cap, sample the remaining timeline at even intervals; a pure
    // newest-first cap would erase the middle of long conversations before
    // the embedding model has a chance to index or retrieve it.
    const openings = [...byConversation.values()]
      .map(group => [...group].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]!)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const newestFirst = [...chunks].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const retained: MemoryChunk[] = [];
    const retainedIds = new Set<string>();
    let total = 0;
    const keep = (chunk: MemoryChunk) => {
      if (retainedIds.has(chunk.id) || total + chunk.tokens > limitTokens) return;
      retained.push(chunk);
      retainedIds.add(chunk.id);
      total += chunk.tokens;
    };
    for (const chunk of openings) keep(chunk);
    const remaining = newestFirst.filter(chunk => !retainedIds.has(chunk.id));
    const sampleWithinBudget = (candidates: MemoryChunk[], budgetEnd: number) => {
      const availableTokens = Math.max(0, Math.min(limitTokens, budgetEnd) - total);
      if (!candidates.length || availableTokens <= 0) return;
      const remainingTokens = candidates.reduce((sum, chunk) => sum + chunk.tokens, 0);
      const keepWithinBudget = (chunk: MemoryChunk) => {
        if (total + chunk.tokens <= budgetEnd) keep(chunk);
      };
      if (remainingTokens <= availableTokens) {
        for (const chunk of candidates) keepWithinBudget(chunk);
        return;
      }
      const averageTokens = remainingTokens / candidates.length;
      const sampleCount = Math.min(candidates.length, Math.max(1, Math.floor(availableTokens / averageTokens)));
      const interval = candidates.length / sampleCount;
      const sampled = new Set<string>();
      for (let i = 0; i < sampleCount; i++) {
        const index = Math.min(candidates.length - 1, Math.floor((i + 0.5) * interval));
        const chunk = candidates[index];
        if (chunk) { keepWithinBudget(chunk); sampled.add(chunk.id); }
      }
      // Token counts vary across excerpts; use any space left by the uniform
      // sample for additional recent chunks without exceeding its share.
      for (const chunk of candidates) if (!sampled.has(chunk.id)) keepWithinBudget(chunk);
    };
    // Users' own statements are the primary source for preferences, decisions,
    // and facts they ask Orion to remember. Keep a majority share for those
    // excerpts, then use the rest for assistant replies and tool history.
    sampleWithinBudget(remaining.filter(chunk => chunk.role === 'user'), Math.floor(limitTokens * 0.6));
    sampleWithinBudget(remaining.filter(chunk => chunk.role !== 'user'), limitTokens);
    return retained.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  private scheduleEmbeddings(baseUrl: string, generated: MemoryChunk[]) {
    if (!generated.length) return;
    this.embeddingQueue = this.embeddingQueue.then(async () => {
      const complete = await this.enrichEmbeddings(baseUrl, generated);
      if (complete) this.cancelEmbeddingRetry();
      else this.queueEmbeddingRetry(baseUrl);
    }).catch(error => {
      console.error('Orion semantic memory indexing failed:', error);
      this.queueEmbeddingRetry(baseUrl);
    });
  }
  private cancelEmbeddingRetry() {
    if (this.embeddingRetryTimer) clearTimeout(this.embeddingRetryTimer);
    this.embeddingRetryTimer = null;
  }
  private queueEmbeddingRetry(baseUrl: string) {
    if (this.paused) return;
    this.embeddingRetryBaseUrl = baseUrl;
    if (this.embeddingRetryTimer) return;
    // Retry incomplete semantic indexing in the background. Lexical recall is
    // already available, so a missing or temporarily unavailable embedding
    // endpoint must not block chat or cause a rapid retry loop.
    this.embeddingRetryTimer = setTimeout(() => {
      this.embeddingRetryTimer = null;
      const retryBaseUrl = this.embeddingRetryBaseUrl;
      this.embeddingQueue = this.embeddingQueue.then(async () => {
        const chunks = (await this.read()).chunks;
        if (!chunks.length) return;
        const complete = await this.enrichEmbeddings(retryBaseUrl, chunks);
        if (complete) this.cancelEmbeddingRetry();
        else this.queueEmbeddingRetry(retryBaseUrl);
      }).catch(error => {
        console.error('Orion semantic memory retry failed:', error);
        this.queueEmbeddingRetry(retryBaseUrl);
      });
    }, 60_000);
    this.embeddingRetryTimer.unref();
  }
  private async enrichEmbeddings(baseUrl: string, generated: MemoryChunk[], onProgress: (completed: number, total: number) => void = () => undefined): Promise<boolean> {
    if (this.paused) return false;
    const existing = (await this.read()).chunks;
    const model = await this.chooseEmbeddingModel(baseUrl, existing);
    if (!model) {
      // The staging buffer allows exact Ollama counts to replace character
      // estimates. If no embedding model is available, keep lexical memory
      // bounded by the public cap using those estimates instead.
      await this.enforceTokenCap();
      return false;
    }
    // Embeddings from different models are not comparable. If the previously
    // selected embedding model was removed or changed, rebuild every vector in
    // the archive instead of letting an old first vector disable semantic
    // recall for all subsequent queries.
    const format = this.embeddingFormat(model);
    const pending = existing.filter(chunk => !chunk.embedding || chunk.embeddingModel !== model || chunk.embeddingFormat !== format);
    onProgress(0, pending.length);
    const staged = new Map<string, { text: string; embedding: number[]; tokens: number }>();
    const flush = async () => {
      if (!staged.size) return;
      const updates = new Map(staged);
      staged.clear();
      const operation = this.queue.then(async () => {
        const latest = await this.read();
        let changed = false;
        const chunks = latest.chunks.map(chunk => {
          const update = updates.get(chunk.id);
          if (!update || update.text !== chunk.text) return chunk;
          changed = true;
          return { ...chunk, tokens: update.tokens, embeddingModel: model, embeddingFormat: format, embedding: update.embedding };
        });
        if (changed) await this.write({ version: 1, chunks: this.cap(chunks, MEMORY_STAGING_LIMIT_TOKENS) });
      });
      this.queue = operation.catch(() => undefined);
      await operation;
    };
    for (let offset = 0; offset < pending.length; offset += 24) {
      if (this.paused) return false;
      const batch = pending.slice(offset, offset + 24);
      // Ollama reports prompt_eval_count for the whole /api/embed batch, which
      // cannot be apportioned accurately when excerpts contain code, CJK, or
      // very different amounts of title/role prefix text. Concurrent singleton
      // calls return an exact count for each excerpt and benchmark similarly to
      // one batch of 24 on local Ollama, so keep the concurrency bounded here.
      const results = await Promise.all(batch.map(chunk =>
        this.embed(baseUrl, model, [this.embeddingDocument(model, chunk)])
      ));
      if (results.some(result => !result?.embeddings[0])) {
        await flush();
        await this.enforceTokenCap();
        return false;
      }
      batch.forEach((chunk, index) => {
        const result = results[index]!;
        staged.set(chunk.id, {
          text: chunk.text,
          embedding: result.embeddings[0]!,
          tokens: result.promptEvalCount ?? chunk.tokens
        });
      });
      onProgress(Math.min(offset + batch.length, pending.length), pending.length);
      // Coalesce eight small Ollama batches into one atomic index write while
      // keeping partial migration progress durable if a later batch fails.
      if (((offset / 24) + 1) % 8 === 0) await flush();
    }
    await flush();
    // Every pending chunk has now been measured (or retained its fallback
    // estimate when Ollama omitted prompt_eval_count). Enforce the public cap
    // over the calibrated archive before reporting completion.
    await this.enforceTokenCap();
    return true;
  }
  async ensureSemanticIndex(baseUrl: string, onProgress: (completed: number, total: number) => void = () => undefined) {
    // A prior lexical-only pass may have cached "no embedding model" for five
    // minutes. Recheck tags after an explicit install before rebuilding vectors.
    this.embeddingModels.delete(baseUrl);
    const index = await this.read();
    const operation = this.embeddingQueue.then(() => this.enrichEmbeddings(baseUrl, index.chunks, onProgress));
    this.embeddingQueue = operation.then(() => undefined, error => { console.error('Orion semantic memory indexing failed:', error); });
    let complete: boolean;
    try { complete = await operation; }
    catch (error) { this.queueEmbeddingRetry(baseUrl); throw error; }
    if (!complete) this.queueEmbeddingRetry(baseUrl);
    const latest = (await this.read()).chunks;
    const model = await this.chooseEmbeddingModel(baseUrl, latest);
    if (!model) throw new Error('No Ollama embedding model is installed and available.');
    const format = this.embeddingFormat(model);
    const missing = latest.filter(chunk => chunk.text.trim() && (!chunk.embedding || chunk.embeddingModel !== model || chunk.embeddingFormat !== format)).length;
    if (missing) throw new Error(`Semantic indexing stopped with ${missing.toLocaleString()} conversation chunks still unindexed.`);
  }
  async retrieve(
    query: string,
    baseUrl: string,
    maxTokens: number,
    excludeMessageIds: ReadonlySet<string> = new Set(),
    promptTokenCost: (chunk: MemoryChunk) => number = chunk => chunk.tokens,
    conversationId?: string
  ) {
    const index = await this.read();
    // Recent messages are already present in the model's live context. Avoid
    // spending the archive budget returning those same messages as memories.
    const usable = index.chunks.filter(c => c.text.trim() && !excludeMessageIds.has(c.messageId) && (!conversationId || c.conversationId === conversationId));
    if (!usable.length) return [] as MemoryChunk[];
    const model = usable.find(c => c.embeddingModel)?.embeddingModel ?? '';
    const queryVectors = model ? await this.embed(baseUrl, model, [this.embeddingQuery(model, query)]) : null;
    const queryVector = queryVectors?.embeddings[0];
    const { scores: lexical, matchedTerms, queryTerms } = lexicalSearch(query, usable.map(c => c.text));
    const querySpecificTerms = [...query.matchAll(/[\p{Lu}][\p{L}\p{N}_-]{1,}|\p{N}[\p{L}\p{N}_-]*/gu)]
      .filter(match => match.index !== 0 || queryTerms.length === 1)
      .map(match => match[0].toLocaleLowerCase());
    const scored = usable.map((chunk, index) => {
      const semantic = queryVector && chunk.embeddingModel === model && chunk.embeddingFormat === this.embeddingFormat(model) ? cosine(queryVector, chunk.embedding) : 0;
      const lexicalScore = lexical[index] ?? 0;
      const normalizedLexical = lexicalScore / (lexicalScore + 2.5);
      const exactPhrase = query.trim().length >= 8 && chunk.text.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
      const specificTermMatch = querySpecificTerms.some(term => terms(chunk.text).includes(term));
      const multiTermMatch = queryTerms.length >= 2 && (matchedTerms[index] ?? 0) >= 2;
      const credibleLexical = normalizedLexical >= 0.25 && (exactPhrase || specificTermMatch || multiTermMatch);
      // Semantic similarity finds paraphrases; lexical overlap protects exact names and numbers.
      const score = queryVector ? semantic * 0.78 + normalizedLexical * 0.22 : normalizedLexical;
      return { chunk, score, semantic, normalizedLexical, credibleLexical };
    });
    const strongestSemantic = Math.max(0, ...scored.map(row => row.semantic));
    const semanticRanking = [...scored].sort((a, b) => b.semantic - a.semantic);
    const secondSemantic = semanticRanking[1]?.semantic ?? 0;
    // Some embedding models return useful paraphrase matches below a global
    // cosine threshold of 0.35. Admit a lower-scoring result only when the
    // best match is both meaningfully strong and clearly separated from every
    // other chunk; this recovers distinctive facts without lowering the floor
    // for a set of uniformly weak, unrelated candidates.
    const hasDistinctSemanticWinner = strongestSemantic >= 0.285 &&
      strongestSemantic - secondSemantic >= 0.06 &&
      strongestSemantic >= secondSemantic * 1.3;
    // Embedding cosines have a model-specific positive background: treating
    // every small positive score as a hit fills prompts with unrelated text.
    // Keep strong lexical matches for names/numbers, and require semantic
    // candidates to clear both a modest floor and a margin from the best hit.
    // A relative-only cutoff always admits the nearest result, even when the
    // query has no answer in memory. EmbeddingGemma's unrelated background
    // matches commonly sit around 0.15–0.32; keep a model-calibrated absolute
    // floor as well, while lexical matches still recover exact names/numbers.
    const semanticFloor = Math.max(0.35, strongestSemantic * 0.72);
    const credible = scored.filter(row => queryVector
      ? row.semantic >= semanticFloor || row.credibleLexical ||
        (hasDistinctSemanticWinner && row.semantic >= strongestSemantic * 0.97)
      : row.score > 0.025);
    credible.sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt);
    const scoredResults = credible;
    const chosen: MemoryChunk[] = []; const seen = new Set<string>(); const perMessage = new Map<string, number>(), perConversation = new Map<string, number>(); let used = 0;
    // Overlapping chunks from one long answer can otherwise crowd out unrelated
    // facts. Keep search results spread across messages/conversations while
    // allowing a second adjacent excerpt when one source contains multiple hits.
    for (const row of scoredResults) {
      const dedupe = row.chunk.text.toLocaleLowerCase().slice(0, 120);
      const messageKey = `${row.chunk.conversationId}:${row.chunk.messageId}`;
      const promptTokens = Math.max(0, promptTokenCost(row.chunk));
      if (seen.has(dedupe) || (perMessage.get(messageKey) ?? 0) >= 2 || (perConversation.get(row.chunk.conversationId) ?? 0) >= 16 || used + promptTokens > maxTokens) continue;
      chosen.push(row.chunk); seen.add(dedupe); used += promptTokens;
      perMessage.set(messageKey, (perMessage.get(messageKey) ?? 0) + 1);
      perConversation.set(row.chunk.conversationId, (perConversation.get(row.chunk.conversationId) ?? 0) + 1);
      if (chosen.length >= 48) break;
    }
    return chosen;
  }
}
