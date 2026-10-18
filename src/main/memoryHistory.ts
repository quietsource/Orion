import path from "node:path";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
import { readEncryptedText, writeEncryptedText } from "./secure-storage";
import type { OFSSnapshot, OFSRecallPolicy } from "../../ofs";
import type { Conversation, CanvasDocument } from "../shared/types";
import {
  defaultMemoryLens,
  type MemoryContext,
  type MemoryCheckpoint,
  type MemoryDashboard,
  type MemoryEntry,
  type Assumption,
  type CarryPacket,
  type CarryItem,
  type MemoryLens,
  type MemoryComparison,
} from "../shared/memoryHistory";
import type { OFSClient } from "./ofsClient";

type Tags = NonNullable<MemoryContext["tags"]>;
type Index = {
  version: 1;
  contexts: Record<string, MemoryContext>;
  checkpoints: Array<MemoryCheckpoint & { digest: string }>;
  tags: Tags;
};
type CheckpointData = {
  conversation: Conversation;
  context: MemoryContext;
  tags: Tags;
};
type Dependencies = {
  directory: string;
  readConversations(): Promise<Conversation[]>;
  saveConversation(value: Conversation): Promise<void>;
  baseEngine(): Promise<OFSClient>;
  createEngine(id: string): Promise<{ client: OFSClient; fresh: boolean }>;
  busy(): boolean;
  defaultScope?(): Promise<MemoryLens["scope"]>;
};
const clone = <T>(value: T): T => structuredClone(value);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canvases = (conversation: Conversation) => {
  const map = new Map<string, CanvasDocument>();
  for (const message of conversation.messages)
    for (const doc of message.canvasDocuments ?? []) map.set(doc.id, doc);
  return [...map.values()];
};
const entries = (snapshot: OFSSnapshot): MemoryEntry[] =>
  snapshot.memories
    .filter((row) => !row.superseded_by)
    .map((row) => ({
      id: String(row.id),
      content: String(row.content),
      type: String(row.type),
      conversationId: String(row.conversation_id),
      sourceMessageId: row.source_message_id
        ? String(row.source_message_id)
        : null,
      createdAt: Number(row.created_at),
      importance: Number(row.importance),
      entities: JSON.parse(String(row.entities)) as string[],
    }));
