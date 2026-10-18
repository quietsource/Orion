export type ApiProviderKind = 'openai-compatible'|'openai'|'anthropic'|'google'|'zai'|'moonshotai'|'opencode'|'opencode-go'|'openrouter';
export interface ApiProvider { id: string; name: string; baseUrl: string; models: string[]; tools: boolean; kind?: ApiProviderKind; apiKey?: string; keyConfigured?: boolean; }
export type Role = 'user' | 'assistant' | 'system';
export interface ModelCompatibilityReport { status: 'compatible'|'repaired'|'unsupported'|'error'; detail: string; runtimeRelease: string; checkedAt: number; canRepair?: boolean; actions?: string[]; restoreWarning?: string; }
export interface ToolCallRecord { id: string; name: string; description?: string; input: Record<string, unknown>; status: 'pending'|'running'|'completed'|'denied'|'error'; output?: string; imagePath?: string; mediaType?: 'image'|'video'; progress?: number; progressDetail?: string; }
export interface WebResearchSource { title: string; url: string; snippet?: string; status: 'reading'|'read'|'error'; }
export interface WebResearchStep { id: string; query: string; status: 'searching'|'reading'|'complete'|'error'; sources: WebResearchSource[]; error?: string; }
export interface WebResearchActivity { status: 'planning'|'searching'|'reading'|'complete'|'error'; steps: WebResearchStep[]; }
export interface WebResearchEvent { stepId: string; phase: 'planning'|'searching'|'reading'|'source'|'complete'|'error'; query?: string; source?: WebResearchSource; error?: string; }
export interface MessageAttachment { id: string; name: string; mimeType: string; kind: 'image'|'document'; }
export interface Message { id: string; role: Role; content: string; createdAt: number; reasoning?: string; toolCalls?: ToolCallRecord[]; webResearch?: WebResearchActivity; attachments?: MessageAttachment[]; generationMs?: number; tokensPerSecond?: number; }
export type CanvasFormat = 'markdown'|'html'|'pdf'|'text'|'code'|'image';
export interface CanvasDocument { id: string; name: string; format: CanvasFormat; content: string; textContent?: string; attachment?: MessageAttachment; path?: string; conversationId?: string; source: 'workspace'|'local'|'response'; }
export interface CanvasEvent { conversationId: string; document: CanvasDocument; }
export type ToolMode = 'chat' | 'code';
export interface Conversation { id: string; title: string; model: string; createdAt: number; updatedAt: number; messages: Message[]; summary?: string; workspacePath?: string; mode?: ToolMode; }
export type OrionTheme = 'graphite' | 'midnight' | 'ocean' | 'forest' | 'rose' | 'ember' | 'light' | 'paper';
export interface AppSettings { ollamaUrl: string; selectedModel: string; defaultImageModel: string; defaultVideoModel: string; temperature: number; contextWindow: number; approvalLevel: 'all' | 'external' | 'none'; approvedTools: string[]; workspacePath: string; keepInTray: boolean; interConversationMemory: boolean; experimentalOfsMemory: boolean; startNewConversation: boolean; theme: OrionTheme; disabledTools: string[]; subagentMaxParallel: 0|1|2; }
export interface WorkspaceChange { path: string; status: 'added'|'modified'|'deleted'; additions: number; deletions: number; diff: string; }
export interface WorkspaceReview { conversationId: string; root: string; changes: WorkspaceChange[]; additions: number; deletions: number; }
export interface GitCheckpoint { id: string; label: string; ref: string; createdAt: number; }
export interface WorkspaceStatus { root: string; git: boolean; branch: string|null; changedFiles: number; additions: number; deletions: number; checkpoints: GitCheckpoint[]; }
export interface ToolRequest { id: string; name: string; description: string; input: Record<string, unknown>; requiresApproval: boolean; conversationId?: string; }
export interface UserQuestionRequest { id: string; conversationId: string; questions: Array<{ question: string; options: string[] }>; }
export type ScheduledJobStatus = 'scheduled'|'queued'|'running'|'completed'|'error';
export interface ScheduledJob { id: string; name: string; cron: string; timezone: string; prompt: string; model: string; agent: boolean; createdBy: 'user'|'agent'; enabled: boolean; status: ScheduledJobStatus; nextRunAt: number|null; lastRunAt: number|null; lastOutput?: string; lastConversationId?: string; createdAt: number; updatedAt: number; }
export type ModelCategory = 'conversational'|'image'|'video';
export interface HubModel { id: string; author?: string; downloads?: number; likes?: number; pipelineTag?: string; description?: string; license?: string; }
export interface HubSearchPage { models: HubModel[]; nextUrl: string | null; }
export interface HubFile { name: string; size: number; sha256?: string; downloadRepo?: string; downloadName?: string; relatedFiles?: Array<{ name: string; size: number; sha256?: string; downloadRepo?: string; downloadName?: string }>; }
export interface InstalledModel { id: string; repo: string; file: string; category: ModelCategory; path: string; files?: string[]; fileSha256?: Record<string,string>; bundleVersion?: number; size: number; downloadedAt: number; source?: string; invokeKey?: string; }
export interface DownloadProgress { id: string; repo: string; file: string; received: number; total: number; phase: 'downloading'|'complete'|'cancelled'|'error'; error?: string; }
export interface BackendState { installed: boolean; running: boolean; firstEntrySeen: boolean; phase: string; detail: string; gpu: string; port?: number; }
export interface CreateProgress { id: string; phase: string; detail: string; percent?: number; imagePath?: string; mediaType?: 'image'|'video'; error?: string; download?: { repo: string; file: string; received: number; total: number; phase: DownloadProgress['phase'] }; }
export interface GeneratedMedia { id: string; prompt: string; modelId: string; path: string; mediaType: 'image'|'video'; createdAt: number; }
export interface AppUpdateState { phase: 'idle'|'available'|'downloading'|'installing'|'error'; version?: string; notes?: string; received?: number; total?: number; detail?: string; }
export interface OrionAPI {
  listOFSMemories(offset?: number): Promise<{ total: number; items: Array<{ id: string; content: string; type: string; entities: string[]; importance: number; createdAt: number; conversationId: string; sourceMessageId: string | null }> }>;
  listProviders(): Promise<ApiProvider[]>;
  saveProvider(provider: ApiProvider): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  discoverProviderModels(provider: ApiProvider): Promise<string[]>;
  windowAction(action: 'minimize' | 'toggle-maximize' | 'close'): Promise<void>;
  getModelInfo(model: string): Promise<{ contextLength: number; supportsThinking: boolean; thinkingDefault?: boolean|string }> ;
  listModels(): Promise<{ name: string; size: number; details?: Record<string, unknown>; capabilities?: string[]; source?: 'ollama'|'orion'|'api' }[]>;
  ollamaStatus(): Promise<boolean>;
  listConversations(): Promise<Conversation[]>; storageWarning(): Promise<string|null>; getConversation(id: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation, indexMemory?: boolean): Promise<void>; memoryStats(conversationId?: string): Promise<{ indexedTokens: number; limitTokens: number; chunks: number; embeddedChunks: number; embeddingModel: string|null; semantic: boolean; recoveryWarning: string|null; rebuilding: boolean; engine?: 'orion'|'ofs'; activeMemories?: number; workingTurns?: number; links?: number; databaseBytes?: number }>; rebuildMemory(): Promise<void>; deleteConversation(id: string): Promise<void>;
  settings(): Promise<AppSettings>; saveSettings(settings: AppSettings): Promise<void>; getSystemPrompt(model?: string, mode?: ToolMode): Promise<string>;
  listTools(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  streamChat(input: { conversationId: string; model: string; messages: Message[]; agent: boolean; mode?: ToolMode; webSearch?: boolean }): Promise<{ tokensPerSecond?: number }>;
  cancelStream(): Promise<void>; onStream(callback: (event: { conversationId: string; type: 'token'|'replace'|'reasoning'|'done'|'cancelled'|'error'|'tool'|'context'|'workspace'|'web'|'canvas'; content?: string; tokensPerSecond?: number; usedContextTokens?: number; maxContextTokens?: number; finishReason?: string; tool?: ToolRequest; phase?: 'started'|'updated'|'finished'; result?: { output: string; success: boolean; imagePath?: string; mediaType?: 'image'|'video' }; workspaceReview?: WorkspaceReview; web?: WebResearchEvent; canvas?: CanvasDocument }) => void): () => void;
  installMemoryEmbedding(): Promise<void>;
  onMemoryProgress(callback: (progress: { completed: number; total: number; status?: string; error?: string }) => void): () => void;
  searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]>;
  selectFiles(): Promise<Array<{ name: string; path: string; content: string; mimeType: string; kind: 'image'|'document'; attachment?: MessageAttachment }>>;
  selectCanvasFile(): Promise<CanvasDocument|null>;
  openCanvasPath(path: string): Promise<CanvasDocument>;
  getPathForFile(file: File): string;
  saveCanvasRevision(conversationId: string, path: string, content: string): Promise<void>;
  selectWorkspace(): Promise<string | null>;
  createWorkspace(name: string): Promise<string>;
  getWorkspaceStatus(): Promise<WorkspaceStatus>;
  getWorkspaceReview(conversationId: string): Promise<WorkspaceReview|null>;
  resolveWorkspaceReview(conversationId: string, approve: boolean): Promise<{ success: boolean; message: string }>;
  createGitCheckpoint(label?: string): Promise<GitCheckpoint>;
  previewGitRollback(checkpointId: string): Promise<string>;
  rollbackGitCheckpoint(checkpointId: string): Promise<void>;
  respondToTool(id: string, decision: 'allow-once'|'allow-always'|'decline'): Promise<boolean>;
  onToolRequest(callback: (tool: ToolRequest) => void): () => void;
  respondToQuestion(id: string, answer: string): Promise<void>;
  onUserQuestion(callback: (question: UserQuestionRequest) => void): () => void;
  getSystemInfo(): Promise<{ platform: string; ollama: boolean; cpuUsagePercent: number|null; usedRamMB: number; totalRamMB: number; gpuUsagePercent: number|null; usedVramMB: number | null; totalVramMB: number }>;
  listScheduledJobs(): Promise<ScheduledJob[]>; saveScheduledJob(job: Partial<ScheduledJob>): Promise<ScheduledJob>; deleteScheduledJob(id: string): Promise<void>;
  onScheduledJob(callback: (job: ScheduledJob) => void): () => void; onScheduledJobsChanged(callback: () => void): () => void; completeScheduledJob(id: string, status: 'completed'|'error', output: string, conversationId: string): Promise<void>;
  searchHub(query: string, category: ModelCategory, nextUrl?: string|null): Promise<HubSearchPage>; getHubFiles(repo: string, category?: ModelCategory): Promise<HubFile[]>;   setHuggingFaceToken(token: string): Promise<'valid'|'invalid'|'unknown'>;
  getHuggingFaceTokenConfigured(): Promise<boolean>;
  downloadHubModel(repo: string, file: string, category: ModelCategory): Promise<InstalledModel>; cancelModelDownload(id: string): Promise<void>; listInstalledModels(): Promise<InstalledModel[]>;
  deleteInstalledModel(id: string): Promise<void>; deleteOllamaModel(name: string): Promise<void>; onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  enterCreate(): Promise<{ state: BackendState; showInstallPrompt: boolean }>; getCreateEngineState(): Promise<BackendState>; installCreateEngine(): Promise<BackendState>;
  shouldShowLlamaIntro(): Promise<boolean>; dismissLlamaIntro(): Promise<void>; installLlama(): Promise<void>;
  llamaStatus(): Promise<boolean>;
  checkModelCompatibility(id: string): Promise<ModelCompatibilityReport>;
  listGeneratedMedia(): Promise<GeneratedMedia[]>;
  openGeneratedFolder(): Promise<void>;
  generateImage(prompt: string, modelId?: string, kind?: 'image'|'video', requestId?: string): Promise<{ id: string; imagePath: string; mediaType: 'image'|'video' }>;
  readGeneratedMedia(imagePath: string): Promise<string>; onCreateProgress(callback: (progress: CreateProgress) => void): () => void;
  getAppUpdateState(): Promise<AppUpdateState>; startAppUpdate(): Promise<void>; consumeUpdateChangelog(): Promise<{ version: string; notes: string }|null>; onAppUpdateState(callback: (state: AppUpdateState) => void): () => void;
}
