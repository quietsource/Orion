export interface MemoryLens {
  scope: "conversation" | "project" | "personal" | "all";
  project: string;
  pinned: string[];
  excluded: string[];
  excludedSources: string[];
}
export interface Assumption {
  id: string;
  text: string;
  kind: "stated" | "inferred";
  status: "active" | "confirmed" | "dismissed";
  sourceMessageIds: string[];
  quote?: string;
  createdAt: number;
  updatedAt: number;
  previous?: string;
  correctedAt?: number;
}
export interface MemoryContext {
  lens: MemoryLens;
  assumptions: Assumption[];
  branchName: string;
  rootId: string;
  branch?: {
    parentId: string;
    checkpointId: string;
    snapshotId: string;
    sourceConversationId: string;
  };
  carried?: CarryPacket;
  tags?: Record<string, { scope: "personal" | "project"; project: string }>;
}
export interface MemoryCheckpoint {
  id: string;
  conversationId: string;
  label: string;
  createdAt: number;
  messageCount: number;
  lastMessageId: string;
  excerpt: string;
  snapshotId: string;
  memoryCount: number;
  canvasCount: number;
}
export interface MemoryEntry {
  id: string;
  content: string;
  type: string;
  conversationId: string;
  sourceMessageId: string | null;
  createdAt: number;
  importance: number;
  entities: string[];
}
export interface MemorySource {
  conversationId: string;
  messageId: string;
  label: string;
}
export interface CarryItem {
  id: string;
  section: "decisions" | "constraints" | "memories" | "questions" | "context";
  text: string;
  included: boolean;
  sources: MemorySource[];
}
export interface CarryPacket {
  title: string;
  sourceConversationId: string;
  createdAt: number;
  items: CarryItem[];
  canvasIds: string[];
  model: string;
}
export interface MemoryDashboard {
  context: MemoryContext;
  checkpoints: MemoryCheckpoint[];
  memories: MemoryEntry[];
  memoryTotal: number;
  projects: string[];
  branches: Array<{
    id: string;
    title: string;
    name: string;
    messages: number;
  }>;
  storageBytes: number;
}
export interface MemoryComparison {
  left: { id: string; title: string };
  right: { id: string; title: string };
  messages: { added: number; removed: number; changed: number };
  memories: {
    added: MemoryEntry[];
    removed: MemoryEntry[];
    changed: Array<{ before: MemoryEntry; after: MemoryEntry }>;
  };
  decisions: {
    added: CarryItem[];
    removed: CarryItem[];
    changed: Array<{ before: CarryItem; after: CarryItem }>;
  };
  assumptions: {
    added: Assumption[];
    removed: Assumption[];
    changed: Array<{ before: Assumption; after: Assumption }>;
  };
  canvases: Array<{
    name: string;
    before: string;
    after: string;
    status: "added" | "removed" | "changed";
  }>;
}
export interface ConversationCleanup {
  memoryIds: string[];
  checkpointIds: string[];
  assumptionIds: string[];
  canvasIds: string[];
  attachmentIds: string[];
}
export interface CleanupPreview {
  memories: MemoryEntry[];
  checkpoints: MemoryCheckpoint[];
  assumptions: Assumption[];
  documents: Array<{ id: string; name: string }>;
  attachments: Array<{ id: string; name: string; bytes: number }>;
}
export interface MemoryHistoryAPI {
  cleanupPreview(conversationId: string): Promise<CleanupPreview>;
  cleanup(conversationId: string, selection: ConversationCleanup): Promise<void>;
  context(conversationId: string): Promise<MemoryContext>;
  dashboard(conversationId: string): Promise<MemoryDashboard>;
  checkpoint(conversationId: string, label?: string): Promise<MemoryCheckpoint>;
  preview(checkpointId: string): Promise<{
    checkpoint: MemoryCheckpoint;
    context: MemoryContext;
    memories: MemoryEntry[];
    messages: Array<{ role: string; content: string }>;
    canvases: Array<{ name: string; content: string }>;
  }>;
  branch(checkpointId: string, name: string): Promise<string>;
  lens(conversationId: string, lens: MemoryLens): Promise<void>;
  assumption(
    conversationId: string,
    action: "save" | "confirm" | "dismiss",
    value: Partial<Assumption>,
  ): Promise<void>;
  tag(
    conversationId: string,
    memoryId: string,
    scope: "personal" | "project" | "none",
  ): Promise<void>;
  packet(conversationId: string): Promise<CarryPacket>;
  carry(conversationId: string, packet: CarryPacket): Promise<string>;
  compare(leftId: string, rightId: string): Promise<MemoryComparison>;
}
export const defaultMemoryLens = (): MemoryLens => ({
  scope: "conversation",
  project: "",
  pinned: [],
  excluded: [],
  excludedSources: [],
});
