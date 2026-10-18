// ofs.ts — OrionFS (Holographic Associative Memory Engine for Local LLMs)
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { encodeLocal, extractLocal, OFS_ENCODING_VERSION } from './ofs-local';

/** Small adapter for the sync SQLite shape used below; Electron 44 bundles Node 24's SQLite API. */
class SqliteDatabase {
  private readonly native: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.native = new DatabaseSync(path, { timeout: 5000 });
  }

  exec(sql: string): void { this.native.exec(sql); }

  prepare(sql: string) {
    const statement = this.native.prepare(sql);
    return { run: (params?: Record<string, unknown>) => params === undefined ? statement.run() : statement.run(params as never) };
  }

  query(sql: string) {
    const statement = this.native.prepare(sql);
    return { all: (...params: unknown[]) => statement.all(...params as never[]) as Record<string, unknown>[] };
  }

  run(sql: string, params: unknown[] = []): void {
    this.native.prepare(sql).run(...params as never[]);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.native.exec("BEGIN IMMEDIATE");
      try {
        const value = fn();
        this.native.exec("COMMIT");
        return value;
      } catch (error) {
        this.native.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close(): void { this.native.close(); }
}

// ============================================================================
// 1. TYPES & INTERFACES
// ============================================================================

export type MemoryType = "episodic" | "fact" | "entity_state" | "summary";

export interface MemoryNode {
  id: string;
  content: string;
  type: MemoryType;
  entities: string[];
  embedding: Float32Array;
  importance: number; // 0.0 to 1.0
  accessCount: number;
  createdAt: number;
  lastAccessed: number;
  supersededBy?: string | null;
  conversationId: string;
  sourceMessageId: string | null;
}

export interface ActivatedMemory extends MemoryNode {
  score: number;
  activationSource: "direct" | "synaptic_hop";
}

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
  tokens: number;
}

export interface OFSConfig {
  dbPath: string;
  maxContextTokens: number;      // e.g., 8192
  reservedOutputTokens: number;  // e.g., 1024
  memoryBudgetRatio: number;     // e.g., 0.30 (30% of context for injected long-term memory)
  embeddingDim?: number;
  coreSystemPrompt?: string;
}

export interface OFSTurnSource { conversationId: string; messageId: string; createdAt?: number; }
export interface OFSSnapshot {
  version: 1; createdAt: number; workingMemory: ChatTurn[];
  memories: Array<Record<string, unknown>>; links: Array<Record<string, unknown>>;
  turns: Array<Record<string, unknown>>; metadata: Array<Record<string, unknown>>;
}
export interface OFSRecallPolicy { pinnedIds?: string[]; conversationIds?: string[]; memoryIds?: string[]; excludedIds?: string[]; strict?: boolean }

export interface ExtractedKnowledge {
  facts: {
    content: string;
    type: MemoryType;
    entities: string[];
    importance: number;
    supersedesEntityAttribute?: { entity: string; attribute: string };
  }[];
  relations: { source: string; relation: string; target: string; weight: number }[];
}

// ============================================================================
// 2. FAST VECTOR MATH & TOKEN HEURISTICS
// ============================================================================

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function estimateTokens(text: string): number {
  // Fast heuristic: ~3.8 chars per token for English & Code
  return Math.ceil(text.length / 3.8);
}

// ============================================================================
// 3. ORIONFS (OFS) MEMORY ENGINE
// ============================================================================

export class OrionFS {
  private db: SqliteDatabase;
  private config: OFSConfig;
  private workingMemory: ChatTurn[] = [];
  private coreSystemPrompt: string;

  // In-memory hot cache for sub-millisecond vector scans
  private vectorCache: Map<
    string,
    { vec: Float32Array; entities: string[]; importance: number; conversationId: string; sourceMessageId: string | null }
  > = new Map();
  private ingestionQueue: Promise<void> = Promise.resolve();
  private pendingTurns = new Set<string>();
  private closed = false;

  constructor(config: OFSConfig) {
    this.config = config;
    this.coreSystemPrompt =
      config.coreSystemPrompt ??
      "Use the supplied OrionFS memories as scoped, attributed conversation evidence.";
    this.db = new SqliteDatabase(config.dbPath);
    this.initDatabase();
    this.warmVectorCache();
  }