export class MemoryHistory {
  private state: Index | undefined;
  private loading: Promise<Index> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private engines = new Map<string, Promise<OFSClient>>();
  private knownObjects = new Set<string>();
  constructor(private deps: Dependencies) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async index() {
    if (this.state) return this.state;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await fs.mkdir(path.join(this.deps.directory, "objects"), {
        recursive: true,
      });
      let state: Index;
      try {
        state = JSON.parse(
          await readEncryptedText(
            path.join(this.deps.directory, "index.json.enc"),
          ),
        ) as Index;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = { version: 1, contexts: {}, checkpoints: [], tags: {} };
      }
      if (state.version !== 1)
        throw Error(
          "Unsupported memory-history store. Your data has been preserved.",
        );
      this.knownObjects = new Set(
        (await fs.readdir(path.join(this.deps.directory, "objects"))).map(
          (name) => name.replace(".json.enc", ""),
        ),
      );
      return (this.state = state);
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = undefined;
    }
  }
  private async persist() {
    await writeEncryptedText(
      path.join(this.deps.directory, "index.json.enc"),
      JSON.stringify(await this.index()),
    );
  }
  private async readConversation(id: string) {
    const conversation = (await this.deps.readConversations()).find(
      (item) => item.id === id,
    );
    if (!conversation) throw Error("Conversation no longer exists.");
    return conversation;
  }
  async context(id: string): Promise<MemoryContext> {
    const state = await this.index();
    return clone(
      state.contexts[id] ?? {
        lens: {
          ...defaultMemoryLens(),
          scope: (await this.deps.defaultScope?.()) ?? "conversation",
        },
        assumptions: [],
        branchName: "Original",
        rootId: id,
      },
    );
  }
  private async editContext(id: string) {
    const state = await this.index();
    return (state.contexts[id] ??= await this.context(id));
  }
  private assertIdle() {
    if (this.deps.busy())
      throw Error(
        "Wait for generation to finish before changing memory, restoring, or creating a checkpoint.",
      );
  }
  async engine(id?: string): Promise<OFSClient> {
    if (!id) return this.deps.baseEngine();
    const context = await this.context(id);
    if (!context.branch) return this.deps.baseEngine();
    let pending = this.engines.get(id);
    if (!pending) {
      pending = (async () => {
        const { client, fresh } = await this.deps.createEngine(id);
        if (fresh) {
          try {
            await client.importSnapshot(
              await this.readSnapshot(context.branch!.snapshotId),
              { from: context.branch!.sourceConversationId, to: id },
            );
            await writeEncryptedText(
              path.join(this.deps.directory, "branches", `${id}.ready.enc`),
              context.branch!.snapshotId,
            );
          } catch (error) {
            await client.close().catch(() => undefined);
            throw error;
          }
        }
        return client;
      })();
      this.engines.set(id, pending);
      pending.catch(() => {
        if (this.engines.get(id) === pending) this.engines.delete(id);
      });
    }
    return pending;
  }
  private async saveSnapshot(snapshot: OFSSnapshot) {
    const memories = [];
    for (const row of snapshot.memories) {
      const embedding = String(row.embedding),
        key = hash(embedding);
      if (!this.knownObjects.has(key)) {
        await writeEncryptedText(
          path.join(this.deps.directory, "objects", `${key}.json.enc`),
          JSON.stringify({ embedding }),
        );
        this.knownObjects.add(key);
      }
      const { embedding: ignored, ...rest } = row;
      memories.push({ ...rest, embeddingRef: key });
    }
    const packed = { ...snapshot, createdAt: 0, memories };
    const text = JSON.stringify(packed),
      id = hash(text);
    try {
      await fs.access(path.join(this.deps.directory, `${id}.snapshot.enc`));
    } catch {
      await writeEncryptedText(
        path.join(this.deps.directory, `${id}.snapshot.enc`),
        (await compress(text)).toString("base64"),
      );
    }
    return id;
  }
  private async readSnapshot(id: string): Promise<OFSSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid snapshot reference.");
    const snapshot = JSON.parse(
      (
        await decompress(
          Buffer.from(
            await readEncryptedText(
              path.join(this.deps.directory, `${id}.snapshot.enc`),
            ),
            "base64",
          ),
        )
      ).toString("utf8"),
    ) as OFSSnapshot;
    if (snapshot.version !== 1) throw Error("Unsupported OrionFS snapshot.");
    const embeddings = new Map<string, string>();
    for (const row of snapshot.memories) {
      const ref = String(row.embeddingRef);
      if (!/^[a-f0-9]{64}$/.test(ref))
        throw Error("Damaged snapshot vector reference.");
      let value = embeddings.get(ref);
      if (value === undefined) {
        value = String(
          (
            JSON.parse(
              await readEncryptedText(
                path.join(this.deps.directory, "objects", `${ref}.json.enc`),
              ),
            ) as { embedding: string }
          ).embedding,
        );
        embeddings.set(ref, value);
      }
      row.embedding = value;
      delete row.embeddingRef;
    }
    return snapshot;
  }
  private async checkpointData(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid checkpoint.");
    return JSON.parse(
      (
        await decompress(
          Buffer.from(
            await readEncryptedText(
              path.join(this.deps.directory, `${id}.checkpoint.enc`),
            ),
            "base64",
          ),
        )
      ).toString("utf8"),
    ) as CheckpointData;
  }
  async checkpoint(
    id: string,
    label?: string,
    automatic = false,
  ): Promise<MemoryCheckpoint> {
    return this.exclusive(async () => {
      if (!automatic) this.assertIdle();
      const conversation = await this.readConversation(id),
        state = await this.index(),
        context = await this.context(id);
      const digest = hash(
        JSON.stringify({
          messages: conversation.messages,
          summary: conversation.summary,
          context,
        }),
      );
      const latest = state.checkpoints
        .filter((item) => item.conversationId === id)
        .at(-1);
      if (automatic && latest?.digest === digest) return latest;
      const snapshot = await (await this.engine(id)).exportSnapshot(),
        snapshotId = await this.saveSnapshot(snapshot),
        last = conversation.messages.at(-1);
      const checkpoint = {
        id: randomUUID(),
        conversationId: id,
        label: (
          label?.trim() ||
          `After ${conversation.messages.filter((message) => message.role === "user").length} turns`
        ).slice(0, 100),
        createdAt: Date.now(),
        messageCount: conversation.messages.length,
        lastMessageId: last?.id ?? "",
        excerpt: (last?.content ?? "Beginning of conversation")
          .replace(/\s+/g, " ")
          .slice(0, 180),
        snapshotId,
        memoryCount: entries(snapshot).filter(
          (item) => item.conversationId === id,
        ).length,
        canvasCount: canvases(conversation).length,
        digest,
      };
      await writeEncryptedText(
        path.join(this.deps.directory, `${checkpoint.id}.checkpoint.enc`),
        (
          await compress(
            JSON.stringify({
              conversation,
              context,
              tags: context.tags ?? state.tags,
            } satisfies CheckpointData),
          )
        ).toString("base64"),
      );
      state.checkpoints.push(checkpoint);
      await this.persist();
      return checkpoint;
    });
  }
  async preview(id: string) {
    const state = await this.index(),
      checkpoint = state.checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw Error("Checkpoint not found.");
    const saved = await this.checkpointData(id);
    return {
      checkpoint,
      context: saved.context,
      memories: entries(await this.readSnapshot(checkpoint.snapshotId)).filter(
        (item) => item.conversationId === checkpoint.conversationId,
      ),
      messages: saved.conversation.messages
        .slice(-4)
        .map((message) => ({ role: message.role, content: message.content })),
      canvases: canvases(saved.conversation).map((doc) => ({
        name: doc.name,
        content: doc.content,
      })),
    };
  }
  async branch(id: string, name: string) {
    return this.exclusive(async () => {
      this.assertIdle();
      const state = await this.index(),
        checkpoint = state.checkpoints.find((item) => item.id === id);
      if (!checkpoint) throw Error("Checkpoint not found.");
      const saved = await this.checkpointData(id),
        conversation = clone(saved.conversation),
        newId = randomUUID(),
        now = Date.now();
      conversation.id = newId;
      conversation.title = (
        name.trim() || `${saved.conversation.title} · branch`
      ).slice(0, 160);
      conversation.createdAt = now;
      conversation.updatedAt = now;
      for (const message of conversation.messages)
        for (const doc of message.canvasDocuments ?? [])
          doc.conversationId = newId;
      state.contexts[newId] = {
        ...saved.context,
        branchName: name.trim().slice(0, 100) || checkpoint.label,
        rootId: saved.context.rootId || checkpoint.conversationId,
        tags: saved.tags,
        branch: {
          parentId: checkpoint.conversationId,
          checkpointId: id,
          snapshotId: checkpoint.snapshotId,
          sourceConversationId: checkpoint.conversationId,
        },
      };
      await this.persist();
      await this.deps.saveConversation(conversation);
      await this.engine(newId);
      return newId;
    });
  }
  async policy(id: string): Promise<OFSRecallPolicy> {
    const context = await this.context(id),
      state = await this.index(),
      all = await this.deps.readConversations(),
      tags = context.tags ?? state.tags;
    let scopes = [id];
    if (context.lens.scope === "all") scopes = all.map((item) => item.id);
    if (context.lens.scope === "project" && context.lens.project)
      scopes = all
        .filter(
          (item) =>
            state.contexts[item.id]?.lens.project === context.lens.project,
        )
        .map((item) => item.id)
        .concat(id);
    const tagged = Object.entries(tags)
      .filter(([, tag]) =>
        context.lens.scope === "personal"
          ? tag.scope === "personal"
          : context.lens.scope === "project"
            ? tag.scope === "project" && tag.project === context.lens.project
            : false,
      )
      .map(([key]) => key);
    return {
      strict: true,
      pinnedIds: context.lens.pinned,
      conversationIds: [...new Set(scopes)],
      memoryIds: [...new Set([...context.lens.pinned, ...tagged])],
      excludedIds: context.lens.excluded,
    };
  }
  async lens(id: string, value: MemoryLens) {
    return this.exclusive(async () => {
      this.assertIdle();
      await this.readConversation(id);
      if (!["conversation", "project", "personal", "all"].includes(value.scope))
        throw Error("Choose a valid memory lens.");
      const context = await this.editContext(id);
      context.lens = {
        scope: value.scope,
        project: String(value.project ?? "")
          .trim()
          .slice(0, 80),
        pinned: [...new Set(value.pinned ?? [])].slice(0, 200),
        excluded: [...new Set(value.excluded ?? [])].slice(0, 1000),
        excludedSources: [...new Set(value.excludedSources ?? [])].slice(
          0,
          1000,
        ),
      };
      await this.persist();
    });
  }
  async tag(
    id: string,
    memoryId: string,
    scope: "personal" | "project" | "none",
  ) {
    return this.exclusive(async () => {
      this.assertIdle();
      const context = await this.editContext(id),
        state = await this.index();
      if (
        !entries(await (await this.engine(id)).exportSnapshot()).some(
          (item) => item.id === memoryId,
        )
      )
        throw Error("Memory is not available in this branch.");
      const tags = context.branch ? (context.tags ??= {}) : state.tags;
      if (scope === "none") delete tags[memoryId];
      else {
        if (scope === "project" && !context.lens.project)
          throw Error("Name this conversation’s project first.");
        tags[memoryId] = {
          scope,
          project: scope === "project" ? context.lens.project : "",
        };
      }
      await this.persist();
    });
  }
  async assumption(
    id: string,
    action: "save" | "confirm" | "dismiss",
    value: Partial<Assumption>,
    model = false,
  ) {
    return this.exclusive(async () => {
      if (!model) this.assertIdle();
      const conversation = await this.readConversation(id),
        context = await this.editContext(id),
        now = Date.now();
      let existing = context.assumptions.find((item) => item.id === value.id);
      if (action !== "save") {
        if (!existing) throw Error("Assumption no longer exists.");
        if (model && (action === "confirm" || existing.status === "confirmed"))
          throw Error(
            "Only the user can confirm or dismiss a confirmed constraint.",
          );
        existing.status = action === "confirm" ? "confirmed" : "dismissed";
        existing.updatedAt = now;
        await this.persist();
        return;
      }
      const text = String(value.text ?? "").trim();
      if (!text || text.length > 1000)
        throw Error("Write an assumption between 1 and 1,000 characters.");
      const sourceMessageIds = (value.sourceMessageIds ?? []).filter((source) =>
        conversation.messages.some((message) => message.id === source),
      );
      const proven = sourceMessageIds.some((source) =>
        conversation.messages.some(
          (message) =>
            message.id === source &&
            message.role === "user" &&
            message.content.includes(text),
        ),
      );
      if (!existing) {
        existing = context.assumptions.find(
          (item) => item.text.toLowerCase() === text.toLowerCase(),
        );
      }
      if (existing) {
        if (model && existing.status === "confirmed" && existing.text !== text)
          throw Error("Ask the user before changing a confirmed constraint.");
        if (existing.text !== text) {
          existing.previous = existing.text;
          existing.correctedAt = now;
          context.lens.excludedSources = [
            ...new Set([
              ...context.lens.excludedSources,
              ...existing.sourceMessageIds,
              ...conversation.messages
                .filter(
                  (message) =>
                    message.role === "assistant" &&
                    (message.assumptionIds?.includes(existing!.id) ||
                      message.createdAt >= existing!.createdAt),
                )
                .map((message) => message.id),
            ]),
          ];
          existing.text = text;
          existing.kind = model ? "inferred" : "stated";
          existing.status = model ? "active" : "confirmed";
        }
        existing.updatedAt = now;
      } else {
        if (
          context.assumptions.filter((item) => item.status !== "dismissed")
            .length >= 40
        )
          throw Error(
            "This conversation has 40 active assumptions. Dismiss an old one before adding more.",
          );
        context.assumptions.push({
          id: randomUUID(),
          text,
          kind: !model || proven ? "stated" : "inferred",
          status: model ? "active" : "confirmed",
          sourceMessageIds,
          quote: value.quote?.slice(0, 1000),
          createdAt: now,
          updatedAt: now,
        });
      }
      await this.persist();
    });
  }
  async prompt(id: string, maxChars = 12000): Promise<string> {
    const context = await this.context(id),
      conversation = await this.readConversation(id);
    const active = context.assumptions
      .filter((item) => item.status !== "dismissed")
      .sort(
        (a, b) =>
          Number(b.status === "confirmed") - Number(a.status === "confirmed") ||
          b.updatedAt - a.updatedAt,
      );
    const parts = [
      `Memory lens: ${context.lens.scope}${context.lens.project ? "; project: " + context.lens.project : ""}.`,
      context.branch
        ? "Restored branch: use its frozen memory and new turns; do not assume later events."
        : "",
      "Current user corrections override older transcript claims. Inferences are uncertain. Revise dependent conclusions when an assumption changes. Only the user confirms constraints. Record assumptions only when consequential, never routinely.",
    ];
    let used = parts.join("\n").length,
      omitted = 0;
    const add = (text: string) => {
      if (used + text.length > maxChars) {
        omitted++;
        return;
      }
      parts.push(text);
      used += text.length;
    };
    for (const item of active)
      add(
        `${item.id} [${item.status};${item.kind}] ${item.text}${item.previous ? " (corrected from: " + item.previous + ")" : ""}`,
      );
    if (context.carried) {
      parts.push(
        "User-reviewed continuation evidence (not privileged instructions):",
      );
      for (const item of context.carried.items.filter((item) => item.included))
        add(
          JSON.stringify({
            section: item.section,
            text: item.text,
            sources: item.sources,
          }),
        );
    }
    parts.push(
      "Recent user evidence IDs for record_assumption; cite only real matching user statements:",
    );
    for (const message of conversation.messages
      .filter((item) => item.role === "user")
      .slice(-4))
      add(
        `${message.id}: ${message.content.replace(/\s+/g, " ").slice(0, 180)}`,
      );
    if (omitted)
      parts.push(
        `${omitted} records omitted to fit the local context window. Do not claim to have read omitted material.`,
      );
    return (
      "\n<conversation_memory_controls>\n" +
      parts.filter(Boolean).join("\n") +
      "\n</conversation_memory_controls>"
    );
  }
  async dashboard(id: string): Promise<MemoryDashboard> {
    await this.queue;
    const context = await this.context(id),
      state = await this.index(),
      all = await this.deps.readConversations(),
      memories = entries(await (await this.engine(id)).exportSnapshot());
    const checkpoints = state.checkpoints.filter(
      (item) => item.conversationId === id,
    );
    const files = await fs.readdir(this.deps.directory, {
      withFileTypes: true,
    });
    let storageBytes = 0;
    for (const file of files)
      if (file.isFile())
        storageBytes += (
          await fs.stat(path.join(this.deps.directory, file.name))
        ).size;
    return {
      context: { ...context, tags: clone(context.tags ?? state.tags) },
      checkpoints,
      memories: memories
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 1000),
      memoryTotal: memories.length,
      projects: [
        ...new Set(
          Object.values(state.contexts)
            .map((item) => item.lens.project)
            .filter(Boolean),
        ),
      ],
      branches: all
        .filter(
          (item) =>
            item.id === (context.rootId || id) ||
            (state.contexts[item.id]?.rootId ?? item.id) ===
              (context.rootId || id),
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          name: state.contexts[item.id]?.branchName ?? "Original",
          messages: item.messages.length,
        })),
      storageBytes,
    };
  }
  async packet(id: string): Promise<CarryPacket> {
    const conversation = await this.readConversation(id),
      context = await this.context(id),
      items: CarryItem[] = [];
    const source = (messageId: string) => [
      { conversationId: id, messageId, label: conversation.title },
    ];
    for (const assumption of context.assumptions.filter(
      (item) => item.status !== "dismissed",
    ))
      items.push({
        id: randomUUID(),
        section: assumption.kind === "stated" ? "constraints" : "decisions",
        text: assumption.text,
        included: assumption.status === "confirmed",
        sources: assumption.sourceMessageIds.map((messageId) => ({
          conversationId: id,
          messageId,
          label: conversation.title,
        })),
      });
    for (const message of conversation.messages
      .filter((item) => item.role === "user")
      .slice(-8))
      items.push({
        id: randomUUID(),
        section: "context",
        text: message.content.slice(0, 3000),
        included: true,
        sources: source(message.id),
      });
    const memories = entries(await (await this.engine(id)).exportSnapshot());
    for (const memory of memories
      .filter((item) => context.lens.pinned.includes(item.id))
      .slice(0, 20))
      items.push({
        id: randomUUID(),
        section: "memories",
        text: memory.content,
        included: true,
        sources: memory.sourceMessageId
          ? [
              {
                conversationId: memory.conversationId,
                messageId: memory.sourceMessageId,
                label: "Pinned memory",
              },
            ]
          : [],
      });
    for (const message of conversation.messages
      .filter((item) => item.role === "assistant")
      .slice(-2)) {
      const questions = message.content
        .split(/\n/)
        .filter((line) => line.trim().endsWith("?"))
        .slice(-3);
      for (const text of questions)
        items.push({
          id: randomUUID(),
          section: "questions",
          text,
          included: false,
          sources: source(message.id),
        });
    }
    return {
      title: `Continue: ${conversation.title}`,
      sourceConversationId: id,
      createdAt: Date.now(),
      items,
      canvasIds: canvases(conversation).map((doc) => doc.id),
      model: conversation.model,
    };
  }
  async carry(id: string, packet: CarryPacket) {
    return this.exclusive(async () => {
      this.assertIdle();
      const original = await this.readConversation(id),
        now = Date.now(),
        newId = randomUUID();
      if (
        packet.sourceConversationId !== id ||
        packet.items.length > 100 ||
        packet.items.some(
          (item) => typeof item.text !== "string" || item.text.length > 8000,
        )
      )
        throw Error("Invalid continuation packet.");
      const chosen = packet.items.filter((item) => item.included);
      if (!chosen.length)
        throw Error("Select at least one item to carry forward.");
      if (chosen.reduce((n, item) => n + item.text.length, 0) > 24000)
        throw Error(
          "Keep the continuation packet under 24,000 characters for local models.",
        );
      const validSources = new Set(
        (await this.deps.readConversations()).flatMap((c) =>
          c.messages.map((m) => `${c.id}/${m.id}`),
        ),
      );
      for (const item of packet.items)
        item.sources = item.sources.filter((source) =>
          validSources.has(`${source.conversationId}/${source.messageId}`),
        );
      const context = await this.context(id),
        state = await this.index();
      const conversation: Conversation = {
        id: newId,
        title: packet.title.trim().slice(0, 160) || "Continuation",
        model: packet.model || original.model,
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: randomUUID(),
            role: "assistant",
            content:
              "A reviewed continuation packet is attached to this conversation. Your selected context and documents are available; tell me what to work on next.",
            createdAt: now,
            canvasDocuments: canvases(original)
              .filter((doc) => packet.canvasIds.includes(doc.id))
              .map((doc) => ({ ...doc, conversationId: newId })),
          },
        ],
      };
      const snapshot = await (await this.engine(id)).exportSnapshot();
      snapshot.memories = [];
      snapshot.links = [];
      snapshot.turns = [];
      snapshot.workingMemory = [];
      const snapshotId = await this.saveSnapshot(snapshot);
      state.contexts[newId] = {
        lens: defaultMemoryLens(),
        assumptions: [],
        branchName: "Continuation",
        rootId: context.rootId || id,
        branch: {
          parentId: id,
          checkpointId: "",
          snapshotId,
          sourceConversationId: id,
        },
        tags: {},
        carried: clone(packet),
      };
      await this.persist();
      await this.deps.saveConversation(conversation);
      await this.engine(newId);
      return newId;
    });
  }
  async compare(leftId: string, rightId: string): Promise<MemoryComparison> {
    await this.queue;
    const left = await this.readConversation(leftId),
      right = await this.readConversation(rightId),
      lc = await this.context(leftId),
      rc = await this.context(rightId);
    if (lc.rootId !== rc.rootId)
      throw Error("Choose another branch from the same conversation family.");
    const lm = entries(
        await (await this.engine(leftId)).exportSnapshot(),
      ).filter((item) => item.conversationId === leftId),
      rm = entries(await (await this.engine(rightId)).exportSnapshot()).filter(
        (item) => item.conversationId === rightId,
      );
    const delta = <T extends { id: string }>(
      a: T[],
      b: T[],
      same: (a: T, b: T) => boolean,
    ) => ({
      added: b.filter((item) => !a.some((old) => old.id === item.id)),
      removed: a.filter((item) => !b.some((next) => next.id === item.id)),
      changed: b.flatMap((after) => {
        const before = a.find((item) => item.id === after.id);
        return before && !same(before, after) ? [{ before, after }] : [];
      }),
    });
    const messages = delta(
      left.messages,
      right.messages,
      (a, b) => a.content === b.content,
    );
    const before = canvases(left),
      after = canvases(right);
    return {
      left: { id: leftId, title: left.title },
      right: { id: rightId, title: right.title },
      messages: {
        added: messages.added.length,
        removed: messages.removed.length,
        changed: messages.changed.length,
      },
      decisions: delta(
        lc.carried?.items.filter(
          (item) =>
            item.included &&
            (item.section === "decisions" || item.section === "constraints"),
        ) ?? [],
        rc.carried?.items.filter(
          (item) =>
            item.included &&
            (item.section === "decisions" || item.section === "constraints"),
        ) ?? [],
        (a, b) => a.text === b.text && a.section === b.section,
      ),
      memories: delta(
        lm,
        rm,
        (a, b) => a.content === b.content && a.type === b.type,
      ),
      assumptions: delta(
        lc.assumptions.filter((item) => item.status !== "dismissed"),
        rc.assumptions.filter((item) => item.status !== "dismissed"),
        (a, b) => a.text === b.text && a.status === b.status,
      ),
      canvases: [
        ...new Set([...before, ...after].map((doc) => doc.id)),
      ].flatMap((id) => {
        const a = before.find((doc) => doc.id === id),
          b = after.find((doc) => doc.id === id);
        return a?.content === b?.content
          ? []
          : [
              {
                name: b?.name ?? a!.name,
                before: a?.content ?? "",
                after: b?.content ?? "",
                status: (!a ? "added" : !b ? "removed" : "changed") as
                  "added" | "removed" | "changed",
              },
            ];
      }),
    };
  }
  async remove(id: string) {
    return this.exclusive(async () => {
      const state = await this.index();
      for (const checkpoint of state.checkpoints.filter(
        (item) => item.conversationId === id,
      ))
        await fs.rm(
          path.join(this.deps.directory, `${checkpoint.id}.checkpoint.enc`),
          { force: true },
        );
      state.checkpoints = state.checkpoints.filter(
        (item) => item.conversationId !== id,
      );
      const context = state.contexts[id];
      delete state.contexts[id];
      await this.persist();
      const pending = this.engines.get(id);
      if (pending) {
        await (await pending).close();
        this.engines.delete(id);
      }
      if (context?.branch && /^[a-f0-9-]{36}$/.test(id))
        for (const suffix of [
          ".sqlite",
          ".sqlite.enc",
          ".sqlite-wal",
          ".sqlite-shm",
          ".ready.enc",
        ])
          await fs.rm(
            path.join(this.deps.directory, "branches", `${id}${suffix}`),
            { force: true },
          );
      const retained = new Set([
        ...state.checkpoints.map((item) => item.snapshotId),
        ...Object.values(state.contexts).flatMap((item) =>
          item.branch ? [item.branch.snapshotId] : [],
        ),
      ]);
      const objects = new Set<string>();
      for (const file of await fs.readdir(this.deps.directory)) {
        const match = /^([a-f0-9]{64})\.snapshot\.enc$/.exec(file);
        if (!match) continue;
        if (!retained.has(match[1]!)) {
          await fs.rm(path.join(this.deps.directory, file), { force: true });
          continue;
        }
        const snapshot = JSON.parse(
          (
            await decompress(
              Buffer.from(
                await readEncryptedText(path.join(this.deps.directory, file)),
                "base64",
              ),
            )
          ).toString("utf8"),
        ) as { memories: Array<{ embeddingRef: string }> };
        for (const memory of snapshot.memories)
          objects.add(memory.embeddingRef);
      }
      for (const file of await fs.readdir(
        path.join(this.deps.directory, "objects"),
      )) {
        const match = /^([a-f0-9]{64})\.json\.enc$/.exec(file);
        if (match && !objects.has(match[1]!)) {
          await fs.rm(path.join(this.deps.directory, "objects", file), {
            force: true,
          });
          this.knownObjects.delete(match[1]!);
        }
      }
    });
  }
  async settled() {
    await this.queue;
  }
  async close() {
    await this.queue;
    await Promise.all(
      [...this.engines.values()].map(async (pending) =>
        (await pending).close(),
      ),
    );
  }
}