  private initDatabase(): void {
    // Keep the database responsive without reserving a huge virtual mapping.
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 268435456;
      PRAGMA cache_size = -8000;
      CREATE TABLE IF NOT EXISTS ofs_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS ofs_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        entities TEXT NOT NULL, -- JSON array of normalized entity tags
        embedding BLOB NOT NULL,
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        superseded_by TEXT DEFAULT NULL,
        entity_key TEXT DEFAULT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        source_message_id TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ofs_memories_active
        ON ofs_memories(superseded_by) WHERE superseded_by IS NULL;
      CREATE INDEX IF NOT EXISTS idx_ofs_memories_entity_key
        ON ofs_memories(entity_key);
      CREATE INDEX IF NOT EXISTS idx_ofs_memories_conversation
        ON ofs_memories(conversation_id, superseded_by);
      CREATE INDEX IF NOT EXISTS idx_ofs_memories_source
        ON ofs_memories(source_message_id);
      CREATE TABLE IF NOT EXISTS ofs_ingested_turns (
        source_message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- Full-Text Search (BM25) Virtual Table
      CREATE VIRTUAL TABLE IF NOT EXISTS ofs_memories_fts USING fts5(
        id UNINDEXED,
        content,
        entities,
        tokenize = 'porter unicode61'
      );

      -- Associative Constellation Graph (Entity <-> Entity links)
      CREATE TABLE IF NOT EXISTS ofs_links (
        conversation_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, source, target, relation)
      );

      CREATE INDEX IF NOT EXISTS idx_ofs_links_source ON ofs_links(source);
      CREATE INDEX IF NOT EXISTS idx_ofs_links_target ON ofs_links(target);
    `);

    this.addColumnIfMissing("ofs_memories", "conversation_id", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("ofs_memories", "source_message_id", "TEXT DEFAULT NULL");
    this.addColumnIfMissing("ofs_links", "conversation_id", "TEXT NOT NULL DEFAULT ''");
    const linkColumns = this.db.query(`PRAGMA table_info(ofs_links)`).all() as { name: string; pk: number }[];
    const linkPrimaryKey = linkColumns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (!linkPrimaryKey.includes("conversation_id")) {
      // Preserve links from an older standalone OFS database as global links.
      this.db.exec(`DROP INDEX IF EXISTS idx_ofs_links_source; DROP INDEX IF EXISTS idx_ofs_links_target;
        ALTER TABLE ofs_links RENAME TO ofs_links_legacy;
        CREATE TABLE ofs_links (conversation_id TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, target TEXT NOT NULL, relation TEXT NOT NULL, weight REAL DEFAULT 1.0, updated_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, source, target, relation));
        INSERT OR IGNORE INTO ofs_links (conversation_id, source, target, relation, weight, updated_at) SELECT '', source, target, relation, weight, updated_at FROM ofs_links_legacy;
        DROP TABLE ofs_links_legacy;`);
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ofs_memories_conversation ON ofs_memories(conversation_id, superseded_by);
      CREATE INDEX IF NOT EXISTS idx_ofs_memories_source ON ofs_memories(source_message_id);
      CREATE INDEX IF NOT EXISTS idx_ofs_links_conversation_source ON ofs_links(conversation_id, source);`);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private warmVectorCache(): void {
    const rows = this.db
      .query(
        `SELECT id, content, embedding, entities, importance, conversation_id, source_message_id
         FROM ofs_memories
         WHERE superseded_by IS NULL`
      )
      .all() as {
      id: string;
      content: string;
      embedding: Uint8Array;
      entities: string;
      importance: number;
      conversation_id: string;
      source_message_id: string | null;
    }[];

    const version = this.db.query("SELECT value FROM ofs_metadata WHERE key = 'encoding'").all()[0]?.value;
    const migrate = version !== OFS_ENCODING_VERSION;
    for (const r of rows) {
      const uint8 = new Uint8Array(r.embedding);
      if (!migrate && (uint8.byteLength === 0 || uint8.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0)) continue;
      const copied = uint8.slice();
      const float32 = migrate ? encodeLocal(r.content) : new Float32Array(copied.buffer);
      if (migrate) this.db.run('UPDATE ofs_memories SET embedding = ? WHERE id = ?', [new Uint8Array(float32.buffer), r.id]);
      this.vectorCache.set(r.id, {
        vec: float32,
        entities: this.parseEntities(r.entities),
        importance: r.importance,
        conversationId: r.conversation_id ?? "",
        sourceMessageId: r.source_message_id ?? null,
      });
    }
    this.db.run("INSERT INTO ofs_metadata (key, value) VALUES ('encoding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [OFS_ENCODING_VERSION]);
  }

  private parseEntities(value: string): string[] {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  }

  // --------------------------------------------------------------------------
  // AUTOMATIC INGESTION & GRAPH LINKING
  // --------------------------------------------------------------------------

  public async ingestTurn(
    role: "user" | "assistant",
    content: string,
    source?: OFSTurnSource
  ): Promise<void> {
    if (this.closed || !content.trim()) return;
    const conversationId = source?.conversationId || "__global__";
    const sourceMessageId = source?.messageId || randomUUID();
    if (this.pendingTurns.has(sourceMessageId)) return;
    this.pendingTurns.add(sourceMessageId);
    const operation = this.ingestionQueue.then(async () => {
      const existing = this.db.query(`SELECT status FROM ofs_ingested_turns WHERE source_message_id = ?`).all(sourceMessageId) as { status: string }[];
      if (existing.some(item => item.status === "complete")) return;
      this.db.prepare(`INSERT INTO ofs_ingested_turns (source_message_id, conversation_id, status, created_at)
        VALUES ($id, $conversationId, 'pending', $now)
        ON CONFLICT(source_message_id) DO UPDATE SET status = 'pending', conversation_id = excluded.conversation_id`)
        .run({ $id: sourceMessageId, $conversationId: conversationId, $now: source?.createdAt ?? Date.now() });
      this.workingMemory.push({ role, content, tokens: estimateTokens(content) });
      try {
        await this.extractAndConsolidate(content, role, { ...source, conversationId, messageId: sourceMessageId });
        this.db.prepare(`UPDATE ofs_ingested_turns SET status = 'complete' WHERE source_message_id = $id`).run({ $id: sourceMessageId });
      } catch (error) {
        this.db.run(`DELETE FROM ofs_ingested_turns WHERE source_message_id = ?`, [sourceMessageId]);
        throw error;
      }
      await this.enforceWorkingMemoryBudget();
    }).finally(() => this.pendingTurns.delete(sourceMessageId));
    this.ingestionQueue = operation.catch(error => { console.error("[OrionFS] Background ingestion error:", error); });
    await operation;
  }

  public async extractAndConsolidate(text: string, role: "user" | "assistant" = "user", source?: OFSTurnSource): Promise<void> {
    const rawKnowledge = extractLocal(text, role);
    const knowledge: ExtractedKnowledge = {
      facts: Array.isArray(rawKnowledge?.facts) ? rawKnowledge.facts.filter(fact =>
        !!fact && typeof fact.content === "string" && fact.content.trim().length > 0 &&
        ["episodic", "fact", "entity_state", "summary"].includes(fact.type) &&
        Array.isArray(fact.entities) && Number.isFinite(fact.importance)
      ).map(fact => ({ ...fact, content: fact.content.trim().slice(0, 4000), entities: fact.entities.filter(entity => typeof entity === "string").slice(0, 24), importance: Math.max(0, Math.min(1, fact.importance)) })) : [],
      relations: Array.isArray(rawKnowledge?.relations) ? rawKnowledge.relations.filter(rel => !!rel && typeof rel.source === "string" && typeof rel.target === "string" && typeof rel.relation === "string" && Number.isFinite(rel.weight)).slice(0, 128) : [],
    };
    const now = source?.createdAt ?? Date.now();
    const conversationId = source?.conversationId || "__global__";
    const sourceMessageId = source?.messageId ?? null;

    const insertMem = this.db.prepare(`
      INSERT INTO ofs_memories (
        id, content, type, entities, embedding, importance, access_count, created_at, last_accessed, entity_key, conversation_id, source_message_id
      ) VALUES (
        $id, $content, $type, $entities, $embedding, $importance, 1, $now, $now, $entityKey, $conversationId, $sourceMessageId
      )
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO ofs_memories_fts (id, content, entities)
      VALUES ($id, $content, $entitiesStr)
    `);

    const supersedeOld = this.db.prepare(`
      UPDATE ofs_memories
      SET superseded_by = $newId
      WHERE conversation_id = $conversationId AND entity_key = $entityKey AND superseded_by IS NULL
    `);

    const upsertLink = this.db.prepare(`
      INSERT INTO ofs_links (conversation_id, source, target, relation, weight, updated_at)
      VALUES ($conversationId, $source, $target, $relation, $weight, $now)
      ON CONFLICT(conversation_id, source, target, relation) DO UPDATE SET
        weight = MIN(5.0, ofs_links.weight + ($weight * 0.5)),
        updated_at = $now
    `);

    for (const fact of knowledge.facts) {
      const id = randomUUID();
      const vec = encodeLocal(fact.content);
      if (!(vec instanceof Float32Array) || vec.length === 0 || vec.length > 8192 || [...vec].some(value => !Number.isFinite(value))) continue;
      const normEntities = [...new Set(fact.entities.map((e) => e.toLowerCase().trim()).filter(Boolean))];
      const entityKey = fact.supersedesEntityAttribute
        ? `${fact.supersedesEntityAttribute.entity.toLowerCase().trim()}:${fact.supersedesEntityAttribute.attribute.toLowerCase().trim()}`
        : null;

      this.db.transaction(() => {
        // 1. State Mutation: Supersede outdated facts with matching entity_key
        if (entityKey) {
          const oldRows = this.db
            .query(
              `SELECT id FROM ofs_memories WHERE conversation_id = ? AND entity_key = ? AND superseded_by IS NULL`
            )
            .all(conversationId, entityKey) as { id: string }[];

          for (const old of oldRows) {
            this.vectorCache.delete(old.id);
          }
          supersedeOld.run({ $newId: id, $entityKey: entityKey, $conversationId: conversationId });
        }

        // 2. Persist new memory node
        insertMem.run({
          $id: id,$content: fact.content,
          $type: fact.type,
          $entities: JSON.stringify(normEntities),
          $embedding: new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
          $importance: fact.importance,
          $now: now,
          $entityKey: entityKey,
          $conversationId: conversationId,
          $sourceMessageId: sourceMessageId,
        });

        insertFts.run({
          $id: id,$content: fact.content,
          $entitiesStr: normEntities.join(" "),
        });

        // 3. Auto-wire co-occurring entities in the Orion Constellation Graph
        for (let i = 0; i < normEntities.length; i++) {
          for (let j = i + 1; j < normEntities.length; j++) {
            upsertLink.run({
              $conversationId: conversationId,
              $source: normEntities[i],
              $target: normEntities[j],$relation: "co_occurs",
              $weight: fact.importance,
              $now: now,
            });
            upsertLink.run({
              $conversationId: conversationId,
              $source: normEntities[j],
              $target: normEntities[i],$relation: "co_occurs",
              $weight: fact.importance,
              $now: now,
            });
          }
        }
      })();

      // Update in-memory hot vector cache
      this.vectorCache.set(id, {
        vec,
        entities: normEntities,
        importance: fact.importance,
        conversationId,
        sourceMessageId,
      });
    }

    // Persist explicit semantic edges
    this.db.transaction(() => {
      for (const rel of knowledge.relations) {
        const s = rel.source.toLowerCase().trim();
        const t = rel.target.toLowerCase().trim();
        upsertLink.run({
          $conversationId: conversationId,
          $source: s,
          $target: t,$relation: rel.relation,
          $weight: rel.weight,
          $now: now,
        });
        upsertLink.run({
          $conversationId: conversationId,
          $source: t,
          $target: s,$relation: `inv_${rel.relation}`,
          $weight: rel.weight * 0.8,$now: now,
        });
      }
    })();
  }

  // --------------------------------------------------------------------------
  // LOCAL DISTRIBUTED RETRIEVAL + SPREADING ACTIVATION
  // --------------------------------------------------------------------------

  public async recall(
    query: string,
    maxTokens: number,
    conversationId = "__global__",
    excludedMessageIds: string[] = [],
    policy?: OFSRecallPolicy
  ): Promise<ActivatedMemory[]> {
    if (this.closed || maxTokens <= 0) return [];
    const startTime = performance.now();
    const queryVec = encodeLocal(query);
    const now = Date.now();
    const excluded = new Set(excludedMessageIds);
    const scopes = new Set(policy?.conversationIds ?? []), explicit = new Set(policy?.memoryIds ?? []), blocked = new Set(policy?.excludedIds ?? []);
    const linkScopes = [...new Set([...scopes, ...[...explicit].map(id => this.vectorCache.get(id)?.conversationId).filter((id): id is string => Boolean(id))])];
    const allowed = (cached: { conversationId: string; sourceMessageId: string | null }, id = '') =>
      !blocked.has(id) && !excluded.has(cached.sourceMessageId ?? '') &&
      (policy ? (!policy.strict || scopes.has(cached.conversationId) || explicit.has(id)) : (conversationId === '__all__' || cached.conversationId === conversationId || cached.conversationId === '__global__'));

    // STEP 1: Fast In-Memory Vector Scan
    const directScores = new Map<string, number>();
    const seedEntities = new Map<string, number>();

    for (const [id, cached] of this.vectorCache.entries()) {
      if (!allowed(cached, id)) continue;
      const sim = cosineSimilarity(queryVec, cached.vec);
      if(policy?.pinnedIds?.includes(id)) directScores.set(id, 2);
      if (sim > 0.2) {
        directScores.set(id, Math.max(directScores.get(id)??0, sim * 0.9));
        if (sim > 0.35) {
          for (const ent of cached.entities) {
            seedEntities.set(ent, Math.max(seedEntities.get(ent) || 0, sim));
          }
        }
      }
    }

    // STEP 3: Multi-Hop Spreading Activation across Orion Links
    const activatedEntities = new Map<string, number>(seedEntities);
    let frontier = Array.from(seedEntities.entries());

    for (let hop = 0; hop < 2; hop++) {
      if (frontier.length === 0) break;
      const nextFrontier: [string, number][] = [];
      const decay = hop === 0 ? 0.55 : 0.3;

      for (const [entity, energy] of frontier) {
        const neighbors = this.db
          .query(
            `SELECT target, weight FROM ofs_links
             WHERE source = $ent AND ($allConversations = 1 OR conversation_id IN ($conversationId, '__global__'))
               AND ($policy = 0 OR conversation_id IN (SELECT value FROM json_each($scopes)))
             ORDER BY weight DESC LIMIT 8`
          )
          .all({ $ent: entity, $conversationId: conversationId, $allConversations: conversationId === "__all__" ? 1 : 0, $policy: policy?.strict ? 1 : 0, $scopes: JSON.stringify(linkScopes) }) as { target: string; weight: number }[];

        for (const n of neighbors) {
          const propagatedEnergy =
            energy * (Math.min(n.weight, 3.0) / 3.0) * decay;
          if (propagatedEnergy > 0.15) {
            const existing = activatedEntities.get(n.target) || 0;
            if (propagatedEnergy > existing) {
              activatedEntities.set(n.target, propagatedEnergy);
              nextFrontier.push([n.target, propagatedEnergy]);
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    // STEP 4: Unified Scoring (Direct + Synaptic Boost + Ebbinghaus Decay)
    const candidateIds = new Set<string>(directScores.keys());

    for (const [id, cached] of this.vectorCache.entries()) {
      if (!allowed(cached, id)) continue;
      for (const ent of cached.entities) {
        if (activatedEntities.has(ent)) {
          candidateIds.add(id);
        }
      }
    }

    if (candidateIds.size === 0) return [];

    const rows: Record<string, unknown>[] = [];
    const ids = Array.from(candidateIds);
    for (let offset = 0; offset < ids.length; offset += 400) {
      const batch = ids.slice(offset, offset + 400);
      const placeholders = batch.map(() => "?").join(",");
      rows.push(...this.db.query(
        `SELECT id, content, type, entities, importance, access_count, created_at, last_accessed, conversation_id, source_message_id
         FROM ofs_memories WHERE id IN (${placeholders}) AND superseded_by IS NULL AND (? = 1 OR conversation_id IN (?, '__global__'))`
      ).all(...batch, conversationId === "__all__" ? 1 : 0, conversationId) as Record<string, unknown>[]);
    }
    const typedRows = rows as {
      id: string;
      content: string;
      type: MemoryType;
      entities: string;
      importance: number;
      access_count: number;
      created_at: number;
      last_accessed: number;
      conversation_id: string;
      source_message_id: string | null;
    }[];

    const scoredMemories: ActivatedMemory[] = [];
    const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 14; // 14-day base half-life

    for (const r of typedRows) {
      const ents = this.parseEntities(r.entities);
      const direct = directScores.get(r.id) || 0;

      let synapticBoost = 0;
      for (const ent of ents) {
        synapticBoost += activatedEntities.get(ent) || 0;
      }
      synapticBoost = Math.min(0.6, synapticBoost * 0.25);

      // Ebbinghaus forgetting curve with Hebbian access reinforcement
      const ageMs = Math.max(0, now - r.last_accessed);
      const stabilityMultiplier =
        1 + Math.log(1 + r.access_count) + r.importance * 2;
      const retention = Math.exp(
        -ageMs / (HALF_LIFE_MS * stabilityMultiplier)
      );

      const finalScore =
        (direct + synapticBoost) *
        (0.7 + 0.3 * retention) *
        (0.8 + 0.4 * r.importance);

      if (finalScore > 0.22) {
        scoredMemories.push({
          id: r.id,
          content: r.content,
          type: r.type,
          entities: ents,
          embedding: this.vectorCache.get(r.id)!.vec,
          importance: r.importance,
          accessCount: r.access_count,
          createdAt: r.created_at,
          lastAccessed: r.last_accessed,
          conversationId: r.conversation_id,
          sourceMessageId: r.source_message_id,
          score: finalScore,
          activationSource: direct > synapticBoost ? "direct" : "synaptic_hop",
        });
      }
    }

    scoredMemories.sort((a, b) => b.score - a.score);

    // STEP 5: Token Budget Packing & Access Reinforcement
    const selected: ActivatedMemory[] = [];
    let usedTokens = 0;
    const recalledIds: string[] = [];
    const selectedContent = new Set<string>();

    for (const mem of scoredMemories) {
      const key = `${mem.conversationId}\0${mem.content}`;
      if (selectedContent.has(key)) continue;
      const t = estimateTokens(mem.content) + 6;
      if (usedTokens + t <= maxTokens) {
        selected.push(mem);
        usedTokens += t;
        recalledIds.push(mem.id);
        selectedContent.add(key);
      }
    }

    if (recalledIds.length > 0) {
      const updatePlaceholders = recalledIds.map(() => "?").join(",");
      this.db.run(
        `UPDATE ofs_memories
         SET access_count = access_count + 1, last_accessed = ?
         WHERE id IN (${updatePlaceholders})`,
        [now, ...recalledIds]
      );
    }

    const elapsed = (performance.now() - startTime).toFixed(2);
    console.log(
      `[OrionFS] Recalled ${selected.length} memories (${usedTokens} tokens) in ${elapsed}ms`
    );

    return selected;
  }

  // --------------------------------------------------------------------------
  // KV-CACHE AWARE 8K CONTEXT COMPILER
  // --------------------------------------------------------------------------

  public async compileContextWindow(currentUserMessage: string): Promise<{
    messages: { role: string; content: string }[];
    stats: { totalTokens: number; recalledCount: number; synapticHops: number };
  }> {
    const usableContext =
      this.config.maxContextTokens - this.config.reservedOutputTokens;
    const systemTokens = estimateTokens(this.coreSystemPrompt) + 40;
    const memoryBudget = Math.floor(
      usableContext * this.config.memoryBudgetRatio
    );

    // 1. Recall relevant & multi-hop connected memories
    const recalled = await this.recall(currentUserMessage, memoryBudget);

    // Sort deterministically by ID to preserve KV-Cache prefix stability across turns
    const deterministicMemories = [...recalled].sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    const memoryBlockLines = deterministicMemories.map(
      (m) =>
        `- [${m.type.toUpperCase()}${
          m.activationSource === "synaptic_hop" ? ":LINKED" : ""
        }] ${m.content}`
    );

    const memoryBlock =
      memoryBlockLines.length > 0
        ? `<orion_memory>\nActive long-term memories and associative links:\n${memoryBlockLines.join(
            "\n"
          )}\n</orion_memory>`
        : "";

    const memoryTokens = estimateTokens(memoryBlock);
    const currentTurnTokens = estimateTokens(currentUserMessage) + 10;

    // 2. Pack recent Working Memory turns into remaining context window
    const remainingForWorking =
      usableContext - systemTokens - memoryTokens - currentTurnTokens;
    const activeWorkingTurns: ChatTurn[] = [];
    let workingTokensUsed = 0;

    for (let i = this.workingMemory.length - 1; i >= 0; i--) {
      const turn = this.workingMemory[i];
      if (!turn) continue;
      if (workingTokensUsed + turn.tokens <= remainingForWorking) {
        activeWorkingTurns.unshift(turn);
        workingTokensUsed += turn.tokens;
      } else {
        break;
      }
    }

    // 3. Assemble final message array
    const messages: { role: string; content: string }[] = [
      {
        role: "system",
        content: `${this.coreSystemPrompt}\n\n${memoryBlock}`.trim(),
      },
      ...activeWorkingTurns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: currentUserMessage },
    ];

    return {
      messages,
      stats: {
        totalTokens:
          systemTokens + memoryTokens + workingTokensUsed + currentTurnTokens,
        recalledCount: recalled.length,
        synapticHops: recalled.filter(
          (r) => r.activationSource === "synaptic_hop"
        ).length,
      },
    };
  }

  // --------------------------------------------------------------------------
  // WORKING MEMORY EVICTION -> EPISODIC CONSOLIDATION
  // --------------------------------------------------------------------------

  private async enforceWorkingMemoryBudget(): Promise<void> {
    const maxWorkingTokens = Math.floor(
      (this.config.maxContextTokens - this.config.reservedOutputTokens) *
        (1 - this.config.memoryBudgetRatio - 0.1)
    );

    let totalWorking = this.workingMemory.reduce((sum, t) => sum + t.tokens, 0);

    while (totalWorking > maxWorkingTokens && this.workingMemory.length > 4) {
      const evicted = this.workingMemory.splice(0, 2);
      totalWorking = this.workingMemory.reduce((sum, t) => sum + t.tokens, 0);

      const transcript = evicted
        .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
        .join(" | ");
      // Each turn is already indexed at ingestion; re-extracting evicted turns
      // would create duplicate memories and lose their conversation scope.
      void transcript;
    }
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE UTILITIES
  // --------------------------------------------------------------------------

  public getStats(conversationId?: string, policy?: OFSRecallPolicy, excludedSources: string[] = []): { activeMemories: number; workingTurns: number; indexedTokens: number; links: number; databaseBytes: number } {
    const scopeSql = policy?.strict ? ` AND (conversation_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))) AND id NOT IN (SELECT value FROM json_each(?)) AND (source_message_id IS NULL OR source_message_id NOT IN (SELECT value FROM json_each(?)))` : conversationId ? ` AND conversation_id = ?` : "";
    const params = policy?.strict ? [JSON.stringify(policy.conversationIds??[]),JSON.stringify(policy.memoryIds??[]),JSON.stringify(policy.excludedIds??[]),JSON.stringify(excludedSources)] : conversationId ? [conversationId] : [];
    const memories = this.db.query(`SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(content)), 0) AS chars FROM ofs_memories WHERE superseded_by IS NULL${scopeSql}`).all(...params) as { count: number; chars: number }[];
    const links = this.db.query(`SELECT COUNT(*) AS count FROM ofs_links${policy?.strict ? " WHERE conversation_id IN (SELECT value FROM json_each(?))" : conversationId ? " WHERE conversation_id = ?" : ""}`).all(...(policy?.strict?[JSON.stringify(policy.conversationIds??[])]:conversationId?[conversationId]:[])) as { count: number }[];
    let databaseBytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try { databaseBytes += statSync(this.config.dbPath + suffix).size; } catch { /* WAL files are optional. */ }
    }
    return { activeMemories: memories[0]?.count ?? 0, workingTurns: this.workingMemory.length, indexedTokens: Math.ceil((memories[0]?.chars ?? 0) / 3.8), links: links[0]?.count ?? 0, databaseBytes };
  }

  public async exportSnapshot(): Promise<OFSSnapshot> {
    await this.ingestionQueue;
    const memories = this.db.query('SELECT * FROM ofs_memories ORDER BY id').all().map(row => ({ ...row, embedding: Buffer.from(row.embedding as Uint8Array).toString('base64') }));
    return { version: 1, createdAt: Date.now(), workingMemory: structuredClone(this.workingMemory), memories,
      links: this.db.query('SELECT * FROM ofs_links ORDER BY conversation_id, source, target, relation').all(),
      turns: this.db.query('SELECT * FROM ofs_ingested_turns ORDER BY source_message_id').all(),
      metadata: this.db.query('SELECT * FROM ofs_metadata ORDER BY key').all() };
  }

  public async importSnapshot(snapshot: OFSSnapshot, remap?: { from: string; to: string }): Promise<void> {
    await this.ingestionQueue;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.memories) || !Array.isArray(snapshot.links) || !Array.isArray(snapshot.turns) || !Array.isArray(snapshot.metadata)) throw new Error('Unsupported OrionFS checkpoint.');
    const groups = [['ofs_memories', snapshot.memories], ['ofs_links', snapshot.links], ['ofs_ingested_turns', snapshot.turns], ['ofs_metadata', snapshot.metadata]] as const;
    this.db.transaction(() => {
      this.db.exec('DELETE FROM ofs_memories_fts; DELETE FROM ofs_memories; DELETE FROM ofs_links; DELETE FROM ofs_ingested_turns; DELETE FROM ofs_metadata;');
      for (const [table, rows] of groups) {
        const columns = (this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
        for (const row of rows) {
          const keys = columns.filter(key => Object.hasOwn(row, key));
          const values = keys.map(key => key === 'embedding' ? new Uint8Array(Buffer.from(String(row[key]), 'base64')) : key === 'conversation_id' && remap && row[key] === remap.from ? remap.to : row[key]);
          this.db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, values);
        }
      }
      this.db.exec('INSERT INTO ofs_memories_fts (id,content,entities) SELECT id,content,entities FROM ofs_memories;');
    })();
    this.workingMemory = structuredClone(snapshot.workingMemory ?? []);
    this.vectorCache.clear(); this.warmVectorCache();
  }

  public listMemories(limit = 50, offset = 0) {
    limit = Math.max(1, Math.min(100, Math.floor(limit)));
    offset = Math.max(0, Math.floor(offset));
    const rows = this.db.query(`SELECT id, content, type, entities, importance, created_at, conversation_id, source_message_id
      FROM ofs_memories WHERE superseded_by IS NULL ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(limit, offset);
    const total = this.db.query('SELECT COUNT(*) AS count FROM ofs_memories WHERE superseded_by IS NULL').all()[0]?.count as number;
    return { total, items: rows.map(row => ({ id: String(row.id), content: String(row.content), type: String(row.type),
      entities: this.parseEntities(String(row.entities)), importance: Number(row.importance), createdAt: Number(row.created_at),
      conversationId: String(row.conversation_id), sourceMessageId: row.source_message_id ? String(row.source_message_id) : null })) };
  }

  public removeConversation(conversationId: string): void {
    const ids = this.db.query(`SELECT id FROM ofs_memories WHERE conversation_id = ?`).all(conversationId) as { id: string }[];
    this.db.transaction(() => {
      for (const row of ids) this.db.run(`DELETE FROM ofs_memories_fts WHERE id = ?`, [row.id]);
      this.db.run(`DELETE FROM ofs_memories WHERE conversation_id = ?`, [conversationId]);
      this.db.run(`DELETE FROM ofs_links WHERE conversation_id = ?`, [conversationId]);
      this.db.run(`DELETE FROM ofs_ingested_turns WHERE conversation_id = ?`, [conversationId]);
    })();
    for (const row of ids) this.vectorCache.delete(row.id);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    // Seal the encrypted memory snapshot from a fully checkpointed database.
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* Close still releases the connection; any WAL is sealed by storage recovery. */ }
    this.db.close();
  }
}

// Export shorthand alias `OFS` alongside `OrionFS`
export { OrionFS as OFS };
