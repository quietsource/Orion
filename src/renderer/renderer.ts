declare const __ORION_VERSION__: string;

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { languageModules } from './highlight-languages.generated';
import 'highlight.js/styles/github-dark.css';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad:false, theme:'dark', securityLevel:'strict', flowchart:{htmlLabels:false} });
function applyTheme(theme: AppSettings['theme']) { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; document.documentElement.style.colorScheme = theme === 'light' || theme === 'paper' ? 'light' : 'dark'; mermaid.initialize({ startOnLoad:false, theme:theme === 'light' || theme === 'paper' ? 'default' : 'dark', securityLevel:'strict', flowchart:{htmlLabels:false} }); }
window.orion.onDiagramValidationRequest(request => {
  if (!request.source.trim() || request.source.length > 20000) { void window.orion.respondToDiagramValidation(request.id, { valid: false, error: 'Diagram source must be between 1 and 20,000 characters.' }); return; }
  void mermaid.parse(request.source).then(
    () => window.orion.respondToDiagramValidation(request.id, { valid: true }),
    error => window.orion.respondToDiagramValidation(request.id, { valid: false, error: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200) })
  );
});
import type { AppSettings, Conversation, Message, MessageAttachment, CanvasDocument, ScheduledJob, ToolCallRecord, ToolRequest, UserQuestionRequest, ModelCategory, HubModel, HubFile, InstalledModel, DownloadProgress, CreateProgress, BackendState, GeneratedMedia, WorkspaceReview, WorkspaceStatus, ToolMode, WebResearchSource, AppUpdateState } from '../shared/types';
import './style.css';
import './agent.css';

const $ = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Orion UI is missing the required #${id} element.`);
  return element as T;
};
for (const [file, language] of Object.entries(languageModules)) {
  const name = file.split('/').pop()?.replace(/\.js$/, '') ?? '';
  if (!name || name.endsWith('.js')) continue;
  hljs.registerLanguage(name, language as Parameters<typeof hljs.registerLanguage>[1]);
}
const chatBox = $('messages'), chatScroller = $('chat'), historyBox = $('history'), promptBox = $('prompt') as HTMLTextAreaElement, composer = $('composer');
const approvalControl = document.createElement('select');
approvalControl.className = 'approval-selector'; approvalControl.setAttribute('aria-label', 'Tool approval level');
approvalControl.title = 'Tool approvals are currently disabled'; approvalControl.disabled = true; approvalControl.hidden = true;
for (const [value, label] of [['all', 'Ask all'], ['external', 'Ask on changes'], ['none', 'Never ask']] as const) approvalControl.add(new Option(label, value));
document.querySelector('#approval')?.closest('label')?.remove();
const composerHint = document.querySelector<HTMLElement>('.composer-hint');
if (composerHint) composerHint.textContent = 'Local & Private';
const conversationMap = $('conversation-map'), conversationMapItems = $('conversation-map-items');
let conversationMapKey = '';
const autoDetectLanguages = ['javascript','typescript','python','json','bash','xml','css','markdown','c','cpp','csharp','diff','go','graphql','ini','java','kotlin','less','lua','makefile','perl','objectivec','php','plaintext','python-repl','r','ruby','rust','scss','shell','sql','swift','yaml','vbnet','wasm'];
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!)); }
function decodeHtmlEntities(value: string) { return new DOMParser().parseFromString(value, 'text/html').documentElement.textContent ?? ''; }
function normalizeMarkdownTables(source: string) {
  const lines=source.split(/\r?\n/), output:string[]=[];let fenced=false;
  const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|');
  const isRow=(line:string)=>line.includes('|')&&cells(line).length>=2;
  const isSeparator=(line:string)=>isRow(line)&&cells(line).every(cell=>/^\s*:?-{3,}:?\s*$/.test(cell));
  for(let index=0;index<lines.length;){
    if(/^\s*(```|~~~)/.test(lines[index]!)){fenced=!fenced;output.push(lines[index++]!);continue;}
    if(!fenced&&isRow(lines[index]!)){
      let end=index+1;while(end<lines.length&&isRow(lines[end]!))end++;
      if(end-index>=2){output.push(lines[index]!);if(!isSeparator(lines[index+1]!)){const columns=cells(lines[index]!).length;output.push(`| ${Array(columns).fill('---').join(' | ')} |`);}output.push(...lines.slice(index+1,end));index=end;continue;}
    }
    output.push(lines[index++]!);
  }
  return output.join('\n');
}
function normalizeRawMermaid(source: string) {
  const lines=source.split(/\r?\n/);let fenced=false,start=-1;
  const header=/^(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)\b|^(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey|quadrantChart|xychart-beta|block-beta|architecture-beta|sankey-beta|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|zenuml|packet-beta|kanban|treemap|radar-beta|info)\b/i;
  for(let index=0;index<lines.length;index++){
    if(/^\s*(```|~~~)/.test(lines[index]!)){if(/^\s*(```|~~~)\s*mermaid\b/i.test(lines[index]!))return source;fenced=!fenced;continue;}
    if(!fenced&&header.test(decodeHtmlEntities(lines[index]!).replace(/\\[ \t]*$/,'').trim())){start=index;break;}
  }
  if(start<0)return source;
  const before=lines.slice(0,start).join('\n').trimEnd(),diagram=decodeHtmlEntities(lines.slice(start).map(line=>line.replace(/\\[ \t]*$/,'')).join('\n')).trim();
  return `${before}${before?'\n\n':''}\`\`\`mermaid\n${diagram}\n\`\`\``;
}
const marked = new Marked({ gfm: true, breaks: true, extensions: [
  { name: 'blockMath', level: 'block', start(source) { const index=source.indexOf('$$'); return index < 0 ? undefined : index; }, tokenizer(source) { const match=/^\$\$([\s\S]+?)\$\$(?:\r?\n|$)/.exec(source); if(!match)return; return {type:'blockMath',raw:match[0],text:match[1]!}; }, renderer(token) { return `<div class="math-block">${katex.renderToString((token as unknown as {text:string}).text,{displayMode:true,throwOnError:false,strict:'ignore'})}</div>`; } },
  { name: 'inlineMath', level: 'inline', start(source) { const index=source.indexOf('$'); return index < 0 ? undefined : index; }, tokenizer(source) { if(source.startsWith('$$'))return; const match=/^\$((?:\\.|[^$\\\n])+?)\$(?!\$)/.exec(source); if(!match)return; return {type:'inlineMath',raw:match[0],text:match[1]!}; }, renderer(token) { return `<span class="math-inline">${katex.renderToString((token as unknown as {text:string}).text,{throwOnError:false,strict:'ignore'})}</span>`; } }
], renderer: { code({ text, lang }) { if(lang?.trim().toLowerCase()==='mermaid')return `<div class="mermaid-block"><details class="mermaid-source"><summary>Diagram source</summary><pre>${escapeHtml(text)}</pre></details><div class="mermaid-render" role="img" aria-label="Mermaid diagram"></div></div>`; const validLang = lang && hljs.getLanguage(lang) ? lang : ''; const highlighted = lightweightMarkdown ? escapeHtml(text) : validLang ? hljs.highlight(text, { language: validLang }).value : hljs.highlightAuto(text, autoDetectLanguages).value; const escapedLang = (lang || 'Code').replace(/[<>&"']/g, ''); const lines = Math.max(1, text.replace(/\n$/, '').split('\n').length); return `<div class="code-block"><div class="code-header"><button class="open-code-canvas" type="button" data-canvas-content="${encodeURIComponent(text)}" data-canvas-lang="${escapedLang}">Canvas</button><span class="code-lang">${escapedLang}</span><button class="copy-code" data-copy="${encodeURIComponent(text)}">Copy</button></div><div class="code-content"><div class="line-numbers">${Array.from({ length: lines }, (_, i) => i + 1).join('<br>')}</div><pre><code class="hljs">${highlighted}</code></pre></div></div>`; } } });
let conversations: Conversation[] = [], current: Conversation | null = null, settings: AppSettings, models: { name: string; size: number; details?: Record<string, unknown>; capabilities?: string[]; source?: 'ollama'|'orion'|'api' }[] = [], attachments: Array<{ name: string; path: string; content: string; mimeType: string; kind: 'image'|'document'; attachment?: MessageAttachment }> = [], streaming = false, ollamaConnected = false, webSearchMode = false, generationStatus = '';
let thinkingModel='';
let canvasReviewAttachment:MessageAttachment|undefined;
let canvasDocument: CanvasDocument|null=null, canvasNotes:Array<{kind:'comment'|'remove';quote:string;text:string}>=[], canvasPrevious:string|null=null, canvasPreviousNotes:Array<{kind:'comment'|'remove';quote:string;text:string}>=[], pendingCanvasReview:{document:CanvasDocument;notes:Array<{kind:'comment'|'remove';quote:string;text:string}>;edited:string}|null=null;
type CanvasSession = { document: CanvasDocument; notes: Array<{kind:'comment'|'remove';quote:string;text:string}>; previous: string|null; previousNotes: Array<{kind:'comment'|'remove';quote:string;text:string}>; mode: 'source'|'preview'|'diff' };
const canvasSessions = new Map<string, CanvasSession>();
let workspaceSettingsWrite: Promise<void> = Promise.resolve();
let activeView: 'Chat' | 'Models' | 'Create' = 'Chat';
let chatMode: ToolMode = 'chat';
let workspaceReview: WorkspaceReview | null = null;
let modelTab: 'conversational'|'creative'|'manage'|'providers' = 'conversational', creativeCategory: 'image'|'video' = 'image';
let modelQuery = '', hubModels: HubModel[] = [], installedModels: InstalledModel[] = [], activeHubRepo = '', activeHubFiles: HubFile[] = [], createState: BackendState | null = null, createEngineStateLoading = false;
let hfTokenConfigured: boolean | null = null, hfTokenDraft = '', hfTokenStatus = '', hfTokenSaveTimer: number | undefined, hfTokenSaveRequest = 0, hfTokenConfigLoading = false;
const popularHubCache = new Map<ModelCategory, HubModel[]>();
let popularHubLoading: ModelCategory | null = null, popularHubError = '', popularHubRequest = 0;
const downloadProgress = new Map<string, DownloadProgress>(), createProgress = new Map<string, CreateProgress>();
let createPromptDraft = '', createKind: 'image'|'video' = 'image';
let engineInstallPending = false;
let engineProgressId = '';
let activeCreateGeneration: { id: string; prompt: string; kind: 'image'|'video' } | null = null;
const modelCardSizes = new Map<string, Promise<{total:number;count:number}>>();
const generatedMedia: GeneratedMedia[] = [];
const mediaUrlCache = new Map<string, Promise<string>>();
function generatedMediaUrl(path: string) { let value=mediaUrlCache.get(path);if(!value){value=window.orion.readGeneratedMedia(path);mediaUrlCache.set(path,value);while(mediaUrlCache.size>12)mediaUrlCache.delete(mediaUrlCache.keys().next().value!);value.catch(()=>mediaUrlCache.delete(path));}return value; }
async function refreshGeneratedGallery() { generatedMedia.splice(0,generatedMedia.length,...await window.orion.listGeneratedMedia()); if(activeView==='Create')renderCreateView(); }
const createPageGenerationIds = new Set<string>();
const createPageGenerationPrompts = new Map<string,string>();
function clearCreatePageSession() { for (const requestId of createPageGenerationIds) createProgress.delete(requestId); createPageGenerationIds.clear(); createPageGenerationPrompts.clear(); activeCreateGeneration = null; }
let mediaPreviewDialog: HTMLDialogElement | null = null;
let mediaPreviewRequest = 0;
function generationDotField() {
  const field = document.createElement('div'); field.className = 'generation-dotfield'; field.setAttribute('aria-hidden', 'true');
  // A fine, evenly spaced field lets each passing displacement read as one
  // ripple moving through the grid instead of a handful of unrelated blinks.
  const columns = 26, rows = 16, sourceX = 0.34, sourceY = 0.52;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const dot = document.createElement('i');
    const dx = column / (columns - 1) - sourceX, dy = row / (rows - 1) - sourceY;
    const distance = Math.hypot(dx, dy), safeDistance = Math.max(distance, 0.025);
    dot.style.setProperty('--push-x', `${(dx / safeDistance * 5.5).toFixed(2)}px`);
    dot.style.setProperty('--push-y', `${(dy / safeDistance * 5.5).toFixed(2)}px`);
    dot.style.setProperty('--wave-delay', `${(-distance * 2.1).toFixed(2)}s`);
    field.append(dot);
  }
  return field;
}
async function openGeneratedMediaPreview(output: GeneratedMedia) {
  if (!mediaPreviewDialog) {
    mediaPreviewDialog = document.createElement('dialog'); mediaPreviewDialog.className = 'media-preview-dialog'; mediaPreviewDialog.setAttribute('aria-label', 'Generated media preview');
    const close = document.createElement('button'); close.className = 'media-preview-close'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close preview'); close.onclick = () => mediaPreviewDialog?.close();
    const content = document.createElement('div'); content.className = 'media-preview-content'; mediaPreviewDialog.append(close, content);
    mediaPreviewDialog.addEventListener('click', event => { if (event.target === mediaPreviewDialog) mediaPreviewDialog?.close(); });
    document.body.append(mediaPreviewDialog);
  }
  const request = ++mediaPreviewRequest;
  const content = mediaPreviewDialog.querySelector<HTMLElement>('.media-preview-content')!; content.replaceChildren();
  const loading = document.createElement('div'); loading.className = 'media-preview-loading'; loading.textContent = 'Loading preview…'; content.append(loading);
  if (!mediaPreviewDialog.open) mediaPreviewDialog.showModal();
  try {
    const src = await generatedMediaUrl(output.path); if (!mediaPreviewDialog.open || request !== mediaPreviewRequest) return;
    const media = output.mediaType === 'video' ? document.createElement('video') : document.createElement('img');
    if (media instanceof HTMLVideoElement) { media.controls = true; media.playsInline = true; media.autoplay = true; }
    else media.alt = output.prompt || 'Generated image';
    media.src = src; media.className = 'media-preview-asset'; content.replaceChildren(media);
  } catch { if (mediaPreviewDialog.open && request === mediaPreviewRequest) { content.replaceChildren(); const error = document.createElement('p'); error.textContent = 'Could not load this preview.'; content.append(error); } }
}
let followsLatestMessage = true;
let lastObservedScrollTop = 0;
const persistTimers = new Map<string, number>();
const expandedThinking = new Set<string>();
const toolCallOpenState = new Map<string, boolean>();
const toolActivityOpenState = new Map<string, boolean>();
let renderQueued = false;
let streamStructureChanged = false;
let lastStreamPaint = 0;
function captureChatAnchor() {
  const bounds = chatScroller.getBoundingClientRect();
  const firstVisible = [...chatBox.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > bounds.top + 20);
  return firstVisible ? { id: firstVisible.dataset.messageId ?? '', top: firstVisible.getBoundingClientRect().top - bounds.top } : null;
}
function restoreChatAnchor(anchor: { id: string; top: number } | null) {
  if (!anchor) return;
  const node = [...chatBox.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.dataset.messageId === anchor.id);
  if (node) chatScroller.scrollTop += node.getBoundingClientRect().top - chatScroller.getBoundingClientRect().top - anchor.top;
}
function scheduleRender(structureChanged = false) {
  streamStructureChanged ||= structureChanged;
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(() => {
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!current || activeView !== 'Chat') return;
    if (streaming) {
      const message = current.messages.at(-1);
      if (!message || message.role !== 'assistant') return;
      const existing = [...chatBox.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === message.id);
      if (!existing) return;
      const shouldFollow = followsLatestMessage;
      const scrollAnchor = shouldFollow ? null : captureChatAnchor();
      const needsStructure = streamStructureChanged || (!!message.reasoning && !existing.querySelector('.reasoning'));
      streamStructureChanged = false;
      lastStreamPaint = performance.now();
      if (needsStructure) existing.replaceWith(renderMessage(current, message));
      else {
        const hasVisibleOutput = Boolean(message.content.trim() || message.reasoning?.trim() || message.toolCalls?.length || message.webResearch?.steps.length);
        const loading = existing.querySelector<HTMLElement>('.chat-loading');
        if (hasVisibleOutput) loading?.remove();
        else {
          const liveStatus = loading?.querySelector<HTMLElement>('span:last-child');
          if (liveStatus) liveStatus.textContent = generationStatus || 'Waiting for the model…';
        }
        const body = existing.querySelector<HTMLElement>('.message-body');
        if (body && body.dataset.contentLength !== String(message.content.length)) {
          body.replaceChildren(safeMarkdownFragment(message.content, true));
          body.dataset.contentLength = String(message.content.length);
          wireCodeButtons(body, current);
        }
        const reasoning = existing.querySelector<HTMLElement>('.reasoning-content');
        if (reasoning && reasoning.dataset.contentLength !== String(message.reasoning?.length ?? 0)) {
          reasoning.replaceChildren(safeMarkdownFragment(message.reasoning ?? '', true));
          reasoning.dataset.contentLength = String(message.reasoning?.length ?? 0);
        }
      }
      if (shouldFollow) requestAnimationFrame(() => { if (followsLatestMessage) chatScroller.scrollTop = chatScroller.scrollHeight; });
      else requestAnimationFrame(() => restoreChatAnchor(scrollAnchor));
      return;
    }
    renderMessages();
  });
  }, streaming ? Math.max(0, 100 - (performance.now() - lastStreamPaint)) : 0);
}
const now = () => Date.now(); const id = () => crypto.randomUUID();
const versionLabel = document.querySelector<HTMLElement>('.version'); if (versionLabel) versionLabel.textContent = `Orion · ${__ORION_VERSION__}`;
function setComposerStreaming(active: boolean) {
  streaming = active;
  generationStatus = active ? 'Waiting for the model…' : '';
  promptBox.setAttribute('aria-busy', String(active));
}
function updateChatModeUi() {
  promptBox.disabled = false;
  const sendButton = $('send') as HTMLButtonElement;
  sendButton.disabled = false;
  const hint = document.querySelector<HTMLElement>('.composer-hint');
  if (hint) hint.textContent = 'Local & Private · Conversation-first AI';
}
chatScroller.addEventListener('wheel', event => {
  const direction = event.deltaY < 0 ? -1 : event.deltaY > 0 ? 1 : 0;
  if (direction < 0) followsLatestMessage = false;
}, { passive: true });
let previousTouchY: number | null = null;
chatScroller.addEventListener('touchstart', event => { previousTouchY = event.touches[0]?.clientY ?? null; }, { passive: true });
chatScroller.addEventListener('touchmove', event => {
  const currentY = event.touches[0]?.clientY;
  if (currentY === undefined || previousTouchY === null) return;
  const direction = currentY > previousTouchY ? -1 : currentY < previousTouchY ? 1 : 0;
  previousTouchY = currentY;
  if (direction < 0) followsLatestMessage = false;
}, { passive: true });
chatScroller.addEventListener('touchend', () => { previousTouchY = null; }, { passive: true });
chatScroller.addEventListener('keydown', event => {
  const direction = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ? -1 : ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) ? 1 : 0;
  if (!direction) return;
  if (direction < 0) followsLatestMessage = false;
});
chatScroller.addEventListener('scroll', () => {
  // Detect direction from the actual scroll position so wheel, scrollbar drag,
  // touch, keyboard, and accessibility scrolling all use the same follow state.
  const currentTop = chatScroller.scrollTop;
  const distanceFromBottom = chatScroller.scrollHeight - currentTop - chatScroller.clientHeight;
  if (currentTop < lastObservedScrollTop - 1) followsLatestMessage = false;
  if (distanceFromBottom <= 48) followsLatestMessage = true;
  lastObservedScrollTop = currentTop;
}, { passive: true });
chatScroller.addEventListener('scrollend', () => {
  if (chatScroller.scrollHeight - chatScroller.scrollTop - chatScroller.clientHeight <= 48) followsLatestMessage = true;
}, { passive: true });
let mermaidRenderQueue: Promise<void> = Promise.resolve();
const mermaidRenderSources = new WeakMap<HTMLElement, string>();
function queueMermaidRender(box: HTMLElement, source: string, showError = false) {
  const diagram = source.trim();
  if (!diagram) return Promise.resolve();
  if (mermaidRenderSources.get(box) === diagram) return mermaidRenderQueue;
  mermaidRenderSources.set(box, diagram);
  mermaidRenderQueue = mermaidRenderQueue.then(async () => {
    if (!box.isConnected) return;
    const { svg } = await mermaid.render(`orion-diagram-${crypto.randomUUID()}`, diagram);
    if (box.isConnected) box.replaceChildren(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true }) as DocumentFragment);
  }).catch(error => {
    mermaidRenderSources.delete(box);
    if (!showError || !box.isConnected) return;
    const message = error instanceof Error ? error.message : String(error);
    const notice = document.createElement('div'); notice.className = 'mermaid-render-error'; notice.setAttribute('role', 'status');
    const text = document.createElement('span'); text.textContent = `This diagram could not be rendered: ${message.slice(0, 700)}`;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => { box.replaceChildren(); void queueMermaidRender(box, diagram, true); });
    notice.append(text, retry); box.replaceChildren(notice);
  });
  return mermaidRenderQueue;
}
async function renderDiagram(root: HTMLElement, source: string, title?: unknown) { const existing=[...root.querySelectorAll<HTMLElement>('.tool-call')].find(card=>card.querySelector('.tool-output')?.textContent===source); if(!existing||existing.querySelector('.mermaid-render'))return; const box=document.createElement('div');box.className='mermaid-render';box.setAttribute('aria-label',typeof title==='string'?title:'Mermaid diagram');existing.append(box);await queueMermaidRender(box,source,true); }
function renderMarkdownDiagrams(root: HTMLElement) { for (const block of root.querySelectorAll<HTMLElement>('.mermaid-block')) { const source = block.querySelector('details pre')?.textContent ?? ''; const box = block.querySelector<HTMLElement>('.mermaid-render'); if (box && source) void queueMermaidRender(box, source, true); } }
let lightweightMarkdown = false;
const markdownCache = new Map<string, DocumentFragment>();
function safeMarkdownFragment(source: string, lightweight = false) {
  if (!lightweight && markdownCache.has(source)) return markdownCache.get(source)!.cloneNode(true) as DocumentFragment;
  lightweightMarkdown = lightweight;
  let fragment: DocumentFragment;
  try { const normalized = normalizeMarkdownTables(normalizeRawMermaid(source)); fragment = DOMPurify.sanitize(marked.parse(normalized) as string, { USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true }) as DocumentFragment; }
  finally { lightweightMarkdown = false; }
  if (!lightweight && source.length < 100_000) { if (markdownCache.size >= 32) markdownCache.delete(markdownCache.keys().next().value!); markdownCache.set(source, fragment.cloneNode(true) as DocumentFragment); }
  return fragment;
}
function safeWebResearchSource(input: WebResearchSource): WebResearchSource | null {
  let url: URL;
  try { url = new URL(input.url); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 500) : '',
    url: url.href,
    snippet: typeof input.snippet === 'string' ? input.snippet.slice(0, 6000) : undefined,
    status: input.status === 'reading' || input.status === 'read' || input.status === 'error' ? input.status : 'error'
  };
}
let canvasMode:'source'|'preview'|'diff'='preview';
function syncCanvasToggle(){const open=!($('canvas-sidebar') as HTMLElement).hidden,button=$('canvas-open'),arrow=$('canvas-toggle-arrow'),anchor=$('canvas-toggle-anchor'),header=$('canvas-header');button.setAttribute('aria-pressed',String(open));button.setAttribute('aria-label',open?'Hide Canvas':'Show Canvas');button.title=open?'Hide Canvas':'Show Canvas';button.classList.remove('active');arrow?.setAttribute('d',open?'M12 12l5 4-5 4':'M12 12l-5 4 5 4');if(open)header.insertBefore(button,header.firstChild);else anchor.parentElement?.insertBefore(button,anchor);}
function storeCanvasSession() { const key=canvasDocument?.conversationId;if(!key||!canvasDocument)return;canvasSessions.set(key,{document:{...canvasDocument},notes:canvasNotes.map(note=>({...note})),previous:canvasPrevious,previousNotes:canvasPreviousNotes.map(note=>({...note})),mode:canvasMode}); }
function switchCanvasConversation(conversationId?:string) { storeCanvasSession();pendingCanvasReview=null;canvasReviewAttachment=undefined;const session=conversationId?canvasSessions.get(conversationId):undefined;if(!session){canvasDocument=null;canvasNotes=[];canvasPrevious=null;canvasPreviousNotes=[];$('canvas-sidebar').hidden=true;document.body.classList.remove('canvas-open');syncCanvasToggle();return;}canvasDocument={...session.document};canvasNotes=session.notes.map(note=>({...note}));canvasPrevious=session.previous;canvasPreviousNotes=session.previousNotes.map(note=>({...note}));canvasMode=session.mode;$('canvas-name').textContent=canvasDocument.name;$('canvas-sidebar').hidden=false;document.body.classList.add('canvas-open');syncCanvasToggle();renderCanvas(); }
function showCanvas(documentValue:CanvasDocument, mode:'source'|'preview'|'diff'='preview') { const conversationId=documentValue.conversationId??current?.id;if(!conversationId||current?.id!==conversationId)return;canvasDocument={...documentValue,conversationId}; canvasMode=mode; canvasNotes=[]; canvasPrevious=null;canvasPreviousNotes=[]; $('canvas-name').textContent=documentValue.name; $('canvas-sidebar').hidden=false; document.body.classList.add('canvas-open'); syncCanvasToggle();renderCanvas();storeCanvasSession(); }
function toggleCanvas(){const panel=$('canvas-sidebar');panel.hidden=!panel.hidden;document.body.classList.toggle('canvas-open',!panel.hidden);syncCanvasToggle();if(!panel.hidden)renderCanvas();}
function renderCanvas() {
  const doc=canvasDocument, body=$('canvas-body'), editor=$('canvas-editor') as HTMLTextAreaElement;
  if(!doc){const empty=document.createElement('div');empty.className='canvas-empty';const icon=document.createElement('div');icon.className='canvas-empty-icon';icon.textContent='▤';const title=document.createElement('strong');title.textContent='Canvas is ready';const help=document.createElement('span');help.textContent='Canvas is always available. Use the Canvas button on an AI code block, ask Orion to open or create a document, or drop a file here.';empty.append(icon,title,help);body.replaceChildren(empty);editor.hidden=true;document.querySelector('.canvas-toolbar')?.setAttribute('hidden','');document.querySelector('.canvas-feedback')?.setAttribute('hidden','');$('canvas-copy').setAttribute('disabled','');$('canvas-download').setAttribute('disabled','');return;}document.querySelector('.canvas-toolbar')?.removeAttribute('hidden');document.querySelector('.canvas-feedback')?.removeAttribute('hidden');$('canvas-copy').removeAttribute('disabled');$('canvas-download').removeAttribute('disabled');
  $('canvas-name').textContent=doc.name; editor.hidden=doc.format==='pdf'||doc.format==='image';editor.value=editor.hidden?'':doc.content; $('canvas-format-tools').toggleAttribute('hidden',doc.format!=='html');
  $('canvas-code').classList.toggle('active',canvasMode==='source');$('canvas-preview').classList.toggle('active',canvasMode==='preview');
  body.replaceChildren();
  if(canvasMode==='diff'&&canvasPrevious!==null){
    const panes=document.createElement('div');panes.className='canvas-diff';
    const left=document.createElement('section');left.className='canvas-diff-pane';const lh=document.createElement('h4');lh.textContent='Before · your edits and notes';const lp=document.createElement('pre');lp.textContent=canvasPrevious;left.append(lh,lp);if(canvasPreviousNotes.length){const noteWrap=document.createElement('div');noteWrap.className='canvas-diff-notes';for(const note of canvasPreviousNotes){const item=document.createElement('p');item.textContent=`${note.kind==='remove'?'Remove':'Comment'}${note.quote?` · “${note.quote}”`:''}: ${note.text}`;noteWrap.append(item);}left.append(noteWrap);}
    const right=document.createElement('section');right.className='canvas-diff-pane';const rh=document.createElement('h4');rh.textContent='Revised by Orion';const rp=document.createElement('pre');rp.textContent=doc.content;right.append(rh,rp);panes.append(left,right);body.append(panes);
  } else if(doc.format==='html'&&canvasMode==='preview'){
    const frame=document.createElement('iframe');frame.className='canvas-preview-frame';frame.title=`Preview of ${doc.name}`;frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline'; font-src data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1">${doc.content}`;body.append(frame);
  } else if(doc.format==='pdf'){
    const frame=document.createElement('iframe');frame.className='canvas-pdf-frame';frame.title=`Preview of ${doc.name}`;frame.src=`data:application/pdf;base64,${doc.content}`;body.append(frame);
  } else if(doc.format==='image'){
    const image=document.createElement('img');image.className='canvas-image-preview';image.alt=doc.name;image.src=doc.content;body.append(image);
  } else if(doc.format==='markdown'&&canvasMode==='preview'){
    const preview=document.createElement('article');preview.className='canvas-markdown';preview.replaceChildren(safeMarkdownFragment(doc.content));body.append(preview);renderMarkdownDiagrams(preview);
  } else {
    const source=document.createElement('textarea');source.className='canvas-code-view';source.readOnly=true;source.value=doc.content;source.setAttribute('aria-label','Document source');body.append(source);
  }
  const notes=$('canvas-notes');notes.replaceChildren(...canvasNotes.map((note,index)=>{const row=document.createElement('div');row.className='canvas-note-item';const label=document.createElement('b');label.textContent=note.kind==='remove'?'Remove':'Comment';const copy=document.createElement('span');copy.textContent=`${note.quote?`“${note.quote.slice(0,90)}” · `:''}${note.text}`;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove note';remove.onclick=()=>{canvasNotes.splice(index,1);renderCanvas();};row.append(label,copy,remove);return row;}));
}
function revisedCanvasText(value:string){const trimmed=value.trim();const fenced=/^```(?:markdown|md|html|text)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);return fenced?fenced[1]!:trimmed;}
function time(ts: number) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ts); }
const confirmDialog = $('confirm-dialog') as HTMLDialogElement;
function askConfirm(message: string, title = 'Confirm') { $('confirm-title').textContent = title; $('confirm-message').textContent = message; confirmDialog.showModal(); return new Promise<boolean>(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true })); }
function showNotice(message: string, title = 'Orion') { $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-cancel').hidden = true; ($('confirm-ok') as HTMLButtonElement).textContent = 'OK'; confirmDialog.showModal(); confirmDialog.addEventListener('close', () => { $('confirm-cancel').hidden = false; ($('confirm-ok') as HTMLButtonElement).textContent = 'Confirm'; }, { once: true }); }
const contextMenu = $('context-menu');
function hideContextMenu() { contextMenu.hidden = true; contextMenu.replaceChildren(); }
function showContextMenu(x: number, y: number, actions: Array<{ label: string; run: () => void | Promise<void>; danger?: boolean }>) { contextMenu.replaceChildren(); for (const action of actions) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; if (action.danger) button.classList.add('danger'); button.onclick = () => { hideContextMenu(); void action.run(); }; contextMenu.append(button); } contextMenu.hidden = false; contextMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - contextMenu.offsetWidth - 8))}px`; contextMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - contextMenu.offsetHeight - 8))}px`; }
document.addEventListener('pointerdown', event => { if (!contextMenu.contains(event.target as Node)) hideContextMenu(); });
document.addEventListener('contextmenu', event => { const target = event.target as HTMLElement; const conversationButton = target.closest<HTMLButtonElement>('.conversation'); if (conversationButton) { event.preventDefault(); const conversation = conversations.find(item => item.id === conversationButton.dataset.id); if (conversation) showContextMenu(event.clientX, event.clientY, [{ label: 'Open conversation', run: () => conversationButton.click() }, { label: 'Delete conversation…', danger: true, run: async () => { if (await askConfirm(`Delete “${conversation.title}”?`, 'Delete conversation')) { await window.orion.deleteConversation(conversation.id); conversations = conversations.filter(item => item.id !== conversation.id); if (current?.id === conversation.id) { switchCanvasConversation(undefined); current = null; } renderHistory(); renderMessages(true); } } }]); return; } const selection = getSelection()?.toString() ?? ''; const editable = target.closest('textarea:not([readonly]),input:not([type=checkbox]):not([type=number]):not([readonly])'); const actions: Array<{ label: string; run: () => void | Promise<void> }> = []; if (selection) actions.push({ label: 'Copy', run: () => navigator.clipboard.writeText(selection) }); if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) { const input = editable; actions.push({ label: 'Cut', run: async () => { const a = input.selectionStart ?? 0, b = input.selectionEnd ?? a; await navigator.clipboard.writeText(input.value.slice(a, b)); input.setRangeText('', a, b, 'start'); input.dispatchEvent(new Event('input', { bubbles: true })); } }, { label: 'Paste', run: async () => { const text = await navigator.clipboard.readText(); input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? input.selectionStart ?? 0, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); } }, { label: 'Select all', run: () => input.select() }); } if (actions.length) { event.preventDefault(); showContextMenu(event.clientX, event.clientY, actions); } });

function createMessage(role: Message['role'], content: string): Message { return { id: id(), role, content, createdAt: now() }; }
function newConversation() { if(activeView==='Create')clearCreatePageSession(); activeView = 'Chat'; updateActiveNav('Chat'); const t = now(); current = { id: id(), title: 'New conversation', model: settings.selectedModel, createdAt: t, updatedAt: t, messages: [], mode: 'chat' }; switchCanvasConversation(current.id); conversations.unshift(current); renderWorkspaceReview(null); save(); chatMode = 'chat'; updateChatModeUi(); renderHistory(); renderMessages(true); void renderMemoryUsage(); if (!commandPalette.hidden) closeCommandPalette(); promptBox.focus(); }
let memoryRenderSequence = 0;
async function renderMemoryUsage() {
  const conversationId = current?.id;
  try { await updateMemoryUsage(); }
  catch (error) {
    if (current?.id !== conversationId) return;
    $('memory-label').textContent = 'Unavailable';
    $('memory-label').title = error instanceof Error ? error.message : String(error);
  }
}
async function updateMemoryUsage() { const request = ++memoryRenderSequence; const conversationId = current?.id ?? ''; const interConversation = settings.interConversationMemory; const label = $('memory-label'), fill = $('memory-fill'); $('memory-engine-name').textContent = 'OrionFS (OFS)'; const stats = await window.orion.memoryStats(interConversation ? undefined : conversationId); if (request !== memoryRenderSequence || current?.id !== conversationId || settings.interConversationMemory !== interConversation) return; const count = stats.activeMemories ?? stats.chunks; label.textContent = `${count.toLocaleString()} memories`; label.title = `${count.toLocaleString()} active OrionFS memory nodes · ${stats.indexedTokens.toLocaleString()} estimated tokens · ${stats.links ?? 0} graph links · ${stats.databaseBytes ? (stats.databaseBytes / 1048576).toFixed(1) + ' MB' : 'database size unavailable'} · ${stats.workingTurns ?? 0} active working turns. Stored locally; no model or network required.`; fill.style.width = `${Math.min(100, count / 5000 * 100)}%`; ($('install-memory-embedding') as HTMLButtonElement).hidden = true; $('memory-progress').textContent = stats.rebuilding ? 'OrionFS is indexing saved conversations…' : 'OrionFS is active. Memories are stored locally and recalled without a model.'; }
async function save(conversation: Conversation | null = current, indexMemory = false) { if (!conversation) return; conversation.updatedAt = now(); await window.orion.saveConversation(conversation, indexMemory); renderHistory(); void renderMemoryUsage(); }
function scheduleSave(conversation: Conversation) { const timer = persistTimers.get(conversation.id); if (timer) clearTimeout(timer); persistTimers.set(conversation.id, window.setTimeout(() => { persistTimers.delete(conversation.id); void save(conversation); }, 900)); }
function renderHistory() { historyBox.replaceChildren(); const groups: [string, Conversation[]][] = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]]; const day = new Date().setHours(0,0,0,0); for (const c of [...conversations].sort((a,b)=>b.updatedAt-a.updatedAt)) { const age = day - new Date(c.updatedAt).setHours(0,0,0,0); groups[age <= 0 ? 0 : age <= 86400000 ? 1 : age <= 7 * 86400000 ? 2 : 3]![1].push(c); } for (const [name, items] of groups) { if (!items.length) continue; const g = document.createElement('div'); g.className = 'history-group'; const label=document.createElement('div');label.className='section-label';label.textContent=name;g.append(label); for (const c of items) { const b = document.createElement('button'); b.className = `conversation${current?.id === c.id ? ' current' : ''}`; b.dataset.id = c.id; b.textContent = c.title; b.title = 'Right click to delete'; b.onclick = () => { activeView = 'Chat'; updateActiveNav('Chat'); switchCanvasConversation(c.id); current = c; chatMode = 'chat'; updateChatModeUi(); renderMessages(true); renderHistory(); void window.orion.saveConversation(c, true).then(() => renderMemoryUsage()); }; g.append(b); } historyBox.append(g); } }
function updateActiveNav(view: string) { document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view)); }
function renderWorkspaceReview(review: WorkspaceReview | null) {
  workspaceReview = review;
  const box = $('workspace-review'); box.replaceChildren(); box.hidden = !review?.changes.length;
  if (!review?.changes.length) return;
  const heading = document.createElement('div'); heading.className = 'workspace-review-heading';
  const title = document.createElement('strong'); title.textContent = `${review.changes.length} file${review.changes.length===1?'':'s'} changed`;
  const stats = document.createElement('span'); stats.className = 'workspace-review-stats'; const added=document.createElement('b');added.className='added';added.textContent=`+${review.additions}`;const removed=document.createElement('b');removed.className='removed';removed.textContent=`−${review.deletions}`;stats.append(added,removed);
  heading.append(title,stats);
  const actions = document.createElement('div'); actions.className='workspace-review-actions';
  const reject=document.createElement('button');reject.type='button';reject.className='secondary';reject.textContent='Reject';
  reject.disabled=streaming;reject.onclick=async()=>{const result=await window.orion.resolveWorkspaceReview(review.conversationId,false);if(result.success)renderWorkspaceReview(null);else showNotice(result.message,'Could not discard changes');};
  const approve=document.createElement('button');approve.type='button';approve.className='primary';approve.textContent='Approve changes';
  approve.disabled=streaming;approve.onclick=async()=>{approve.disabled=true;const result=await window.orion.resolveWorkspaceReview(review.conversationId,true);if(result.success){renderWorkspaceReview(null);await refreshCommandPalette();}else{approve.disabled=streaming;showNotice(result.message,'Could not apply changes');}};
  actions.append(reject,approve);
  const list=document.createElement('div');list.className='workspace-review-files';
  for(const file of review.changes){const details=document.createElement('details');details.className='workspace-review-file';const summary=document.createElement('summary');const name=document.createElement('span');name.textContent=file.path;const lineStats=document.createElement('small');const fileAdded=document.createElement('b');fileAdded.className='added';fileAdded.textContent=`+${file.additions}`;const fileRemoved=document.createElement('b');fileRemoved.className='removed';fileRemoved.textContent=`−${file.deletions}`;lineStats.append(fileAdded,fileRemoved);summary.append(name,lineStats);const diff=document.createElement('pre');diff.textContent=file.diff||`[${file.status} file]`;details.append(summary,diff);list.append(details);}
  box.append(heading,list,actions);
}
async function loadWorkspaceReview(conversationId = current?.id) { const review = conversationId ? await window.orion.getWorkspaceReview(conversationId).catch(()=>null) : null; if (conversationId === current?.id) renderWorkspaceReview(review); }
const commandPalette=$('command-palette') as HTMLElement;
function closeCommandPalette(){commandPalette.hidden=true;commandPalette.classList.remove('palette-open');}
async function openCommandPalette(){ /* Workspace and Git controls are temporarily disabled; preserve this entry point for its existing key bindings. */ closeCommandPalette(); }
async function refreshCommandPalette(){
  if(!commandPalette)return;
  await workspaceSettingsWrite;
  const workspace=$('palette-workspace');workspace.replaceChildren();const workspaceTitle=document.createElement('div');workspaceTitle.className='palette-section-title';workspaceTitle.textContent='Project workspace';workspace.append(workspaceTitle);
  const pathText=document.createElement('div');pathText.className='palette-workspace-path';pathText.textContent=settings.workspacePath||'No project selected';pathText.title=pathText.textContent;workspace.append(pathText);
  const projectRow=document.createElement('div');projectRow.className='palette-project-create';const name=document.createElement('input');name.id='palette-project-name';name.placeholder='Create a new project';name.maxLength=72;name.setAttribute('aria-label','New project name');const create=document.createElement('button');create.type='button';create.className='secondary';create.textContent='Create';create.onclick=async()=>{try{const root=await window.orion.createWorkspace(name.value);settings.workspacePath=root;if(current){current.workspacePath=root;await save(current);}await window.orion.saveSettings(settings);updateChatModeUi();name.value='';await refreshCommandPalette();await loadWorkspaceReview();}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not create project');}};projectRow.append(name,create);workspace.append(projectRow);
  const choose=document.createElement('button');choose.type='button';choose.className='secondary palette-wide';choose.textContent='Open existing project…';choose.onclick=async()=>{const root=await window.orion.selectWorkspace();if(root){settings.workspacePath=root;if(current){current.workspacePath=root;await save(current);}await window.orion.saveSettings(settings);updateChatModeUi();await refreshCommandPalette();await loadWorkspaceReview();}};workspace.append(choose);
  const git=$('palette-git');git.replaceChildren();const gitTitle=document.createElement('div');gitTitle.className='palette-section-title';gitTitle.textContent='Git checkpoints';git.append(gitTitle);
  if(!settings.workspacePath){const hint=document.createElement('p');hint.className='muted';hint.textContent='Choose or create a workspace to see Git status.';git.append(hint);return;}
  const state:WorkspaceStatus=await window.orion.getWorkspaceStatus().catch(()=>({root:settings.workspacePath,git:false,branch:null,changedFiles:0,additions:0,deletions:0,checkpoints:[]}));
  const summary=document.createElement('div');summary.className='palette-git-status';summary.textContent=state.git?`${state.branch||'Git'} · ${state.changedFiles} changed · +${state.additions} / −${state.deletions}`:'Not a Git repository';git.append(summary);
  if(state.git){const checkpoint=document.createElement('button');checkpoint.type='button';checkpoint.className='secondary';checkpoint.textContent='＋ Save checkpoint';checkpoint.onclick=async()=>{try{await window.orion.createGitCheckpoint(`Workspace · ${new Date().toLocaleString()}`);await refreshCommandPalette();}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not save checkpoint');}};git.append(checkpoint);}
  const history=document.createElement('div');history.className='palette-checkpoints';for(const cp of [...state.checkpoints].reverse()){const row=document.createElement('div');row.className='palette-checkpoint';const timeLabel=document.createElement('span');timeLabel.textContent=`${cp.label} · ${new Date(cp.createdAt).toLocaleString()}`;const rollback=document.createElement('button');rollback.type='button';rollback.className='checkpoint-rollback';rollback.textContent='↶';rollback.title='Review rollback';rollback.onclick=async()=>{try{const preview=await window.orion.previewGitRollback(cp.id);($('git-rollback-title')).textContent=`Rollback to ${cp.label}`;($('git-rollback-preview')).textContent=preview;($('git-rollback-dialog') as HTMLDialogElement).dataset.checkpointId=cp.id;($('git-rollback-dialog') as HTMLDialogElement).showModal();}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not preview rollback');}};row.append(timeLabel,rollback);history.append(row);}git.append(history);
}
async function refreshStorageWarning() { const warning = await window.orion.storageWarning(); const banner = $('storage-warning'); banner.textContent = warning ?? ''; banner.hidden = !warning; }
function modelSize(bytes: number) { return bytes > 0 ? `${(bytes / 1e9).toFixed(2)} GB` : 'Size unavailable'; }
function syncModelDownloadCards() { for (const card of document.querySelectorAll<HTMLElement>('.model-card[data-repo]')) { const item=[...downloadProgress.values()].find(progress=>progress.repo===card.dataset.repo&&progress.phase==='downloading'); const area=card.querySelector<HTMLElement>('.model-download-progress'); if(!area)continue; area.hidden=!item; if(!item)continue; const label=area.querySelector<HTMLElement>('.download-detail')!; label.textContent=item.total?`${modelSize(item.received)} of ${modelSize(item.total)} · ${Math.floor(item.received/item.total*100)}%`:`${modelSize(item.received)} downloaded`; const bar=area.querySelector('progress')!;bar.max=item.total||1;bar.value=item.received; const cancel=area.querySelector<HTMLButtonElement>('.download-cancel')!;cancel.disabled=false;cancel.textContent='Cancel download'; } }
function renderDownloadActivity() {
  const box = $('download-activity'); box.replaceChildren();
  for (const item of downloadProgress.values()) {
    if (item.phase === 'complete' || item.phase === 'error' || item.phase === 'cancelled') continue;
    const card = document.createElement('div'); card.className = 'download-card';
    const label = document.createElement('div'); label.className = 'download-label'; label.textContent = item.repo;
    const detail = document.createElement('div'); detail.className = 'download-detail'; detail.textContent = item.file ? item.file.split('/').at(-1)! : 'Preparing model bundle';
    const progress = document.createElement('progress'); progress.max = item.total || 1; progress.value = item.received;
    const footer = document.createElement('div'); footer.className = 'download-progress-footer'; const count = document.createElement('div'); count.className = 'download-detail';
    const percent = item.total ? Math.floor(item.received / item.total * 100) : null; count.textContent = `${modelSize(item.received)} / ${modelSize(item.total)}${percent === null ? '' : ` · ${percent}%`}`;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'download-cancel'; cancel.textContent = 'Cancel'; cancel.setAttribute('aria-label', `Cancel download of ${item.repo}`); cancel.onclick = () => { cancel.disabled = true; cancel.textContent = 'Stopping…'; void window.orion.cancelModelDownload(item.id); };
    footer.append(count,cancel); card.append(label, detail, progress, footer); box.append(card);
  }
  syncModelDownloadCards();
}
function activePopularCategory(): ModelCategory | null { return modelTab === 'conversational' ? 'conversational' : modelTab === 'creative' ? creativeCategory : null; }
async function beginModelDownload(repo: string, file: string, category: ModelCategory, button: HTMLButtonElement) {
  const original = button.textContent || 'Download'; button.disabled = true; button.textContent = 'Downloading…';
  try { await window.orion.downloadHubModel(repo, file, category); installedModels = await window.orion.listInstalledModels(); await refreshModels(); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); if (!/cancel/i.test(message)) showNotice(message, 'Model download failed'); }
  finally { button.disabled = false; button.textContent = original; }
}
async function saveHuggingFaceToken(token:string){const request=++hfTokenSaveRequest;hfTokenStatus='Saving…';const statusNode=document.getElementById('hf-token-status');if(statusNode)statusNode.textContent=hfTokenStatus;try{const status=await window.orion.setHuggingFaceToken(token);if(request!==hfTokenSaveRequest)return;hfTokenConfigured=Boolean(token.trim());hfTokenDraft='';hfTokenStatus=token.trim()===''?'Token cleared':status==='invalid'?'Saved · Hugging Face rejected this token':'Saved · used for Hugging Face model downloads';}catch(error){if(request!==hfTokenSaveRequest)return;hfTokenStatus=`Could not save: ${error instanceof Error?error.message:String(error)}`;}const node=document.getElementById('hf-token-status');if(node)node.textContent=hfTokenStatus;const input=document.getElementById('hf-token-input') as HTMLInputElement|null;if(input){input.value='';input.placeholder=hfTokenConfigured?'Token saved · enter a replacement':'Paste a Hugging Face read token';}}
function scheduleHuggingFaceTokenSave(token:string){hfTokenDraft=token;hfTokenStatus=token.trim()?'Unsaved changes':'Enter a token or use Clear';const status=document.getElementById('hf-token-status');if(status)status.textContent=hfTokenStatus;if(hfTokenSaveTimer!==undefined)window.clearTimeout(hfTokenSaveTimer);if(!token.trim())return;hfTokenSaveTimer=window.setTimeout(()=>void saveHuggingFaceToken(token.trim()),700);}
async function loadPopularHubModels(category: ModelCategory) {
  const cached = popularHubCache.get(category);
  popularHubError = '';
  if (cached) { popularHubLoading = null; if (activeView === 'Models' && activePopularCategory() === category) { hubModels = cached; void renderModelsView(); } return; }
  if (popularHubLoading === category) return;
  const request = ++popularHubRequest; popularHubLoading = category; hubModels = [];
  if (activeView === 'Models' && activePopularCategory() === category) void renderModelsView();
  try {
    const found = await window.orion.searchHub('', category); popularHubCache.set(category, found);
    if (request === popularHubRequest && activeView === 'Models' && activePopularCategory() === category) { hubModels = found; popularHubLoading = null; void renderModelsView(); }
  } catch (error) {
    if (request === popularHubRequest) { popularHubError = error instanceof Error ? error.message : String(error); popularHubLoading = null; if (activeView === 'Models' && activePopularCategory() === category) void renderModelsView(); }
  }
}

function renderProviders(page: HTMLElement) {
  const help = document.createElement('p'); help.className = 'muted'; help.textContent = 'Connect local OpenAI compatible endpoints or cloud providers. Orion connects to Google, Anthropic, OpenCode Zen, OpenCode Go, OpenAI, Z.ai, Kimi, OpenRouter, and custom endpoints. Enter model IDs manually when discovery is unavailable. API keys are stored privately on this device.'; page.append(help);
  const form = document.createElement('form'); form.className = 'provider-form';
  const kindLabel = document.createElement('label'); kindLabel.textContent = 'Provider'; const kind = document.createElement('select');
  const presets: Array<{ kind: import('../shared/types').ApiProviderKind; name: string; url: string }> = [
    { kind: 'openai-compatible', name: 'OpenAI compatible / local', url: 'http://127.0.0.1:11434/v1' },
    { kind: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' },
    { kind: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
    { kind: 'google', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
    { kind: 'zai', name: 'Z.ai', url: 'https://api.z.ai/api/paas/v4' },
    { kind: 'moonshotai', name: 'Kimi / Moonshot', url: 'https://api.moonshot.ai/v1' },
    { kind: 'opencode', name: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1' },
    { kind: 'opencode-go', name: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1' },
    { kind: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' }
  ];
  for (const preset of presets) { const option = document.createElement('option'); option.value = preset.kind; option.textContent = preset.name; kind.append(option); }
  kindLabel.append(kind); form.append(kindLabel);
  const field = (label: string, type = 'text') => { const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement('input'); input.type = type; wrapper.append(input); form.append(wrapper); return input; };
  const name = field('Provider name'), url = field('API base URL', 'url'), key = field('API key (optional)', 'password'), ids = field('Model IDs (optional; comma separated)');
  name.required = true; url.required = true; url.placeholder = 'https://api.example.com/v1'; key.autocomplete = 'new-password';
  kind.onchange = () => { const preset = presets.find(item => item.kind === kind.value); if (preset) { url.value = preset.url; if (!editing) name.value = preset.name; } };
  const toolLabel = document.createElement('label'); toolLabel.className = 'job-check'; const tools = document.createElement('input'); tools.type = 'checkbox'; toolLabel.append(tools, document.createTextNode('Enable tools (requires provider/model tool support)')); form.append(toolLabel);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let editing: string | undefined;
  const draft = () => ({ id: editing ?? crypto.randomUUID(), name: name.value, kind: kind.value as import('../shared/types').ApiProviderKind, baseUrl: url.value, models: ids.value.split(','), tools: tools.checked, ...(key.value ? { apiKey: key.value } : {}) });
  const discover = document.createElement('button'); discover.type = 'button'; discover.className = 'secondary'; discover.textContent = 'Discover models';
  discover.onclick = async () => { discover.disabled = true; status.textContent = 'Connecting…'; try { const found = await window.orion.discoverProviderModels(draft()); ids.value = found.join(', '); status.textContent = found.length ? `Found ${found.length} models. Save to use them.` : 'No models returned. Enter model IDs manually.'; } catch (error) { status.textContent = String(error); } finally { discover.disabled = false; } };
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Save provider';
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'secondary'; reset.textContent = 'New provider'; reset.onclick = () => { editing = undefined; form.reset(); key.placeholder = ''; status.textContent = ''; kind.dispatchEvent(new Event('change')); };
  form.onsubmit = async event => { event.preventDefault(); save.disabled = true; try { await window.orion.saveProvider(draft()); editing = undefined; form.reset(); kind.dispatchEvent(new Event('change')); await refreshModels(true); } catch (error) { status.textContent = String(error); } finally { save.disabled = false; } };
  kind.dispatchEvent(new Event('change')); form.append(discover, save, reset, status); page.append(form);
  const list = document.createElement('div'); list.className = 'model-results'; page.append(list);
  void window.orion.listProviders().then(providers => { for (const provider of providers) { const card = document.createElement('article'); card.className = 'model-card'; const title = document.createElement('h2'); title.textContent = provider.name; const detail = document.createElement('p'); detail.textContent = `${provider.baseUrl} · ${provider.models.length} models · ${provider.keyConfigured ? 'API key saved' : 'No API key'}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = 'Edit'; edit.onclick = () => { editing = provider.id; kind.value = provider.kind ?? 'openai-compatible'; name.value = provider.name; url.value = provider.baseUrl; ids.value = provider.models.join(', '); tools.checked = provider.tools; key.value = ''; key.placeholder = provider.keyConfigured ? 'Leave blank to keep saved key' : ''; status.textContent = ''; };
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.textContent = 'Clear API key'; clear.disabled = !provider.keyConfigured; clear.onclick = async () => { try { await window.orion.saveProvider({ ...provider, apiKey: '' }); await refreshModels(true); } catch (error) { status.textContent = String(error); } };
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove'; remove.onclick = async () => { if (!await askConfirm(`Remove ${provider.name}? Conversations remain saved, but this provider’s models will be unavailable.`, 'Remove provider')) return; try { await window.orion.deleteProvider(provider.id); await refreshModels(true); } catch (error) { status.textContent = String(error); } };
    card.append(title, detail, edit, clear, remove); list.append(card);
  } }).catch(error => { status.textContent = String(error); });
}

function renderModelsView() {
  if(modelTab !== 'providers' && hfTokenConfigured===null&&!hfTokenConfigLoading){hfTokenConfigLoading=true;void window.orion.getHuggingFaceTokenConfigured().then(configured=>{hfTokenConfigured=configured;hfTokenConfigLoading=false;if(activeView==='Models' && modelTab !== 'providers')renderModelsView();}).catch(()=>{hfTokenConfigured=false;hfTokenConfigLoading=false;});}
  document.body.classList.add('models-view'); document.body.classList.remove('create-view');
  $('model-selector-wrap').hidden = true; $('create-composer-wrap').hidden = true;
  chatBox.replaceChildren();
  const page = document.createElement('section'); page.className = 'workspace-view models-page'; page.setAttribute('aria-labelledby', 'models-heading');
  const title = document.createElement('h1'); title.id = 'models-heading'; title.textContent = 'Model browser';
  const subtitle = document.createElement('p'); subtitle.textContent = modelTab==='providers' ? 'Connect and manage OpenAI-compatible API providers.' : modelTab==='creative' ? 'Browse Hugging Face image and video models. Orion installs them into its private headless native image/video engine model folders.' : 'Find and manage local models. Orion downloads GGUF chat models for its managed llama.cpp runtime.';
  page.append(title, subtitle);
  const tabs = document.createElement('div'); tabs.className = 'model-tabs';
  for (const [tab, label] of [['conversational','Conversational'],['creative','Image / Video'],['manage','Manage'],['providers','Providers']] as const) { const button = document.createElement('button'); button.type = 'button'; button.className = `model-tab${modelTab===tab?' active':''}`; button.textContent = label; button.onclick = () => { if(modelTab!==tab){hubModels=[];modelQuery='';activeHubRepo='';activeHubFiles=[];}modelTab = tab; void renderModelsView(); if(tab==='conversational')void loadPopularHubModels('conversational');else if(tab==='creative')void loadPopularHubModels(creativeCategory); }; tabs.append(button); }
  page.append(tabs);
  if (modelTab === 'providers') { renderProviders(page); chatBox.append(page); return; }
  const tokenBar=document.createElement('section');tokenBar.className='hf-token-bar';const tokenCopy=document.createElement('div');tokenCopy.className='hf-token-copy';const tokenTitle=document.createElement('strong');tokenTitle.textContent='Hugging Face access token';const tokenHelp=document.createElement('span');tokenHelp.textContent='Saved on this device and used to authenticate all Hugging Face model downloads, including chat models.';tokenCopy.append(tokenTitle,tokenHelp);const tokenInput=document.createElement('input');tokenInput.id='hf-token-input';tokenInput.type='password';tokenInput.autocomplete='new-password';tokenInput.spellcheck=false;tokenInput.placeholder=hfTokenConfigured?'Token saved · enter a replacement':'Paste a Hugging Face read token';tokenInput.value=hfTokenDraft;tokenInput.setAttribute('aria-label','Hugging Face access token');tokenInput.oninput=()=>scheduleHuggingFaceTokenSave(tokenInput.value);tokenInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(hfTokenSaveTimer!==undefined)window.clearTimeout(hfTokenSaveTimer);if(tokenInput.value.trim())void saveHuggingFaceToken(tokenInput.value.trim());}};const tokenClear=document.createElement('button');tokenClear.type='button';tokenClear.className='secondary';tokenClear.textContent='Clear';tokenClear.disabled=!hfTokenConfigured&&!hfTokenDraft;tokenClear.onclick=()=>{if(hfTokenSaveTimer!==undefined)window.clearTimeout(hfTokenSaveTimer);hfTokenDraft='';tokenInput.value='';tokenClear.disabled=true;void saveHuggingFaceToken('');};const tokenStatus=document.createElement('span');tokenStatus.id='hf-token-status';tokenStatus.className='hf-token-status';tokenStatus.setAttribute('role','status');tokenStatus.textContent=hfTokenStatus||(hfTokenConfigured?'Token saved':'Optional · required only for gated/private models');tokenBar.append(tokenCopy,tokenInput,tokenClear,tokenStatus);page.append(tokenBar);
  const results = document.createElement('div'); results.className = 'model-results';
  if (modelTab !== 'manage') {
    if (modelTab === 'creative') {
      const category = document.createElement('div'); category.className = 'model-tabs model-subtabs'; for (const [value,label] of [['image','Images'],['video','Video']] as const) { const b=document.createElement('button');b.type='button';b.className=`model-tab${creativeCategory===value?' active':''}`;b.textContent=label;b.onclick=()=>{if(creativeCategory!==value){hubModels=[];modelQuery='';activeHubRepo='';activeHubFiles=[];}creativeCategory=value;void renderModelsView();void loadPopularHubModels(value);};category.append(b); } page.append(category);
      if(!createState&&!createEngineStateLoading){createEngineStateLoading=true;void window.orion.getCreateEngineState().then(state=>{createState=state;}).catch(()=>{createState={installed:false,running:false,firstEntrySeen:true,phase:'error',detail:'Could not check the managed native image/video engine runtime.',gpu:'Unknown'};}).finally(()=>{createEngineStateLoading=false;if(activeView==='Models'&&modelTab==='creative')renderModelsView();});}
      if(!createState?.installed){const setup=document.createElement('section');setup.className='create-setup-card model-engine-setup';const title=document.createElement('h2');title.textContent='Image and video generation require stable-diffusion.cpp';const detail=document.createElement('p');detail.textContent=createEngineStateLoading?'Checking stable-diffusion.cpp setup…':'Install the Vulkan inference engine from Orion’s Create page first. Orion will manage the runtime and install each model with its required components.';const action=document.createElement('button');action.type='button';action.className='primary';action.textContent='Go to Create setup';action.onclick=()=>document.querySelector<HTMLButtonElement>('.nav-item[data-view="Create"]')?.click();setup.append(title,detail,action);page.append(setup);}
      const guidance=document.createElement('p');guidance.className='muted model-hint';guidance.textContent=creativeCategory==='image'?'Image generation runs Stable Diffusion checkpoints directly through stable-diffusion.cpp. Component-only Diffusers repositories and unrelated image model families are filtered out.':'Video generation uses the complete Wan 2.2 TI2V 5B bundle with its text encoder and VAE.';page.append(guidance);
    }
    const browseCategory=modelTab==='conversational'?'conversational':creativeCategory;
    const search = document.createElement('div'); search.className = 'model-search'; const input=document.createElement('input'); input.placeholder = modelTab==='conversational' ? 'Search Hugging Face chat models (e.g. Qwen GGUF)' : `Search Hugging Face ${creativeCategory} models`; input.value = modelQuery; input.oninput=()=>{modelQuery=input.value;};
    const searchButton=document.createElement('button');searchButton.type='button';searchButton.className='primary';searchButton.textContent='Search';searchButton.onclick=async()=>{modelQuery=input.value.trim();hubModels=[];popularHubRequest++;popularHubLoading=null;popularHubError='';results.replaceChildren();results.textContent='Searching Hugging Face…';try{hubModels=await window.orion.searchHub(modelQuery,browseCategory);await renderModelsView();}catch(error){results.textContent=`Search failed: ${error instanceof Error?error.message:String(error)}`;}};
    input.id='hub-query'; input.addEventListener('keydown',e=>{if(e.key==='Enter')searchButton.click();}); search.append(input,searchButton); page.append(search);
    const popularLabel=document.createElement('p');popularLabel.className='muted hub-popular-label';popularLabel.textContent=modelQuery?'Search results':'Popular on Hugging Face · sorted by downloads';page.append(popularLabel);
    if (hubModels.length) for (const model of hubModels) {
      const card=document.createElement('article');card.className='model-card';card.dataset.repo=model.id;const top=document.createElement('div');top.className='model-card-top';const name=document.createElement('h2');name.textContent=model.id==='QuantStack/Wan2.2-TI2V-5B-GGUF'?'Wan 2.2 TI2V 5B':model.id;const badge=document.createElement('span');badge.className='model-badge';badge.textContent=modelTab==='creative'?'Hugging Face repository':model.pipelineTag??'Hugging Face';top.append(name,badge);card.append(top);
      const meta=document.createElement('p');meta.className='model-card-meta';meta.textContent=`${(model.downloads??0).toLocaleString()} downloads${model.likes?` · ${model.likes.toLocaleString()} likes`:''}${model.license?` · License: ${model.license}`:''}${model.description?` · ${model.description.slice(0,180)}`:''}`;card.append(meta);const size=document.createElement('p');size.className='model-download-size';size.textContent='Checking supported download size…';card.append(size);const sizeKey=`${model.id}|${modelTab==='conversational'?'conversational':creativeCategory}`;let sizePromise=modelCardSizes.get(sizeKey);if(!sizePromise){sizePromise=window.orion.getHubFiles(model.id,modelTab==='conversational'?'conversational':creativeCategory).then(files=>{const seen=new Set<string>();let total=0;for(const f of files){if(!seen.has(f.name)){seen.add(f.name);total+=f.size;}for(const shard of f.relatedFiles??[])if(!seen.has(shard.name)){seen.add(shard.name);total+=shard.size;}}return{total,count:files.length};});modelCardSizes.set(sizeKey,sizePromise);}void sizePromise.then(({total,count})=>{if(!size.isConnected)return;size.textContent=modelTab==='conversational'?`Available GGUF files · ${modelSize(total)} total`:count?`${count===1?'Supported download':'Supported downloads'} · ${modelSize(total)}`:'No complete supported bundle available';}).catch(()=>{if(size.isConnected)size.textContent='Download size unavailable';});
      const actions=document.createElement('div');actions.className='model-actions';
      const downloadCategory=modelTab==='conversational'?'conversational':creativeCategory;
      const filesButton=document.createElement('button');filesButton.type='button';filesButton.className='secondary';filesButton.textContent=activeHubRepo===model.id?'Reload files':modelTab==='conversational'?'Choose quantization / file':creativeCategory==='video'?'View supported Wan bundle':'View Stable Diffusion checkpoints';filesButton.onclick=async()=>{activeHubRepo=model.id;activeHubFiles=[];try{activeHubFiles=await window.orion.getHubFiles(model.id,downloadCategory);activeHubFiles=activeHubFiles.filter(file=>modelTab==='conversational'?/\.gguf$/i.test(file.name):creativeCategory==='image'?/\.(safetensors|ckpt|gguf)$/i.test(file.name):/\.(safetensors|ckpt|gguf)$/i.test(file.name));if(!activeHubFiles.length&&modelTab==='creative')showNotice(creativeCategory==='video'?'This repository does not have a complete Wan bundle supported by Orion yet.':'This repository contains no complete, single-file Stable Diffusion checkpoint supported by Orion.');await renderModelsView();}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not list model files');}};actions.append(filesButton);
      if(activeHubRepo===model.id&&activeHubFiles.length){const select=document.createElement('select');select.className='hub-file-select';for(const file of activeHubFiles){const option=new Option(`${file.name} · ${modelSize(file.size)}${file.relatedFiles?.length?` · ${file.relatedFiles.length+1} files`:''}`,file.name);select.add(option);}const download=document.createElement('button');download.type='button';download.className='primary';download.textContent='Download';download.onclick=()=>void beginModelDownload(model.id,select.value,downloadCategory,download);actions.append(select,download);}
      card.append(actions);const inlineProgress=document.createElement('div');inlineProgress.className='model-download-progress';inlineProgress.hidden=true;const progressText=document.createElement('div');progressText.className='download-detail';const progressBar=document.createElement('progress');const cancelDownload=document.createElement('button');cancelDownload.type='button';cancelDownload.className='download-cancel';cancelDownload.textContent='Cancel download';cancelDownload.onclick=()=>{const active=[...downloadProgress.values()].find(item=>item.repo===model.id&&item.phase==='downloading');if(active){cancelDownload.disabled=true;cancelDownload.textContent='Stopping…';void window.orion.cancelModelDownload(active.id);}};inlineProgress.append(progressText,progressBar,cancelDownload);card.append(inlineProgress);results.append(card);
    } else if (popularHubLoading===browseCategory) { const hint=document.createElement('p');hint.className='muted model-hint';hint.textContent='Loading popular models from Hugging Face…';results.append(hint); }
    else if (popularHubError) { const hint=document.createElement('p');hint.className='muted model-hint';hint.textContent=`Could not load popular models: ${popularHubError}. Search Hugging Face above to retry.`;results.append(hint); }
    else if (hubModels.length===0) { const hint=document.createElement('p');hint.className='muted model-hint';hint.textContent='No popular repositories found. Search Hugging Face to browse more models.';results.append(hint); }
  } else {
    const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary';refresh.textContent='Refresh installed models';refresh.onclick=async()=>{installedModels=await window.orion.listInstalledModels();await refreshModels();renderModelsView();};page.append(refresh);
    const all=[...installedModels.map(model=>({id:model.id,name:model.invokeKey?model.file:model.repo,file:model.invokeKey?'Managed by native image/video engine':model.file,size:model.size,origin:'Orion'})),...models.filter(model=>model.source!=='orion' && model.source!=='api').map(model=>({id:model.name,name:model.name,file:'',size:model.size,origin:'Ollama'}))];
    if(!all.length){results.textContent='No models are installed yet.';} else for(const item of all){const card=document.createElement('article');card.className='model-card';const top=document.createElement('div');top.className='model-card-top';const title=document.createElement('h2');title.textContent=item.name;const badge=document.createElement('span');badge.className='model-badge';badge.textContent=item.origin;top.append(title,badge);card.append(top);const meta=document.createElement('p');meta.className='model-card-meta';meta.textContent=[item.file,modelSize(item.size)].filter(Boolean).join(' · ');card.append(meta);const del=document.createElement('button');del.type='button';del.className='secondary danger-button';del.textContent='Delete model';del.onclick=async()=>{if(!(await askConfirm(`Delete ${item.name} from this device?`, 'Delete model')))return;try{if(item.origin==='Ollama')await window.orion.deleteOllamaModel(item.id);else await window.orion.deleteInstalledModel(item.id);installedModels=await window.orion.listInstalledModels();await refreshModels();renderModelsView();}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not delete model');}};card.append(del);results.append(card);}
  }
  page.append(results); chatBox.append(page); chatScroller.scrollTop=0;
}
function renderCreateView() {
  document.body.classList.add('create-view'); document.body.classList.remove('models-view');
  $('model-selector-wrap').hidden = true;
  const composerWrap = $('create-composer-wrap'); composerWrap.replaceChildren(); composerWrap.hidden = !createState?.installed;
  chatBox.replaceChildren();
  const page = document.createElement('section'); page.className = 'workspace-view create-page'; page.setAttribute('aria-labelledby','create-heading');
  const heading = document.createElement('h1'); heading.id='create-heading'; heading.textContent='Create';
  const subtitle = document.createElement('p'); subtitle.textContent='Make images and video privately on your device.';
  page.append(heading,subtitle);

  const stage = document.createElement('section'); stage.className='create-stage'; stage.setAttribute('aria-label','Generation workspace');
  if (!createState?.installed) {
    const setup=document.createElement('div');setup.className='create-setup-card';
    const copy=document.createElement('div');copy.className='create-setup-copy';
    const title=document.createElement('h2');title.textContent='Set up local generation';
    const detail=document.createElement('p');detail.textContent=createState?.detail??'Install Orion’s managed native image/video engine runtime to create images and video locally.';
    const action=document.createElement('button');action.type='button';action.className='primary';action.textContent=createState?.phase==='error'?'Retry setup':'Install native image/video engine';action.disabled=engineInstallPending;action.onclick=()=>void startEngineInstall();
    copy.append(title,detail,action);setup.append(copy);
    if(engineInstallPending){const progress=createProgress.get(engineProgressId);const status=document.createElement('div');status.className='setup-progress';const label=document.createElement('strong');label.textContent=progress?.detail||'Preparing native image/video engine…';const bar=document.createElement('progress');bar.max=100;if(progress?.percent!==undefined)bar.value=progress.percent;status.append(label,bar);setup.append(status);}
    stage.append(setup);
  } else {
    const liveGenerations=[...createPageGenerationIds].map(requestId=>createProgress.get(requestId)).filter((item):item is CreateProgress=>Boolean(item));
    if(liveGenerations.length){
      for(const live of liveGenerations){
      const card=document.createElement('article');card.className=`generation-card create-generation-card${live.phase==='complete'?' is-complete':''}${live.phase==='error'?' has-error':''}`;card.dataset.generation=live.id;
      const top=document.createElement('div');top.className='generation-card-top';const label=document.createElement('strong');label.textContent=live.phase==='error'?'Generation failed':live.phase==='complete'?`${live.mediaType==='video'?'Video':'Image'} ready`:`Creating ${live.mediaType??createKind}`;top.append(label);
      const visual=document.createElement('div');visual.className='generation-visual';visual.setAttribute('role','status');visual.setAttribute('aria-label',label.textContent);
      if(!live.imagePath&&live.phase!=='error')visual.append(generationDotField());
      const percent=document.createElement('span');percent.className='generation-percent';percent.textContent=live.phase==='complete'?'Ready':`${Math.max(0,Math.min(99,live.percent??0))}%`;visual.append(percent);
      if(live.imagePath)void generatedMediaUrl(live.imagePath).then(src=>{if(!visual.isConnected)return;const media=live.mediaType==='video'?document.createElement('video'):document.createElement('img');media.className='generation-output';if(media instanceof HTMLVideoElement){media.controls=true;media.playsInline=true;}else media.alt='Generated with Orion';media.src=src;visual.replaceChildren(media);}).catch(()=>undefined);
      const prompt=document.createElement('p');prompt.className='generation-prompt';prompt.textContent=live.phase==='error'?live.error??live.detail:createPageGenerationPrompts.get(live.id)??live.detail;
      card.append(top,visual,prompt);stage.append(card);
      }
    }else{
      const ready=document.createElement('div');ready.className='create-ready-state';const label=document.createElement('strong');label.textContent=`Ready to create ${createKind === 'video' ? 'a video' : 'an image'}`;const hint=document.createElement('span');hint.textContent='Describe the scene below and Orion will render it here.';ready.append(label,hint);stage.append(ready);
    }
  }
  page.append(stage);

  const gallery=document.createElement('section');gallery.className='create-gallery';gallery.setAttribute('aria-labelledby','create-gallery-title');
  const galleryHead=document.createElement('header');galleryHead.className='create-gallery-heading';const galleryTitle=document.createElement('h2');galleryTitle.id='create-gallery-title';galleryTitle.textContent='Your creations';const galleryCount=document.createElement('span');galleryCount.className='create-gallery-count';galleryCount.textContent=String(generatedMedia.length);const folderButton=document.createElement('button');folderButton.type='button';folderButton.className='create-gallery-folder';folderButton.title='Open creations folder';folderButton.setAttribute('aria-label','Open creations folder');const folderIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');folderIcon.setAttribute('viewBox','0 0 24 24');folderIcon.setAttribute('aria-hidden','true');const folderBack=document.createElementNS('http://www.w3.org/2000/svg','path');folderBack.setAttribute('d','M3.5 6.5h6l2 2h9v9.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z');const folderFront=document.createElementNS('http://www.w3.org/2000/svg','path');folderFront.setAttribute('d','M3.5 9h17');folderIcon.append(folderBack,folderFront);folderButton.append(folderIcon);folderButton.onclick=()=>void window.orion.openGeneratedFolder().catch(error=>showNotice(error instanceof Error?error.message:String(error),'Could not open folder'));galleryHead.append(galleryTitle,galleryCount,folderButton);gallery.append(galleryHead);
  const grid=document.createElement('div');grid.className='create-gallery-grid';
  const galleryItems=generatedMedia;
  if(!galleryItems.length){const empty=document.createElement('div');empty.className='create-gallery-empty';empty.textContent='Your generated images and videos will appear here.';grid.append(empty);}
  for(const output of galleryItems){const card=document.createElement('article');card.className='create-gallery-item';const mediaFrame=document.createElement('button');mediaFrame.type='button';mediaFrame.className='create-gallery-media';mediaFrame.title='Open larger preview';mediaFrame.setAttribute('aria-label',`Preview ${output.mediaType}: ${output.prompt||'Generated media'}`);mediaFrame.onclick=()=>void openGeneratedMediaPreview(output);void generatedMediaUrl(output.path).then(src=>{if(!mediaFrame.isConnected)return;const media=output.mediaType==='video'?document.createElement('video'):document.createElement('img');media.className='generated-media';if(media instanceof HTMLVideoElement){media.playsInline=true;media.muted=true;media.preload='metadata';}else media.alt=output.prompt||'Generated image';media.src=src;mediaFrame.append(media);if(output.mediaType==='video'){const play=document.createElement('span');play.className='create-gallery-play';play.textContent='▶';play.setAttribute('aria-hidden','true');mediaFrame.append(play);}}).catch(()=>undefined);const caption=document.createElement('p');caption.className='create-gallery-caption';caption.textContent=output.prompt||`Created ${output.mediaType}`;const date=document.createElement('time');date.className='create-gallery-date';date.dateTime=new Date(output.createdAt).toISOString();date.textContent=new Date(output.createdAt).toLocaleString();card.append(mediaFrame,caption,date);grid.append(card);}
  gallery.append(grid);page.append(gallery);chatBox.append(page);

  if(createState?.installed){
    const form=document.createElement('div');form.className='create-composer';
    const prompt=document.createElement('textarea');prompt.placeholder=`Describe the ${createKind} you want to create…`;prompt.rows=2;prompt.value=createPromptDraft;prompt.setAttribute('aria-label',`Describe the ${createKind} to generate`);prompt.oninput=()=>{createPromptDraft=prompt.value;};
    const actions=document.createElement('div');actions.className='create-composer-actions';const modes=document.createElement('div');modes.className='create-modes';
    for(const [mode,labelText] of [['image','Image'],['video','Video']] as const){const button=document.createElement('button');button.type='button';button.className=`create-mode${createKind===mode?' active':''}`;button.textContent=labelText;button.setAttribute('aria-pressed',String(createKind===mode));button.onclick=()=>{createKind=mode;renderCreateView();};modes.append(button);}
    const model=document.createElement('select');model.className='create-model';const list=installedModels.filter(item=>item.category===createKind&&(createKind!=='video'||!/(t5|text.?encoder|clip)/i.test(item.file)));model.add(new Option(list.length?'Choose a downloaded model':'No downloaded model available',''));for(const item of list)model.add(new Option(`${item.repo} · ${item.file}`,item.id));
    const preferred=createKind==='video'?settings.defaultVideoModel:settings.defaultImageModel;if(preferred&&list.some(item=>item.id===preferred))model.value=preferred;model.onchange=async()=>{if(createKind==='video')settings.defaultVideoModel=model.value;else settings.defaultImageModel=model.value;await window.orion.saveSettings(settings);};
    const generate=document.createElement('button');generate.type='button';generate.className='send create-generate';generate.disabled=Boolean(activeCreateGeneration);generate.textContent=activeCreateGeneration?'Creating…':'Generate';
    prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!generate.disabled)generate.click();}});
    generate.onclick=async()=>{const promptText=prompt.value.trim();if(!promptText){showNotice('Describe what you want to make first.','Prompt required');return;}if(!model.value){showNotice(`Download a ${createKind} model in Models → Image / Video first.`,'Model required');return;}const requestId=id();createPageGenerationIds.add(requestId);createPageGenerationPrompts.set(requestId,promptText);activeCreateGeneration={id:requestId,prompt:promptText,kind:createKind};createProgress.set(requestId,{id:requestId,phase:'queued',detail:'Preparing your generation…',percent:0,mediaType:createKind});generate.disabled=true;generate.textContent='Creating…';renderCreateView();try{await window.orion.generateImage(promptText,model.value,createKind,requestId);await refreshGeneratedGallery();createPromptDraft='';}catch(error){activeCreateGeneration=null;if(createPageGenerationIds.has(requestId)){createProgress.set(requestId,{id:requestId,phase:'error',detail:error instanceof Error?error.message:String(error),error:error instanceof Error?error.message:String(error),mediaType:createKind});if(activeView==='Create')renderCreateView();}showNotice(error instanceof Error?error.message:String(error),'Generation failed');}finally{activeCreateGeneration=null;generate.disabled=false;generate.textContent='Generate';if(activeView==='Create')renderCreateView();}};
    actions.append(modes,model,generate);form.append(prompt,actions);composerWrap.append(form);composerWrap.hidden=false;
  }
}

function renderMessage(active: Conversation, message: Message) {
  const live = streaming && active.id === current?.id && active.messages.at(-1)?.id === message.id;
  const article = document.createElement('article');
  article.dataset.messageId = message.id;
  article.className = `message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`;
  const header = document.createElement('div');
  header.className = 'message-header';
  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = message.role === 'user' ? 'You' : assistantModelLabel(active.model || '');
  const timestamp = document.createElement('span');
  timestamp.className = 'message-time';
  timestamp.textContent = time(message.createdAt);
  header.append(author, timestamp);
  article.append(header);
  const hasVisibleOutput = Boolean(message.content.trim() || message.reasoning?.trim() || message.toolCalls?.length || message.webResearch?.steps.length);
  if (live && !hasVisibleOutput) { const loading=document.createElement('div');loading.className='chat-loading';loading.setAttribute('role','status');loading.setAttribute('aria-live','polite');const dots=document.createElement('span');dots.className='loading-dots';dots.setAttribute('aria-hidden','true');for(let index=0;index<3;index++)dots.append(document.createElement('i'));const text=document.createElement('span');text.textContent=generationStatus||'Waiting for the model…';loading.append(dots,text);article.append(loading); }
  const workflow = document.createElement('section');
  workflow.className = 'assistant-workflow';
  if (message.reasoning) {
    const details = document.createElement('details');
    details.className = 'reasoning';
    details.open = expandedThinking.has(message.id) || (streaming && active.id === current?.id && active.messages.at(-1)?.id === message.id);
    const summary=document.createElement('summary');const label=document.createElement('span');label.className='reasoning-label';label.textContent='Thinking';const meta=document.createElement('span');meta.className='reasoning-meta';summary.append(label,meta);const content=document.createElement('div');content.className='reasoning-content';details.append(summary,content);
    const reasoningMeta = details.querySelector<HTMLElement>('.reasoning-meta');
    if (reasoningMeta) reasoningMeta.textContent = streaming && active.id === current?.id && active.messages.at(-1)?.id === message.id ? 'In progress' : 'View reasoning';
    details.querySelector('.reasoning-content')!.replaceChildren(safeMarkdownFragment(message.reasoning, live));
    details.addEventListener('toggle', () => {
      if (details.open) expandedThinking.add(message.id);
      else expandedThinking.delete(message.id);
    });
    workflow.append(details);
  }
  if (message.webResearch) {
    const activity = message.webResearch;
    const details = document.createElement('details');
    details.className = 'web-research-activity';
    details.open = toolActivityOpenState.get(`web:${message.id}`) ?? (activity.status !== 'complete' && activity.status !== 'error');
    details.addEventListener('toggle', () => toolActivityOpenState.set(`web:${message.id}`, details.open));
    const summary = document.createElement('summary');
    const title = document.createElement('span'); title.className = 'web-research-title'; title.textContent = 'Web research';
    const status = document.createElement('span'); status.className = `web-research-status ${activity.status}`;
    status.textContent = activity.status === 'planning' ? 'Preparing search' : activity.status === 'searching' ? 'Searching' : activity.status === 'reading' ? 'Reading sources' : activity.status === 'error' ? 'Search issue' : 'Complete';
    summary.append(title, status); details.append(summary);
    const steps = document.createElement('div'); steps.className = 'web-research-steps';
    for (const step of activity.steps) {
      const section = document.createElement('section'); section.className = `web-research-step ${step.status}`;
      const query = document.createElement('div'); query.className = 'web-research-query'; query.textContent = step.query ? `Search for ${step.query}` : 'Preparing a search query'; section.append(query);
      if (step.sources.length) {
        const reading = document.createElement('div'); reading.className = 'web-research-phase'; reading.textContent = 'Reading'; section.append(reading);
        const sources = document.createElement('div'); sources.className = 'web-research-sources';
        for (const source of step.sources) {
          const link = document.createElement('a'); link.className = `web-research-source ${source.status}`; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = source.title || (() => { try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return source.url; } })();
          link.title = source.title || source.url; sources.append(link);
        }
        section.append(sources);
      }
      if (step.error) { const error = document.createElement('div'); error.className = 'web-research-error'; error.textContent = step.error; section.append(error); }
      steps.append(section);
    }
    details.append(steps); workflow.append(details);
  }
  if (message.toolCalls?.length) {
    const activity = document.createElement('details');
    activity.className = 'tool-activity';
    const activityId = `tool-activity:${message.id}`;
    const activeToolCount = message.toolCalls.filter(call => call.status === 'running' || call.status === 'pending').length;
    activity.open = toolActivityOpenState.get(activityId) ?? activeToolCount > 0;
    activity.addEventListener('toggle', () => toolActivityOpenState.set(activityId, activity.open));
    const activitySummary = document.createElement('summary');
    activitySummary.className = 'tool-activity-summary';
    const activityTitle = document.createElement('span'); activityTitle.className = 'tool-activity-title';
    activityTitle.textContent = activeToolCount ? 'Working with tools' : 'Tool activity';
    const activityMeta = document.createElement('span'); activityMeta.className = `tool-activity-meta${activeToolCount ? ' is-active' : ''}`;
    activityMeta.textContent = activeToolCount ? `${activeToolCount} active` : `${message.toolCalls.length} ${message.toolCalls.length === 1 ? 'action' : 'actions'}`;
    activitySummary.append(activityTitle, activityMeta); activity.append(activitySummary);
    const calls = document.createElement('div');
    calls.className = 'tool-calls';
    const renderedToolCards: Array<{ call: ToolCallRecord; card: HTMLDetailsElement }> = [];
    for (const call of message.toolCalls) {
      if (message.webResearch && (call.name === 'search_web' || call.name === 'web_fetch')) continue;
      const card = document.createElement('details');
      card.className = `tool-call${call.name==='create_image'?' generation-card':''} ${call.status}`;
      card.dataset.toolCallId = call.id;
      card.dataset.toolName = call.name;
      card.open = toolCallOpenState.get(call.id) ?? Boolean(call.imagePath);
      card.addEventListener('toggle', () => toolCallOpenState.set(call.id, card.open));
      const title = document.createElement('summary');
      title.className = 'tool-title';
      const label = document.createElement('span');
      label.className = 'tool-name';
      const toolNames: Record<string, string> = { ask_user_question: 'Asked a question', workspace_list: 'Listed files', workspace_search: 'Searched files', workspace_read: 'Read file', workspace_write: 'Wrote file', workspace_edit: 'Edited file', workspace_run: 'Ran command', read_file: 'Read file', write_file: 'Wrote file', run_command: 'Ran command', search_files: 'Searched files', create_diagram: 'Created diagram', create_image: 'Created media', search_memory: 'Searched memory', search_web: 'Searched the web', browser_open: 'Opened browser', browser_control: 'Used browser' };
      label.textContent = toolNames[call.name] ?? call.name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ');
      const heading = document.createElement('span'); heading.className = 'tool-heading'; heading.append(label);
      const detailValue = call.name === 'workspace_run' || call.name === 'run_command' ? call.input.command
        : call.name === 'workspace_search' || call.name === 'search_files' || call.name === 'search_memory' || call.name === 'search_web' ? call.input.query
          : call.input.path ?? call.input.url ?? call.input.title;
      if (detailValue !== undefined && detailValue !== null && String(detailValue).trim()) {
        const summary = document.createElement('span'); summary.className = 'tool-inline-detail'; summary.textContent = String(detailValue).replace(/\s+/g, ' ').slice(0, 100); heading.append(summary);
      }
      if (call.description && !call.description.startsWith('Orion coding tool.')) { const description = document.createElement('span'); description.className = 'tool-description'; description.textContent = call.description; heading.append(description); }
      title.append(heading);
      const status = document.createElement('span');
      status.className = `tool-status ${call.status}`;
      status.textContent = call.status === 'running' ? 'Running' : call.status === 'pending' ? 'Needs approval' : call.status === 'completed' ? 'Completed' : call.status === 'denied' ? 'Declined' : 'Failed';
      title.append(status);
      card.append(title);
      const body = document.createElement('div'); body.className = 'tool-body';
      const entries = Object.entries(call.input ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
      if (entries.length) {
        const request = document.createElement('details'); request.className = 'tool-request';
        request.open = false;
        const requestTitle = document.createElement('summary'); requestTitle.textContent = 'Arguments'; request.append(requestTitle);
        const requestBody = document.createElement('dl'); requestBody.className = 'tool-input-list';
        for (const [key, value] of entries.slice(0, 16)) {
          const term = document.createElement('dt'); term.textContent = key.replaceAll('_', ' ');
          const description = document.createElement('dd');
          const rendered = typeof value === 'string' ? value : JSON.stringify(value);
          description.textContent = (rendered ?? String(value)).slice(0, 4000);
          requestBody.append(term, description);
        }
        if (entries.length > 16) { const more = document.createElement('dd'); more.textContent = `${entries.length - 16} additional inputs`; requestBody.append(more); }
        request.append(requestBody); body.append(request);
      }
      if (call.output !== undefined && call.name !== 'create_diagram' && call.name !== 'create_image') {
        const result = document.createElement('details'); result.className = 'tool-result';
        result.open = false;
        const resultTitle = document.createElement('summary'); resultTitle.className = 'tool-result-summary'; const resultLabel = document.createElement('span'); resultLabel.textContent = 'Result'; const resultHint = document.createElement('span'); resultHint.className = 'tool-result-hint'; resultHint.textContent = 'Click to expand'; resultTitle.append(resultLabel, resultHint); result.addEventListener('toggle', () => { resultHint.textContent = result.open ? 'Click to collapse' : 'Click to expand'; }); result.append(resultTitle);
        const output = document.createElement('div'); output.className = 'tool-output'; output.textContent = call.output; result.append(output); body.append(result);
      }
      if (call.name === 'create_image') {
        const visual=document.createElement('div');visual.className=`tool-generation-stage${call.imagePath?' is-complete':''}`;
        if(call.imagePath&&call.mediaType){void generatedMediaUrl(call.imagePath).then(src=>{if(!visual.isConnected)return;const media=call.mediaType==='video'?document.createElement('video'):document.createElement('img');media.className='tool-generation-output';if(media instanceof HTMLVideoElement){media.controls=true;media.playsInline=true;}else media.alt='Generated with Orion';media.src=src;visual.replaceChildren(media);}).catch(()=>undefined);}
        else if(call.status==='running'){visual.append(generationDotField());const percent=document.createElement('span');percent.className='tool-generation-percent';percent.textContent=`${Math.max(0,Math.min(99,call.progress??0))}%`;visual.append(percent);}
        else {const waiting=document.createElement('span');waiting.className='tool-generation-waiting';waiting.textContent=call.status==='pending'?'Waiting for approval…':call.status==='error'?(call.output??'Generation failed'):'Preparing local generation…';visual.append(waiting);}
        body.append(visual);
        const detail=document.createElement('div');detail.className='tool-generation-detail';detail.textContent=call.status==='running'?(call.progressDetail??'Generating locally…'):call.status==='pending'?'Waiting for approval…':call.status==='error'?(call.output??'Generation failed'):'';body.append(detail);
      }
      if(call.name==='create_diagram'&&call.output&&call.status==='completed'){
        const source=document.createElement('details');source.className='tool-result';
        source.open=true;
        const sourceTitle=document.createElement('summary');sourceTitle.textContent='Diagram source';source.append(sourceTitle);
        const sourceText=document.createElement('div');sourceText.className='tool-output';sourceText.textContent=call.output;source.append(sourceText);body.append(source);
        queueMicrotask(()=>void renderDiagram(article,call.output!,call.input.title));
      }
      if (body.childNodes.length) card.append(body);
      renderedToolCards.push({ call, card });
    }
    const isCompactRead = (call: ToolCallRecord) => call.status === 'completed' && ['workspace_list','workspace_search','workspace_read','read_file','search_files'].includes(call.name);
    for (let index = 0; index < renderedToolCards.length;) {
      const item = renderedToolCards[index]!;
      if (!isCompactRead(item.call)) { calls.append(item.card); index++; continue; }
      let end = index + 1;
      while (end < renderedToolCards.length && isCompactRead(renderedToolCards[end]!.call)) end++;
      if (end - index < 2) { calls.append(item.card); index = end; continue; }
      const group = document.createElement('details'); group.className = 'tool-activity-group';
      const groupId = message.id + ':' + renderedToolCards[index]!.call.id; group.open = toolActivityOpenState.get(groupId) ?? false;
      group.addEventListener('toggle', () => toolActivityOpenState.set(groupId, group.open));
      const summary = document.createElement('summary'); summary.textContent = 'Reviewed the workspace · ' + (end - index) + ' reads and searches'; group.append(summary);
      const items = document.createElement('div'); items.className = 'tool-activity-items';
      for (let child = index; child < end; child++) items.append(renderedToolCards[child]!.card);
      group.append(items); calls.append(group); index = end;
    }
    activity.append(calls);
    workflow.append(activity);
  }
  if (workflow.childNodes.length) {
    const label = document.createElement('div');
    label.className = 'assistant-workflow-label';
    label.textContent = streaming && active.id === current?.id && active.messages.at(-1)?.id === message.id ? 'IN PROGRESS' : 'PROCESS';
    workflow.prepend(label);
    article.append(workflow);
  }
  const body = document.createElement('div');
  body.className = 'message-body';
  body.replaceChildren(safeMarkdownFragment(message.content, live));
  body.dataset.contentLength = String(message.content.length);
  wireCodeButtons(body, active);
  article.append(body);
  if (!live) queueMicrotask(()=>renderMarkdownDiagrams(body));
  const footer = document.createElement('div'); footer.className = 'message-footer';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'message-copy'; copy.textContent = 'Copy'; copy.onclick = async () => { await navigator.clipboard.writeText(message.content); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); }; footer.append(copy); if(message.role==='assistant'){const html=message.content.match(/```(?:html|htm)\s*([\s\S]*?)```/i),md=message.content.match(/```(?:markdown|md)\s*([\s\S]*?)```/i),plainDoc=!html&&!md&&message.content.trim().startsWith('# ')&&message.content.length>250;if(html||md||plainDoc){const open=document.createElement('button');open.type='button';open.className='message-copy';open.textContent='Open in Canvas';open.onclick=()=>showCanvas({id:crypto.randomUUID(),name:html?'Generated page.html':'Generated document.md',format:html?'html':'markdown',content:html?html[1]!.trim():md?md[1]!.trim():message.content,conversationId:active.id,source:'response'});footer.append(open);}}
  if (message.role === 'assistant' && message.generationMs !== undefined) { const elapsed = document.createElement('span'); elapsed.className = 'message-metric'; elapsed.textContent = `${(message.generationMs / 1000).toFixed(1)}s`; footer.append(elapsed); }
  if (message.role === 'assistant' && message.tokensPerSecond !== undefined) { const rate = document.createElement('span'); rate.className = 'message-metric'; rate.textContent = `${message.tokensPerSecond.toFixed(1)} tokens/s`; footer.append(rate); }
  article.append(footer);
  return article;
}
function wireCodeButtons(body: HTMLElement, active: Conversation) {
  for (const button of body.querySelectorAll<HTMLButtonElement>('.open-code-canvas')) { button.addEventListener('click', () => { const content = decodeURIComponent(button.dataset.canvasContent ?? ''); const language = button.dataset.canvasLang ?? 'Code'; const normalized = language.toLowerCase(); const format: CanvasDocument['format'] = ['html','htm'].includes(normalized) ? 'html' : ['md','markdown'].includes(normalized) ? 'markdown' : 'code'; const extension = format === 'html' ? 'html' : format === 'markdown' ? 'md' : normalized.replace(/[^a-z0-9_-]/g,'') || 'txt'; showCanvas({ id: crypto.randomUUID(), name: `Generated document.${extension}`, format, content, conversationId: active.id, source: 'response' }, format === 'code' ? 'source' : 'preview'); }); }
}
function renderConversationMap(active: Conversation | null) {
  const userMessages = active?.messages.filter(message => message.role === 'user') ?? [];
  const hasMessages = userMessages.length > 0;
  conversationMap.hidden = !hasMessages;
  conversationMap.style.display = hasMessages ? 'flex' : 'none';
  if (conversationMap.hidden) { conversationMapKey = ''; conversationMapItems.replaceChildren(); return; }
  positionConversationMap(userMessages.length);
  const key = `${active!.id}:${userMessages.map(message => message.id).join(',')}`;
  if (key === conversationMapKey) return;
  const changedConversation = !conversationMapKey.startsWith(`${active!.id}:`);
  conversationMapKey = key; conversationMapItems.replaceChildren();
  const newest = userMessages.at(-1)?.id;
  // With column-reverse, the first DOM item sits at the bottom anchor.
  // Put the newest message first so older markers extend upward from it.
  userMessages.map((message, index) => ({ message, index })).reverse().forEach(({ message, index }) => {
    const marker = document.createElement('button'); marker.type = 'button'; marker.className = `conversation-marker${message.id === newest ? ' active' : ''}`;
    const snippet = message.content.replace(/\s+/g, ' ').trim() || 'Empty message';
    marker.setAttribute('aria-label', `Go to message ${index + 1}: ${snippet.slice(0, 160)}`);
    const line = document.createElement('span'); line.className = 'conversation-marker-line'; line.setAttribute('aria-hidden', 'true');
    const preview = document.createElement('span'); preview.className = 'conversation-marker-preview';
    const label = document.createElement('strong'); label.textContent = `Message ${index + 1}`;
    const text = document.createElement('span'); text.textContent = snippet.length > 180 ? `${snippet.slice(0, 177)}…` : snippet;
    preview.append(label, text); marker.append(line, preview);
    marker.addEventListener('pointerenter', () => { const rect = marker.getBoundingClientRect(); preview.style.left = `${Math.min(rect.right + 11, innerWidth - 290)}px`; preview.style.top = `${Math.max(10, Math.min(rect.top - 18, innerHeight - 100))}px`; });
    marker.onclick = () => { const target = [...chatBox.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === message.id); if (target) { followsLatestMessage = false; target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
    conversationMapItems.append(marker);
  });
  requestAnimationFrame(() => {
    const overflowing = conversationMapItems.scrollHeight > conversationMapItems.clientHeight + 1;
    conversationMapItems.classList.toggle('has-overflow', overflowing);
    if (changedConversation) conversationMapItems.scrollTop = 0;
  });
}
function positionConversationMap(messageCount: number) {
  const main = document.querySelector<HTMLElement>('.main');
  if (!main) return;
  const mainRect = main.getBoundingClientRect(), chatRect = chatScroller.getBoundingClientRect();
  const firstAnchor = chatRect.top + chatRect.height / 2;
  const lowestAnchor = Math.max(firstAnchor, mainRect.bottom - 220);
  const downshift = Math.min(Math.max(0, messageCount - 1) * 10, Math.max(0, lowestAnchor - firstAnchor));
  const anchor = Math.min(firstAnchor + downshift, lowestAnchor);
  conversationMap.style.top = `${Math.max(0, chatRect.top - mainRect.top + 12)}px`;
  conversationMap.style.bottom = `${Math.max(0, mainRect.bottom - anchor)}px`;
}
// Keep the midpoint anchor aligned when the window, header, or composer changes size.
const conversationMapResizeObserver = new ResizeObserver(() => {
  positionConversationMap(current?.messages.filter(message => message.role === 'user').length ?? 0);
});
const mainPanel = document.querySelector<HTMLElement>('.main');
if (mainPanel) conversationMapResizeObserver.observe(mainPanel);
conversationMapResizeObserver.observe(chatScroller);
function renderMessages(forceScroll = false) {
  document.body.classList.remove('models-view','create-view');
  $('model-selector-wrap').hidden = false; $('create-composer-wrap').hidden = true;
  renderConversationMap(current);
  if (activeView === 'Create') { renderCreateView(); return; }
  if (activeView === 'Models') { renderModelsView(); return; }
  const active = current;
  const shouldFollow = forceScroll || followsLatestMessage;
  const scrollAnchor = shouldFollow ? null : captureChatAnchor();
  chatBox.replaceChildren();
  if (!active?.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title=document.createElement('h1');title.textContent='Welcome to Orion.';const tagline=document.createElement('p');tagline.textContent='Private AI, running on your own machine.';empty.append(title,tagline);
    chatBox.append(empty);
  } else {
    for (const message of active.messages) chatBox.append(renderMessage(active, message));
  }
  if (shouldFollow) {
    const scrollToLatest = () => { chatScroller.scrollTop = chatScroller.scrollHeight; followsLatestMessage = true; };
    scrollToLatest();
    if (forceScroll) requestAnimationFrame(() => { if (followsLatestMessage) scrollToLatest(); });
  } else {
    restoreChatAnchor(scrollAnchor);
  }
  renderConversationMap(active);
}
function isEmbeddingModel(model: { name: string; capabilities?: string[] }) { return model.capabilities?.includes('embedding') === true || /nomic-embed|mxbai-embed|all-minilm|snowflake-arctic-embed|bge-|embeddinggemma|granite-embedding/i.test(model.name); }
function isChatCapableModel(model: { name: string; capabilities?: string[] }) { return model.capabilities?.length ? model.capabilities.includes('completion') : !isEmbeddingModel(model); }
function chatModels() { return models.filter(isChatCapableModel); }
function orionModelLabel(familyName: string, fileName: string) { const family = familyName.split('/').at(-1)!.replace(/[-_.]?gguf$/i, ''); const quant = fileName.match(/I?Q\d(?:_[A-Z0-9]+)*/i)?.[0]; const shortFamily = family.length > 34 ? `${family.slice(0, 33)}…` : family; return `${shortFamily}${quant ? ` · ${quant}` : ''}`; }
function modelSelectorLabel(model: (typeof models)[number]) { if (model.source === 'api') return String(model.details?.label ?? model.name); if (model.source !== 'orion') return model.name; return orionModelLabel(String(model.details?.family ?? model.name), String(model.details?.parameter_size ?? '')); }
function assistantModelLabel(name: string) { const model = models.find(candidate => candidate.name === name); if (model) return modelSelectorLabel(model); const id = name.startsWith('orion-gguf:') ? name.slice('orion-gguf:'.length) : ''; const installed = id ? installedModels.find(candidate => candidate.id === id) : undefined; if (installed) return orionModelLabel(installed.repo, installed.file); return name.startsWith('orion-gguf:') ? 'Local GGUF model' : name || 'Orion'; }
function setModels() { const select = $('model') as HTMLSelectElement; const choices = chatModels(); select.replaceChildren(); if (!models.length) { select.add(new Option(ollamaConnected ? 'No models installed' : 'Ollama unavailable · Settings', '')); return; } if (!choices.length) { select.add(new Option('No chat models installed', '')); return; } for (const model of choices) { const label = modelSelectorLabel(model); const option = new Option(`${label}  ·  ${model.source === 'api' ? 'API' : `${(model.size/1e9).toFixed(1)} GB`}`, model.name); option.title = label; select.add(option); } select.value = settings.selectedModel && choices.some(model => model.name === settings.selectedModel) ? settings.selectedModel : choices[0]!.name; select.title = modelSelectorLabel(choices.find(model => model.name === select.value) ?? choices[0]!); settings.selectedModel = select.value; }
async function refreshModelControls(){
 const select=$('context-window') as HTMLSelectElement, think=$('think') as HTMLInputElement, control=$('think-control'), level=$('think-level') as HTMLSelectElement;
 const info:Awaited<ReturnType<typeof window.orion.getModelInfo>>=await window.orion.getModelInfo(settings.selectedModel).catch(()=>({contextLength:131072,supportsThinking:false}));
 const max=Math.min(131072,Math.max(1024,info.contextLength)),values=[1024,2048,4096,8192,16384,32768,65536,131072].filter(n=>n<=max);
 if(!values.includes(settings.contextWindow)&&settings.contextWindow<=max)values.push(settings.contextWindow);values.sort((a,b)=>a-b);
 select.replaceChildren(...values.map(n=>new Option(`${Math.round(n/1024)}K`,String(n))));
 if(settings.contextWindow>max){settings.contextWindow=max;await window.orion.saveSettings(settings);}select.value=String(settings.contextWindow);$('context-meter').textContent=`— / ${Math.round(settings.contextWindow/1024)}K`;
 const modelChanged=thinkingModel!==settings.selectedModel;thinkingModel=settings.selectedModel;const supported=info.supportsThinking===true;think.disabled=!supported;control.title=supported?'Enable or disable model reasoning':'Thinking is unavailable for this model';
 if(!supported){think.checked=false;level.replaceChildren(new Option('Default','default'));level.hidden=true;return;}
 const modelValues=(info.thinkingValues??[]).filter((value):value is string=>typeof value==='string');
 const choices=['default',...['low','medium','high'].filter(value=>modelValues.includes(value))];
 const old=level.value||'default';level.replaceChildren(...choices.map(value=>new Option(value==='default'?'Default':value[0]!.toUpperCase()+value.slice(1),value)));
 level.value=choices.includes(old)?old:'default';if(modelChanged)think.checked=info.thinkingDefault!==false;
 const hasLevels=choices.length>1;level.hidden=!hasLevels||!think.checked;level.disabled=!think.checked;
}
async function refreshModels(refreshProviders = false) { const [available] = await Promise.all([window.orion.listModels().catch(() => []), window.orion.ollamaStatus().then(connected => { ollamaConnected = connected; }).catch(() => { ollamaConnected = false; })]); models = available; setModels(); await refreshModelControls(); $('connection-state').textContent = ($('model') as HTMLSelectElement).value.startsWith('api:') ? 'API provider' : ollamaConnected ? 'Connected' : 'Disconnected · Error'; if (activeView === 'Models' && (modelTab !== 'providers' || refreshProviders)) renderModelsView(); }
const gigabytes = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
async function refreshLlamaStatus() { try { $('llama-state').textContent = await window.orion.llamaStatus() ? 'Installed' : 'Not Installed'; } catch { $('llama-state').textContent = 'Unknown'; } }
async function refreshCreateEngineStatus() { try { createState = await window.orion.getCreateEngineState(); } catch (error) { createState = { installed:false,running:false,firstEntrySeen:true,phase:'error',detail:error instanceof Error?error.message:String(error),gpu:'Unknown' }; } }
let systemResourcesPending=false;
async function refreshSystemResources() { if(systemResourcesPending)return;systemResourcesPending=true;try { const info = await window.orion.getSystemInfo(); $('connection-state').textContent = ($('model') as HTMLSelectElement).value.startsWith('api:') ? 'API provider' : info.ollama ? 'Connected' : 'Disconnected · Error'; $('cpu-label').textContent=info.cpuUsagePercent===null?'—':`${info.cpuUsagePercent}%`; $('ram-label').textContent = `${gigabytes(info.usedRamMB)} / ${gigabytes(info.totalRamMB)}`; $('gpu-label').textContent=info.gpuUsagePercent===null?'—':`${info.gpuUsagePercent}%`; $('vram-label').textContent = info.totalVramMB > 0 ? `${info.usedVramMB === null ? '—' : gigabytes(info.usedVramMB)} / ${gigabytes(info.totalVramMB)}` : 'Not detected'; ($('gpu-label') as HTMLElement).title=info.gpuUsagePercent===null?'GPU utilization is not reported by this driver.':'Current overall GPU utilization'; ($('vram-label') as HTMLElement).title = info.totalVramMB > 0 && info.usedVramMB === null ? 'GPU memory capacity is available, but current usage is not reported by this driver.' : ''; } catch { $('connection-state').textContent = 'Disconnected · Error'; } finally{systemResourcesPending=false;} }
async function sendMessage() {
  if (!commandPalette.hidden) closeCommandPalette();
  const content = promptBox.value.trim(); if (!content || streaming) return;
  activeView = 'Chat'; updateActiveNav('Chat');
  if (!current) newConversation(); if (!current) return;
  await workspaceSettingsWrite;
  const target = current;
  if (!chatModels().length) { await refreshModels(); if (!chatModels().length) { showNotice(models.length ? 'No chat-capable Ollama model is installed. Install a completion model, then refresh the model list.' : 'Add an API provider in Model browser → Providers, or install a local model.', 'Ollama unavailable'); return; } }
  const imageRefs=[...attachments.flatMap(file=>file.attachment?[file.attachment]:[]),...(canvasReviewAttachment?[canvasReviewAttachment]:[])];canvasReviewAttachment=undefined;
  let userText = content + (attachments.length ? `\n\nAttached files:\n${attachments.map(f => `### ${f.name}${f.kind==='image'?' (image attached for visual analysis)':''}${f.content?`\n\n${f.content}`:''}`).join('\n\n')}` : '');
  const useWebSearch = webSearchMode;
  if (useWebSearch) { webSearchMode = false; const searchButton = $('search-open') as HTMLButtonElement; searchButton.setAttribute('aria-pressed', 'false'); searchButton.classList.remove('active'); searchButton.title = 'Search the web before Orion answers your next message'; }
  attachments = []; $('attachments').replaceChildren(); promptBox.value = '';
  const userMessage=createMessage('user', userText);if(imageRefs.length)userMessage.attachments=imageRefs;target.messages.push(userMessage); target.model = ($('model') as HTMLSelectElement).value;
  if (target.title === 'New conversation') target.title = content.slice(0, 48).replace(/\s+\S*$/, '') || content.slice(0, 48);
  target.messages.push(createMessage('assistant', '')); setComposerStreaming(true); $('send').textContent = '■'; $('send').setAttribute('title','Stop generation');
  const generationStarted = performance.now();
  let off: () => void = () => undefined;
  try {
  await save(target, true); if (current?.id === target.id) renderMessages(true);
  off = window.orion.onStream(e => {
    if (e.conversationId !== target.id) return;
    if(e.type==='canvas'&&e.canvas){showCanvas(e.canvas);return;}
    const assistant = target.messages.at(-1); if (!assistant) return;
    if (e.type === 'reasoning') generationStatus = 'Thinking…';
    else if (e.type === 'token' || e.type === 'replace') generationStatus = 'Writing response…';
    else if (e.type === 'tool' && e.tool) generationStatus = e.phase === 'finished' ? 'Continuing after tool…' : `Using ${e.tool.name.replaceAll('_', ' ')}…`;
    else if (e.type === 'web') generationStatus = e.web?.phase === 'complete' ? 'Reviewing search results…' : e.web?.phase === 'error' ? 'Continuing after search…' : 'Searching the web…';
    else if (e.type === 'done') generationStatus = 'Finishing response…';
    else if (e.type === 'error') generationStatus = 'Response stopped with an error';
    else if (e.type === 'cancelled') generationStatus = 'Response stopped';
    if (e.type === 'workspace' && e.workspaceReview && current?.id === target.id) renderWorkspaceReview(e.workspaceReview);
    if(e.type==='context'&&e.usedContextTokens!==undefined)$('context-meter').textContent=`${(e.usedContextTokens/1000).toFixed(1)}K / ${Math.round((e.maxContextTokens??settings.contextWindow)/1024)}K`;
    if (e.type === 'replace') assistant.content = e.content ?? '';
    if (e.type === 'token') assistant.content += e.content ?? '';
    if (e.type === 'done') {
      assistant.generationMs = performance.now() - generationStarted; if (e.tokensPerSecond !== undefined) assistant.tokensPerSecond = e.tokensPerSecond;
      const review=pendingCanvasReview;
      if(review&&target.id===review.document.conversationId){
        const updated=revisedCanvasText(assistant.content),binarySource=review.document.format==='pdf'||review.document.format==='image';
        canvasPrevious=review.edited||review.document.textContent||`Original ${review.document.format} file (${review.document.name})`;canvasPreviousNotes=review.notes;
        const revisedName=binarySource?`${review.document.name}.revised.md`:review.document.name,revisedPath=binarySource&&review.document.path?`${review.document.path}.revised.md`:review.document.path;
        canvasDocument={...review.document,name:revisedName,format:binarySource?'markdown':review.document.format,content:updated,textContent:undefined,attachment:undefined,path:revisedPath};canvasNotes=[];canvasMode='diff';pendingCanvasReview=null;renderCanvas();storeCanvasSession();
        if(review.document.source==='workspace'&&revisedPath)void window.orion.saveCanvasRevision(target.id,revisedPath,updated).then(()=>showNotice('The revised document is in the workspace review. Approve the review to apply it to your project folder.','Canvas revision ready')).catch(error=>showNotice(error instanceof Error?error.message:String(error),'Could not stage Canvas revision'));
      }
      void save(target);
    }
    if (e.type === 'reasoning') { assistant.reasoning = (assistant.reasoning ?? '') + (e.content ?? ''); if (!assistant.content) expandedThinking.add(assistant.id); }
    if (e.type === 'web' && e.web) {
      assistant.webResearch ??= { status: 'planning', steps: [] };
      let step = assistant.webResearch.steps.find(item => item.id === e.web!.stepId);
      if (!step) { step = { id: e.web.stepId, query: e.web.query ?? '', status: 'searching', sources: [] }; assistant.webResearch.steps.push(step); }
      if (e.web.query) { step.query = e.web.query.slice(0, 2000); }
      if (e.web.phase === 'planning') assistant.webResearch.status = 'planning';
      if (e.web.phase === 'searching') { step.status = 'searching'; assistant.webResearch.status = 'searching'; }
      if (e.web.phase === 'reading') { step.status = 'reading'; assistant.webResearch.status = 'reading'; }
      if (e.web.source) { const source=safeWebResearchSource(e.web.source); if(source){const existing=step.sources.find(item=>item.url===source.url);if(existing){existing.title=source.title;existing.url=source.url;existing.snippet=source.snippet;existing.status=source.status;}else step.sources.push(source);} }
      if (e.web.phase === 'complete') { step.status = 'complete'; assistant.webResearch.status = assistant.webResearch.steps.some(item => item.status === 'searching' || item.status === 'reading') ? 'reading' : 'complete'; }
      if (e.web.phase === 'error') { step.status = 'error'; step.error = e.web.error?.slice(0, 2000); assistant.webResearch.status = 'error'; }
      scheduleSave(target); if (current?.id === target.id) scheduleRender(true);
    }
    if (e.type === 'token' || e.type === 'replace' || e.type === 'reasoning') scheduleSave(target);
    if (e.type === 'tool' && e.tool) {
      assistant.toolCalls ??= []; let entry = assistant.toolCalls.find(x => x.id === e.tool!.id);
      if (!entry) { entry = { id: e.tool.id, name: e.tool.name, description: e.tool.description, input: e.tool.input, status: 'pending' }; assistant.toolCalls.push(entry); }
      entry.name = e.tool.name; entry.description = e.tool.description; entry.input = e.tool.input ?? entry.input;
      if (e.phase === 'started') entry.status = e.tool.requiresApproval ? 'pending' : 'running';
      if (e.phase === 'updated') entry.status = 'running';
      if (e.phase === 'updated' && e.result?.output !== undefined) entry.output = e.result.output;
      if (e.phase === 'finished') { entry.status = e.result?.success ? 'completed' : e.result?.output === 'Approval declined by the user.' ? 'denied' : 'error'; entry.output = e.result?.output; entry.imagePath=e.result?.imagePath; entry.mediaType=e.result?.mediaType; if(e.result?.imagePath)void refreshGeneratedGallery(); void save(target); }
      else scheduleSave(target);
      if (current?.id === target.id) scheduleRender(true);

    }
    if (e.type === 'error') assistant.content += `\n\n> **Orion error:** ${e.content}`;
    if (e.type === 'cancelled' && !assistant.content) assistant.content = '_Generation stopped._';
    if (current?.id === target.id) scheduleRender();
  });
  const result = await window.orion.streamChat({ conversationId: target.id, model: target.model, messages: target.messages.slice(0, -1), think: ($('think') as HTMLInputElement).checked, thinkLevel: ($('think-level') as HTMLSelectElement).value, agent: true, mode: chatMode, webSearch: useWebSearch });
  const completedAssistant = target.messages.at(-1); if (completedAssistant) { completedAssistant.generationMs = performance.now() - generationStarted; if (result.tokensPerSecond !== undefined) completedAssistant.tokensPerSecond = result.tokensPerSecond; }
  } catch (e) {
    const assistant = target.messages.at(-1);
    if (assistant && !assistant.content) assistant.content = `Orion error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    off(); const timer = persistTimers.get(target.id); if (timer) clearTimeout(timer); persistTimers.delete(target.id);
    setComposerStreaming(false); $('send').textContent = '↑'; $('send').setAttribute('title','Send');
    try { await save(target, true); } catch (error) { console.error('Could not save conversation:', error); }
    if (current?.id === target.id) { renderMessages(); }
    const next = waitingScheduledJobs.shift(); if (next) void runScheduledJob(next);
  }
}

$('send').addEventListener('click', () => { if (streaming) void window.orion.cancelStream(); else void sendMessage(); });
// Orion is intentionally conversation-first: there is no Chat/Code mode switch.
promptBox.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }); $('command-close').onclick = closeCommandPalette; $('new-chat').onclick = newConversation;
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') { event.preventDefault(); event.stopPropagation(); void openCommandPalette(); return; }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target === promptBox && !promptBox.value.trim()) { event.preventDefault(); event.stopPropagation(); void openCommandPalette(); return; }
  if (event.key === 'Escape' && !commandPalette.hidden) { event.preventDefault(); closeCommandPalette(); }
}, true);
const rollbackDialog=$('git-rollback-dialog') as HTMLDialogElement;
document.addEventListener('pointerdown',event=>{if(!commandPalette.hidden&&!commandPalette.contains(event.target as Node))closeCommandPalette();});
($('git-rollback-confirm') as HTMLButtonElement).onclick=async()=>{const checkpoint=rollbackDialog.dataset.checkpointId;if(!checkpoint)return;const button=$('git-rollback-confirm') as HTMLButtonElement;button.disabled=true;try{await window.orion.rollbackGitCheckpoint(checkpoint);rollbackDialog.close();await refreshCommandPalette();showNotice('The project was restored to the selected Git checkpoint.','Rollback complete');}catch(error){showNotice(error instanceof Error?error.message:String(error),'Rollback failed');}finally{button.disabled=false;}};
$('context-window').addEventListener('change',async()=>{settings.contextWindow=Number(($('context-window') as HTMLSelectElement).value);await window.orion.saveSettings(settings);$('context-meter').textContent=`— / ${Math.round(settings.contextWindow/1024)}K`;});
const sidebar = $('sidebar');
const sidebarHoverTrigger = $('sidebar-hover-trigger');
let sidebarPeekTimer: ReturnType<typeof setTimeout> | undefined;
const cancelSidebarPeekHide = () => { if (sidebarPeekTimer) clearTimeout(sidebarPeekTimer); sidebarPeekTimer = undefined; };
const openSidebarPeek = () => { cancelSidebarPeekHide(); document.body.classList.add('sidebar-peek-open'); };
const scheduleSidebarPeekHide = () => {
  cancelSidebarPeekHide();
  sidebarPeekTimer = setTimeout(() => {
    if (!sidebar.matches(':hover') && !sidebarHoverTrigger.matches(':hover')) document.body.classList.remove('sidebar-peek-open');
    sidebarPeekTimer = undefined;
  }, 240);
};
sidebarHoverTrigger.addEventListener('pointerenter', openSidebarPeek);
sidebarHoverTrigger.addEventListener('pointerleave', scheduleSidebarPeekHide);
sidebar.addEventListener('pointerenter', cancelSidebarPeekHide);
sidebar.addEventListener('pointerleave', scheduleSidebarPeekHide);
$('collapse').onclick = () => { cancelSidebarPeekHide(); document.body.classList.remove('sidebar-peek-open'); document.body.classList.add('sidebar-collapsed'); ($('collapse') as HTMLButtonElement).blur(); };
$('expand').onclick = () => { cancelSidebarPeekHide(); document.body.classList.remove('sidebar-peek-open', 'sidebar-collapsed'); };
for (const [id, action] of [['win-minimize', 'minimize'], ['win-maximize', 'toggle-maximize'], ['win-close', 'close']] as const) $(id).addEventListener('click', () => { void window.orion.windowAction(action); });
$('model').addEventListener('change', async () => { settings.selectedModel = ($('model') as HTMLSelectElement).value; const selected = chatModels().find(model => model.name === settings.selectedModel); ($('model') as HTMLSelectElement).title = selected ? modelSelectorLabel(selected) : settings.selectedModel; await window.orion.saveSettings(settings); await refreshModelControls(); if (activeView === 'Models') renderModelsView(); });
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => button.onclick = async () => {
  const view = button.dataset.view;
  if (view === 'Schedules') { if(activeView==='Create')clearCreatePageSession(); activeView = 'Chat'; updateActiveNav('Schedules'); renderMessages(true); await openSchedules(); return; }
  if (view !== 'Chat' && view !== 'Models' && view !== 'Create') return;
  if(activeView==='Create'&&view!=='Create')clearCreatePageSession();
  if (view === 'Models') { modelTab='conversational';creativeCategory='image';modelQuery='';hubModels=popularHubCache.get('conversational')??[];popularHubError='';activeHubRepo='';activeHubFiles=[]; }
  activeView = view; updateActiveNav(view); renderMessages(true);
  if (view === 'Models') { installedModels=await window.orion.listInstalledModels(); await refreshModels(); void loadPopularHubModels('conversational'); }
  if (view === 'Create') { try { const entered=await window.orion.enterCreate(); createState=entered.state; installedModels=await window.orion.listInstalledModels(); await refreshGeneratedGallery(); renderMessages(true); if(entered.showInstallPrompt) ($('engine-install-dialog') as HTMLDialogElement).showModal(); } catch(error) { createState={installed:false,running:false,firstEntrySeen:true,phase:'error',detail:error instanceof Error?error.message:String(error),gpu:'Unknown'};renderCreateView(); } }
});
  $('canvas-open').onclick=()=>toggleCanvas();
    const canvasBody=$('canvas-body');canvasBody.addEventListener('dragover',event=>{event.preventDefault();canvasBody.classList.add('canvas-drop-active');});canvasBody.addEventListener('dragleave',()=>canvasBody.classList.remove('canvas-drop-active'));canvasBody.addEventListener('drop',async event=>{event.preventDefault();canvasBody.classList.remove('canvas-drop-active');const file=(event as DragEvent).dataTransfer?.files[0];if(!file)return;const filePath=window.orion.getPathForFile(file);if(!filePath)return;try{showCanvas(await window.orion.openCanvasPath(filePath));}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not open dropped file');}});
  $('canvas-code').onclick=()=>{canvasMode='source';renderCanvas();};$('canvas-preview').onclick=()=>{canvasMode='preview';renderCanvas();};
  $('canvas-copy').onclick=async()=>{if(!canvasDocument)return;try{await navigator.clipboard.writeText(canvasDocument.format==='pdf'?'PDF files cannot be copied as text.':canvasDocument.content);showNotice('Canvas content copied.','Copied');}catch(error){showNotice(error instanceof Error?error.message:String(error),'Could not copy');}};
  $('canvas-download').onclick=()=>{if(!canvasDocument)return;const doc=canvasDocument,blob=new Blob([doc.format==='pdf'?Uint8Array.from(atob(doc.content),c=>c.charCodeAt(0)):doc.content],{type:doc.format==='pdf'?'application/pdf':doc.format==='html'?'text/html;charset=utf-8':doc.format==='markdown'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'});const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=doc.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);};
  $('canvas-editor').addEventListener('input',()=>{if(canvasDocument){canvasDocument.content=($('canvas-editor') as HTMLTextAreaElement).value;storeCanvasSession();}});
  $('canvas-comment').onclick=()=>{if(!canvasDocument)return;const input=$('canvas-note') as HTMLInputElement,text=input.value.trim();if(!text){showNotice('Write a short comment first.','Add a comment');return;}const editor=$('canvas-editor') as HTMLTextAreaElement,quote=editor.hidden?'':editor.value.slice(editor.selectionStart,editor.selectionEnd);canvasNotes.push({kind:'comment',quote,text});input.value='';renderCanvas();storeCanvasSession();};
  $('canvas-remove').onclick=()=>{if(!canvasDocument)return;const editor=$('canvas-editor') as HTMLTextAreaElement,quote=editor.hidden?'':editor.value.slice(editor.selectionStart,editor.selectionEnd),input=$('canvas-note') as HTMLInputElement,text=input.value.trim();if(!quote&&!text){showNotice('Select the text you want removed, or describe what should be removed in the comment field.','Choose text to remove');return;}canvasNotes.push({kind:'remove',quote,text:text||'Please remove this part.'});input.value='';renderCanvas();storeCanvasSession();};
  $('canvas-give').onclick=async()=>{if(!canvasDocument||streaming)return;const doc={...canvasDocument},notes=[...canvasNotes],edited=doc.format==='pdf'||doc.format==='image'?(doc.textContent??''):($('canvas-editor') as HTMLTextAreaElement).value;pendingCanvasReview={document:doc,notes,edited};canvasReviewAttachment=doc.attachment;const notesText=notes.length?notes.map((note,index)=>`${index+1}. ${note.kind==='remove'?'REMOVE':'COMMENT'}${note.quote?` on this exact text: “${note.quote}”`:''}: ${note.text}`).join('\n'):'No inline comments.';promptBox.value=`Revise the attached document using my edits and notes. Return the complete revised document source only, without an outer code fence or explanation. Preserve the document's purpose and structure.\n\nFile: ${doc.name}\nFormat: ${doc.format}\n\nMy inline notes:\n${notesText}\n\nCurrent edited document source:\n${edited.slice(0,1_500_000)}`;await sendMessage();};
  $('think').addEventListener('change',()=>{const level=$('think-level') as HTMLSelectElement;const enabled=($('think') as HTMLInputElement).checked;level.hidden=!enabled||level.options.length<2;level.disabled=!enabled;});
  $('attach').onclick = async () => {
    try {
      attachments = await window.orion.selectFiles();
      const container = $('attachments');
      container.replaceChildren(...attachments.map(file => { const item = document.createElement('span'); item.className = 'attachment'; item.textContent = `${file.kind==='image'?'▧ ':''}${file.name}`; item.title = file.kind==='image'?'Image will be sent to models that support visual input.':`${file.mimeType} · ${file.path}`; return item; }));
    } catch (error) { showNotice(error instanceof Error ? error.message : String(error), 'Could not attach files'); }
  };
let memoryInspectorRequest = 0;
let memoryInspectorOffset = 0;
function createMemoryInspector() {
  const panel = document.createElement('div'); panel.id = 'memory-inspector'; panel.className = 'memory-inspector';
  const heading = document.createElement('h4'); heading.textContent = 'Saved memory';
  const status = document.createElement('p'); status.id = 'memory-inspector-status'; status.className = 'muted';
  const stats = document.createElement('dl'); stats.id = 'memory-inspector-stats'; stats.className = 'memory-inspector-stats';
  const items = document.createElement('div'); items.id = 'memory-inspector-items';
  const actions = document.createElement('div'); actions.className = 'memory-inspector-actions';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'secondary'; refresh.textContent = 'Refresh'; refresh.onclick = () => { memoryInspectorOffset = 0; void refreshMemoryInspector(); };
  const more = document.createElement('button'); more.id = 'memory-inspector-more'; more.type = 'button'; more.className = 'secondary'; more.textContent = 'Next 50'; more.hidden = true; more.onclick = () => { memoryInspectorOffset += 50; void refreshMemoryInspector(); };
  actions.append(refresh, more); panel.append(heading, status, stats, items, actions); return panel;
}
async function refreshMemoryInspector() {
  const request = ++memoryInspectorRequest;
  const status = $('memory-inspector-status'), list = $('memory-inspector-items'), grid = $('memory-inspector-stats'), more = $('memory-inspector-more');
  status.textContent = 'Loading local memory…'; more.hidden = true;
  try {
    const stats = await window.orion.memoryStats();
    const page = await window.orion.listOFSMemories(memoryInspectorOffset);
    if (request !== memoryInspectorRequest) return;
    $('rebuild-memory').textContent = 'Rebuild OrionFS memory';
    grid.replaceChildren(); list.replaceChildren();
    const values = [['Engine', 'OrionFS · model-free'], ['Memories', String(stats.activeMemories ?? 0)], ['Association links', String(stats.links ?? 0)], ['Local storage', `${((stats.databaseBytes ?? 0) / 1048576).toFixed(2)} MB`]];
    for (const [label, value] of values) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label!; detail.textContent = value!; grid.append(term, detail); }
    status.textContent = page.total ? `${memoryInspectorOffset + 1}–${memoryInspectorOffset + page.items.length} of ${page.total} saved memories. Statements retain their original speaker and conversation.` : 'No OFS memories saved yet. Conversation statements are captured locally as you chat.';
    if (stats.rebuilding) status.textContent += ' Indexing is in progress; refresh to see new entries.';
    for (const memory of page?.items ?? []) {
      const item = document.createElement('article'); item.className = 'memory-inspector-entry';
      const text = document.createElement('p'); text.textContent = memory.content;
      const meta = document.createElement('small'); const conversation = conversations.find(value => value.id === memory.conversationId);
      meta.textContent = `${conversation?.title ?? 'Saved conversation'} · ${new Date(memory.createdAt).toLocaleString()} · ${memory.type.replaceAll('_', ' ')}`;
      item.append(text, meta); list.append(item);
    }
    more.hidden = memoryInspectorOffset + page.items.length >= page.total;
  } catch (error) { if (request === memoryInspectorRequest) status.textContent = `Could not load memory: ${error instanceof Error ? error.message : String(error)}`; }
}
function organizeSettingsPanel() {
  const form = $('settings-form');
  if (form.dataset.organized) return;
  ensureStartupPreferenceControl();
  const inspector = createMemoryInspector();
  const title = form.querySelector('.dialog-title');
  const error = $('settings-error');
  const actions = form.querySelector('.dialog-actions');
  const all = [...form.children].filter(node => node !== title && node !== error && node !== actions) as HTMLElement[];
  const findField = (id: string) => all.find(node => node.querySelector(`#${id}`));
  const byId = (id: string) => findField(id);
  const memory = all.find(node => node.classList.contains('memory-controls'));
  const semantic = all.find(node => node.matches('.muted') && node.textContent?.startsWith('Semantic recall'));
  const workspace = all.find(node => node.querySelector('#workspace-path'));
  const ofsToggle = all.find(node => node.querySelector('#experimental-ofs-memory'));
  if (workspace) workspace.hidden = true;
  if (ofsToggle) ofsToggle.hidden = true;
  if (semantic) semantic.hidden = true;
  const embeddingButton = form.querySelector<HTMLButtonElement>('#install-memory-embedding');
  if (embeddingButton) embeddingButton.hidden = true;
  const privacy = all.find(node => node.matches('.muted') && node.textContent?.startsWith('Chat prompts'));
  const ofsDescription = all.find(node => node.matches('.muted') && node.textContent?.startsWith('OrionFS stores memories locally'));
  const subagentHelp = all.find(node => node.matches('.muted') && node.textContent?.startsWith('The first subagent'));
  const systemPrompt = all.find(node => node.matches('#settings-system-prompt') || node.querySelector('#settings-system-prompt'));
  const groups: Array<{ name: string; ids: string[]; extras: HTMLElement[]; description: string }> = [
    { name: 'Appearance', ids: ['theme'], extras: [], description: 'Choose the color theme used throughout Orion.' },
    { name: 'Model', ids: ['ollama-url', 'context-size', 'temperature', 'subagent-max-parallel'], extras: subagentHelp ? [subagentHelp] : [], description: 'Set the local model endpoint and response defaults.' },
    { name: 'Memory & privacy', ids: ['inter-conversation-memory'], extras: [inspector, memory, ofsDescription, privacy].filter(Boolean) as HTMLElement[], description: 'Review OrionFS memories and manage local conversation privacy.' },
    { name: 'Startup', ids: ['keep-in-tray', 'start-new-conversation'], extras: [], description: 'Choose what Orion does when its window closes or opens.' },
    { name: 'System prompt', ids: [], extras: systemPrompt ? [systemPrompt] : [], description: 'Current instructions sent to the selected model.' }
  ];
  const layout = document.createElement('div'); layout.className = 'settings-layout';
  const nav = document.createElement('nav'); nav.className = 'settings-nav'; nav.setAttribute('aria-label', 'Settings sections');
  const content = document.createElement('div'); content.className = 'settings-content';
  layout.append(nav, content);
  if (title) form.insertBefore(title, form.firstChild);
  form.insertBefore(layout, actions ?? null);
  if (error) form.insertBefore(error, layout);
  groups.forEach((group, index) => {
    const section = document.createElement('section'); section.className = `settings-section${index === 0 ? ' active' : ''}`; section.hidden = index !== 0;
    const heading = document.createElement('h3'); heading.textContent = group.name;
    const description = document.createElement('p'); description.className = 'muted'; description.textContent = group.description;
    section.append(heading, description);
    for (const id of group.ids) { const field = byId(id); if (field) section.append(field); }
    for (const extra of group.extras) section.append(extra);
    const button = document.createElement('button'); button.type = 'button'; button.className = `settings-nav-item${index === 0 ? ' active' : ''}`; button.textContent = group.name; button.setAttribute('aria-current', index === 0 ? 'page' : 'false');
    button.onclick = () => { nav.querySelectorAll('.settings-nav-item').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-current', 'false'); }); content.querySelectorAll('.settings-section').forEach(item => { item.classList.remove('active'); (item as HTMLElement).hidden = true; }); button.classList.add('active'); button.setAttribute('aria-current', 'page'); section.hidden = false; section.classList.add('active'); if (group.name === 'System prompt') void loadSettingsSystemPrompt(); if (group.name === 'Memory & privacy') { memoryInspectorOffset = 0; void refreshMemoryInspector(); } };
    nav.append(button); content.append(section);
  });
  if (actions) form.append(actions);
  form.dataset.organized = 'true';
}
const settingsDialog = $('settings-dialog') as HTMLDialogElement;
async function loadSettingsSystemPrompt() {
  const output = $('settings-system-prompt-content');
  output.textContent = 'Loading the current system prompt…';
  try { output.textContent = await window.orion.getSystemPrompt(($('model') as HTMLSelectElement).value, chatMode); }
  catch (error) { output.textContent = `Could not load the system prompt: ${error instanceof Error ? error.message : String(error)}`; }
}
$('settings-open').addEventListener('click', async () => { const button = $('settings-open') as HTMLButtonElement; if (button.disabled || settingsDialog.open) return; button.disabled = true; try { ensureStartupPreferenceControl(); organizeSettingsPanel(); settings = await window.orion.settings(); ($('theme') as HTMLSelectElement).value = settings.theme; await refreshStorageWarning(); ($('ollama-url') as HTMLInputElement).value = settings.ollamaUrl; ($('context-size') as HTMLInputElement).value = String(settings.contextWindow); ($('temperature') as HTMLInputElement).value = String(settings.temperature); ($('workspace-path') as HTMLInputElement).value = settings.workspacePath || ''; ($('keep-in-tray') as HTMLInputElement).checked = settings.keepInTray; ($('inter-conversation-memory') as HTMLInputElement).checked = settings.interConversationMemory; ($('experimental-ofs-memory') as HTMLInputElement).checked = settings.experimentalOfsMemory; ($('subagent-max-parallel') as HTMLSelectElement).value = String(settings.subagentMaxParallel); ($('start-new-conversation') as HTMLInputElement).checked = settings.startNewConversation;  settingsDialog.showModal(); if (document.querySelector(".settings-nav-item[aria-current=page]")?.textContent === "Memory & privacy") void refreshMemoryInspector(); if (document.querySelector(".settings-nav-item[aria-current=\"page\"]")?.textContent === "System prompt") void loadSettingsSystemPrompt(); } catch (cause) { showNotice(cause instanceof Error ? cause.message : String(cause), 'Could not open settings'); } finally { button.disabled = false; } });
($('theme') as HTMLSelectElement).onchange = event => applyTheme((event.currentTarget as HTMLSelectElement).value as AppSettings['theme']);
settingsDialog.addEventListener('close', () => applyTheme(settings.theme));
$('workspace-browse').onclick = async () => { const selected = await window.orion.selectWorkspace(); if (selected) ($('workspace-path') as HTMLInputElement).value = selected; };
$('rebuild-memory').onclick = () => { $('memory-progress').textContent = 'Re-indexing saved conversations…'; void window.orion.rebuildMemory(); };
const embeddingButton = $('install-memory-embedding') as HTMLButtonElement;
embeddingButton.onclick = async () => { embeddingButton.disabled = true; $('memory-progress').textContent = 'Preparing semantic memory…'; try { await window.orion.installMemoryEmbedding(); await refreshModels(); } catch (cause) { $('memory-progress').textContent = `Semantic memory failed: ${cause instanceof Error ? cause.message : String(cause)}`; } finally { embeddingButton.disabled = false; void renderMemoryUsage(); } };
window.orion.onMemoryProgress(progress => { $('memory-progress').textContent = progress.error ? `Memory re-index failed: ${progress.error}` : progress.status ?? (progress.completed >= progress.total ? `Memory index ready · ${progress.total} conversations indexed.` : `Indexing conversations · ${progress.completed} / ${progress.total}`); void renderMemoryUsage(); });
$('settings-close').addEventListener('click', () => settingsDialog.close());
$('settings-cancel').addEventListener('click', () => settingsDialog.close());
$('settings-form').addEventListener('submit', async e => { e.preventDefault(); const error = $('settings-error'); error.hidden = true; try { settings.ollamaUrl = ($('ollama-url') as HTMLInputElement).value.trim().replace(/\/$/, ''); settings.contextWindow = Math.min(131072, Math.max(1024, Number(($('context-size') as HTMLInputElement).value))); settings.temperature = Math.min(2, Math.max(0, Number(($('temperature') as HTMLInputElement).value))); settings.theme = ($('theme') as HTMLSelectElement).value as AppSettings['theme']; settings.workspacePath = ''; if (current) current.workspacePath = undefined; settings.keepInTray = ($('keep-in-tray') as HTMLInputElement).checked; settings.interConversationMemory = ($('inter-conversation-memory') as HTMLInputElement).checked; settings.experimentalOfsMemory = true; settings.startNewConversation = ($('start-new-conversation') as HTMLInputElement).checked; settings.subagentMaxParallel = Number(($('subagent-max-parallel') as HTMLSelectElement).value) as 0|1|2; await window.orion.saveSettings(settings); if (current) await window.orion.saveConversation(current, false); updateChatModeUi(); applyTheme(settings.theme); settingsDialog.close(); await refreshModels(); void renderMemoryUsage(); } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; } });
const searchButton = $('search-open') as HTMLButtonElement;
searchButton.onclick = () => { webSearchMode = !webSearchMode; searchButton.setAttribute('aria-pressed', String(webSearchMode)); searchButton.classList.toggle('active', webSearchMode); searchButton.title = webSearchMode ? 'Web search is on · Orion will research before answering' : 'Search the web before Orion answers your next message'; promptBox.focus(); };
window.orion.onDownloadProgress(progress=>{downloadProgress.set(progress.id,progress);renderDownloadActivity();if(progress.repo==='Orion llama.cpp'&&progress.phase!=='downloading')window.setTimeout(()=>void refreshLlamaStatus(),2500);if(progress.phase!=='downloading')window.setTimeout(()=>{downloadProgress.delete(progress.id);renderDownloadActivity();},progress.phase==='complete'?6000:progress.phase==='cancelled'?3500:12000);});
const invokeDialog=$('engine-install-dialog') as HTMLDialogElement;
async function startEngineInstall() {
  if(engineInstallPending)return;
  engineInstallPending=true;engineProgressId='';createState={installed:false,running:false,firstEntrySeen:true,phase:'installing',detail:'Preparing the managed native image/video engine runtime…',gpu:createState?.gpu??'Detecting'};
  const button=$('engine-install') as HTMLButtonElement;button.disabled=true;
  if(invokeDialog.open)invokeDialog.close();
  renderCreateView();
  try{createState=await window.orion.installCreateEngine();installedModels=await window.orion.listInstalledModels();}
  catch(error){createState={installed:false,running:false,firstEntrySeen:true,phase:'error',detail:error instanceof Error?error.message:String(error),gpu:createState.gpu};showNotice(createState.detail,'native image/video engine setup failed');}
  finally{engineInstallPending=false;button.disabled=false;renderCreateView();}
}
$('engine-install').addEventListener('click',()=>void startEngineInstall());
function patchLiveGenerationCall(call: ToolCallRecord) {
  const card=[...chatBox.querySelectorAll<HTMLElement>('.tool-call[data-tool-call-id]')].find(item=>item.dataset.toolCallId===call.id);if(!card)return;
  const status=card.querySelector<HTMLElement>('.tool-status');if(status){status.textContent=call.status;status.className=`tool-status ${call.status}`;}
  const visual=card.querySelector<HTMLElement>('.tool-generation-stage');let percent=card.querySelector<HTMLElement>('.tool-generation-percent');
  if(visual&&!percent){visual.replaceChildren(generationDotField());percent=document.createElement('span');percent.className='tool-generation-percent';visual.append(percent);}
  if(percent)percent.textContent=`${Math.max(0,Math.min(99,call.progress??0))}%`;
  let detail=card.querySelector<HTMLElement>('.tool-generation-detail');if(!detail){detail=document.createElement('div');detail.className='tool-generation-detail';card.append(detail);}detail.textContent=call.progressDetail??'Generating locally…';
}
window.orion.onCreateProgress(progress=>{
  const isCreatePageJob=createPageGenerationIds.has(progress.id);
  if(isCreatePageJob||engineInstallPending)createProgress.set(progress.id,progress);
  if(engineInstallPending)engineProgressId=progress.id;
  if(progress.phase==='error')$('engine-install-status').textContent=progress.error??progress.detail;else if(invokeDialog.open&&progress.detail)$('engine-install-status').textContent=progress.detail;
  if(engineInstallPending&&activeView==='Create')renderCreateView();
  if(isCreatePageJob&&activeView==='Create'){
    if(progress.phase==='complete'||progress.phase==='error')renderCreateView();
    else {const card=chatBox.querySelector<HTMLElement>(`[data-generation="${CSS.escape(progress.id)}"]`);const percent=card?.querySelector<HTMLElement>('.generation-percent');if(percent)percent.textContent=`${Math.max(0,Math.min(99,progress.percent??0))}%`;else renderCreateView();}
  }
  if(engineInstallPending&&progress.phase==='complete')window.setTimeout(()=>{createProgress.delete(progress.id);if(activeView==='Create')renderCreateView();},10000);
  if(current)for(const message of current.messages){const call=message.toolCalls?.find(item=>item.id===progress.id);if(!call)continue;call.progress=progress.percent;call.progressDetail=progress.detail;if(progress.phase==='error'){call.status='error';call.output=progress.error??progress.detail;}else if(progress.phase==='complete'){call.status='completed';call.imagePath=progress.imagePath;call.mediaType=progress.mediaType;}else{call.status='running';patchLiveGenerationCall(call);}if(progress.phase==='error'||progress.phase==='complete'){renderMessages();void save(current);}}
});
const llamaIntroDialog=$('llama-intro-dialog') as HTMLDialogElement;
llamaIntroDialog.addEventListener('close',()=>{void window.orion.dismissLlamaIntro();});
$('llama-intro-later').addEventListener('click',()=>{void window.orion.dismissLlamaIntro();});
$('llama-intro-install').addEventListener('click',async()=>{llamaIntroDialog.close();try{await window.orion.installLlama();await refreshLlamaStatus();showNotice('The managed llama.cpp runtime is ready. Download a GGUF model from Models to get started.','Setup complete');}catch(error){await refreshLlamaStatus();showNotice(error instanceof Error?error.message:String(error),'llama.cpp setup failed');}});
chatBox.addEventListener('click', async e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]'); if (b) { await navigator.clipboard.writeText(decodeURIComponent(b.dataset.copy ?? '')); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1300); } });
const pendingApprovals = new Map<string, ToolRequest>();
const approvalStrip = $('tool-approval');
const composerWrap = document.querySelector<HTMLElement>('.composer-wrap');
if (composerWrap && approvalStrip.parentElement !== composerWrap) composerWrap.insertBefore(approvalStrip, composerWrap.firstChild);
const approvalChoice = document.createElement('select');
approvalChoice.id = 'tool-approval-choice'; approvalChoice.setAttribute('aria-label', 'Choose how to handle this tool request'); approvalChoice.title = 'Choose how to handle this tool request';
approvalChoice.add(new Option('Choose action…', ''));
approvalChoice.add(new Option('Allow Once', 'allow-once'));
approvalChoice.add(new Option('Allow Always', 'allow-always'));
approvalChoice.add(new Option('Decline', 'decline'));
approvalStrip.querySelector('.tool-approval-actions')?.replaceChildren(approvalChoice);
let activeApprovalId: string | null = null;
function approvalPreview(tool: ToolRequest) {
  const input = tool.input ?? {};
  const value = input.question ?? input.command ?? input.path ?? input.url ?? input.query ?? input.title;
  return value === undefined ? tool.description : String(value).replace(/\s+/g, ' ').slice(0, 180);
}
function renderApprovalStrip() {
  const first = pendingApprovals.entries().next().value as [string, ToolRequest] | undefined;
  if (!first) { activeApprovalId = null; approvalStrip.hidden = true; return; }
  const [id, tool] = first; activeApprovalId = id; approvalStrip.hidden = false;
  $('tool-approval-title').textContent = 'Allow ' + tool.name.replaceAll('_', ' ') + '?';
  $('tool-approval-summary').textContent = approvalPreview(tool);
  $('tool-approval-input').textContent = JSON.stringify({ description: tool.description, ...tool.input }, null, 2);
  approvalChoice.disabled = false; approvalChoice.value = '';
}
async function decideToolApproval(decision: 'allow-once'|'allow-always'|'decline') {
  const requestId = activeApprovalId; if (!requestId || !pendingApprovals.has(requestId)) return;
  approvalChoice.disabled = true;
  try { const accepted = await window.orion.respondToTool(requestId, decision); if (!accepted) throw new Error('This tool request is no longer active.'); pendingApprovals.delete(requestId); renderApprovalStrip(); }
  catch (error) { approvalChoice.disabled = false; approvalChoice.value = ''; $('tool-approval-title').textContent = 'Could not save this choice'; $('tool-approval-summary').textContent = error instanceof Error ? error.message : String(error); }
}
approvalChoice.addEventListener('change', () => { const decision = approvalChoice.value; if (decision === 'allow-once' || decision === 'allow-always' || decision === 'decline') void decideToolApproval(decision); });
$('tool-approval-details').addEventListener('toggle', () => approvalStrip.classList.toggle('details-open', ($('tool-approval-details') as HTMLDetailsElement).open));
window.orion.onToolRequest(tool => { if (!tool.requiresApproval) { void window.orion.respondToTool(tool.id, 'allow-once'); return; } pendingApprovals.set(tool.id, tool); renderApprovalStrip(); });
let activeUserQuestion: UserQuestionRequest | null = null;
const userQuestionStrip = $('user-question');
let activeQuestionIndex = 0;
const userQuestionList = $('user-question-list');
const userQuestionSelections: Array<number | 'custom' | null> = [];
const userQuestionAnswers: string[] = [];
function renderUserQuestion() {
  const active = activeUserQuestion; if (!active) return;
  $('user-question-title').textContent = active.questions.length > 1 ? 'Orion has a few questions' : 'Orion needs your input';
  $('user-question-progress').textContent = active.questions.length > 1 ? `${activeQuestionIndex + 1}/${active.questions.length}` : '';
  userQuestionList.replaceChildren();
  active.questions.forEach((item, questionIndex) => {
    const card = document.createElement('article'); card.className = 'user-question-card'; card.dataset.questionIndex = String(questionIndex);
    const prompt = document.createElement('div'); prompt.className = 'user-question-prompt'; prompt.textContent = item.question; card.append(prompt);
    const options = document.createElement('div'); options.className = 'user-question-options'; options.setAttribute('role', 'group'); options.setAttribute('aria-label', `Answer choices for question ${questionIndex + 1}`);
    for (const [optionIndex, option] of item.options.slice(0, 3).entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'question-option';
      const number = document.createElement('span'); number.className = 'question-choice-number'; number.textContent = String(optionIndex + 1);
      const label = document.createElement('span'); label.className = 'question-choice-label'; label.textContent = option;
      button.append(number, label); button.setAttribute('aria-pressed', String(userQuestionSelections[questionIndex] === optionIndex));
      button.addEventListener('click', () => {
        userQuestionSelections[questionIndex] = optionIndex;
        card.querySelectorAll('.question-option[aria-pressed="true"]').forEach(selected => selected.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        input.value = ''; custom.classList.remove('is-selected');
      });
      options.append(button);
    }
    card.append(options);
    const custom = document.createElement('label'); custom.className = 'question-option question-custom-option';
    custom.classList.toggle('is-selected', userQuestionSelections[questionIndex] === 'custom');
    const customNumber = document.createElement('span'); customNumber.className = 'question-choice-number'; customNumber.textContent = String(Math.min(item.options.length, 3) + 1); customNumber.hidden = item.options.length === 0;
    const input = document.createElement('input'); input.className = 'user-question-answer'; input.maxLength = 900; input.placeholder = item.options.length ? 'Tell the AI something else…' : 'Type your answer…'; input.setAttribute('aria-label', `Your own answer for question ${questionIndex + 1}`); input.value = userQuestionSelections[questionIndex] === 'custom' ? userQuestionAnswers[questionIndex] ?? '' : '';
    custom.append(customNumber, input); card.append(custom);
    input.addEventListener('focus', () => {
      userQuestionSelections[questionIndex] = 'custom';
      options.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
      custom.classList.add('is-selected');
    });
    input.addEventListener('input', () => {
      userQuestionSelections[questionIndex] = 'custom';
      options.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
      custom.classList.add('is-selected');
    });
    custom.addEventListener('click', event => { if (event.target !== input) input.focus(); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitUserQuestion(questionIndex); } });
    const actions = document.createElement('div'); actions.className = 'user-question-actions';
    const hint = document.createElement('span'); hint.className = 'user-question-hint'; hint.textContent = questionIndex < activeQuestionIndex ? 'Answer saved' : item.options.length ? 'Choose one answer to continue' : 'Enter an answer to continue';
    const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'primary user-question-submit'; submit.textContent = questionIndex === active.questions.length - 1 ? 'Send answers' : 'Submit and continue';
    submit.addEventListener('click', () => submitUserQuestion(questionIndex));
    actions.append(hint, submit); card.append(actions); userQuestionList.append(card);
  });
  setActiveQuestion(activeQuestionIndex);
}
function setActiveQuestion(index: number) {
  const active = activeUserQuestion; if (!active) return;
  activeQuestionIndex = index;
  $('user-question-progress').textContent = active.questions.length > 1 ? `${index + 1}/${active.questions.length}` : '';
  userQuestionList.querySelectorAll<HTMLElement>('.user-question-card').forEach((card, cardIndex) => {
    card.classList.toggle('is-current', cardIndex === index);
    card.classList.toggle('is-answered', cardIndex < index);
    card.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(control => { control.disabled = cardIndex !== index; });
  });
}
function finishUserQuestion(cancel = false) {
  const question = activeUserQuestion;
  if (!question) return;
  const result = cancel ? '' : question.questions.length === 1
    ? userQuestionAnswers[0] ?? ''
    : JSON.stringify(question.questions.map((item, index) => ({ question: item.question, answer: userQuestionAnswers[index] ?? '' })));
  activeUserQuestion = null;
  userQuestionStrip.hidden = true;
  composer.classList.remove('asking-user');
  userQuestionList.replaceChildren(); userQuestionAnswers.length = 0; userQuestionSelections.length = 0; activeQuestionIndex = 0;
  void window.orion.respondToQuestion(question.id, result);
}
function submitUserQuestion(index: number) {
  const active = activeUserQuestion;
  if (!active || index !== activeQuestionIndex) return;
  const question = active.questions[index];
  if (!question) return;
  const selection = userQuestionSelections[index];
  const answer = selection === 'custom'
    ? (userQuestionList.querySelector<HTMLInputElement>(`.user-question-card[data-question-index="${index}"] .user-question-answer`)?.value ?? '')
    : typeof selection === 'number' ? question.options[selection] ?? '' : '';
  if (!answer.trim()) { userQuestionList.querySelector<HTMLInputElement>(`.user-question-card[data-question-index="${index}"] .user-question-answer`)?.focus(); return; }
  userQuestionAnswers[index] = answer.trim();
  const card = userQuestionList.querySelector<HTMLElement>(`.user-question-card[data-question-index="${index}"]`);
  card?.querySelector('.user-question-hint')?.replaceChildren(document.createTextNode('Answer saved'));
  const submit = card?.querySelector<HTMLButtonElement>('.user-question-submit'); if (submit) { submit.disabled = true; submit.textContent = 'Answer saved'; }
  if (index + 1 < active.questions.length) {
    setActiveQuestion(index + 1);
    const next = userQuestionList.querySelector<HTMLElement>(`.user-question-card[data-question-index="${index + 1}"]`);
    requestAnimationFrame(() => {
      next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      next?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return;
  }
  finishUserQuestion();
}
window.orion.onUserQuestion(question => {
  activeUserQuestion = question;
  activeQuestionIndex = 0; userQuestionAnswers.length = 0; userQuestionSelections.length = 0;
  for (let i = 0; i < question.questions.length; i++) { userQuestionAnswers.push(''); userQuestionSelections.push(null); }
  renderUserQuestion(); composer.classList.add('asking-user');
  userQuestionStrip.hidden = false;
  userQuestionList.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
});
$('user-question-cancel').addEventListener('click', () => finishUserQuestion(true));
window.orion.onStream(event => {
  if (event.type !== 'cancelled' && event.type !== 'error' && event.type !== 'done') return;
  for (const [id, tool] of pendingApprovals) if (!event.conversationId || tool.conversationId === event.conversationId) pendingApprovals.delete(id);
  if (activeUserQuestion && (!event.conversationId || activeUserQuestion.conversationId === event.conversationId)) finishUserQuestion(true);
  renderApprovalStrip();
});
let appInitialized = false;
const waitingScheduledJobs: ScheduledJob[] = [];
let scheduledJobActive = false;
async function runScheduledJob(job: ScheduledJob) {
  if (!appInitialized || streaming || scheduledJobActive) { waitingScheduledJobs.push(job); return; }
  setComposerStreaming(true); scheduledJobActive = true; const sendButton = $('send') as HTMLButtonElement; sendButton.disabled = true;
  const created = now(), target: Conversation = { id: id(), title: `Schedule: ${job.name}`, model: job.model, createdAt: created, updatedAt: created, messages: [createMessage('user', `${job.prompt}\n\n[Scheduled run: ${new Date().toLocaleString()}]`), createMessage('assistant', '')] };
  conversations.unshift(target); const generationStarted = performance.now(); let failed = false, off: () => void = () => undefined;
  try {
    await save(target, true);
    off = window.orion.onStream(e => {
      if (e.conversationId !== target.id) return;
      const assistant = target.messages.at(-1); if (!assistant) return;
      if (e.type === 'workspace' && e.workspaceReview && current?.id === target.id) renderWorkspaceReview(e.workspaceReview);
      if(e.type==='context'&&e.usedContextTokens!==undefined)$('context-meter').textContent=`${(e.usedContextTokens/1000).toFixed(1)}K / ${Math.round((e.maxContextTokens??settings.contextWindow)/1024)}K`;
    if (e.type === 'replace') assistant.content = e.content ?? '';
    if (e.type === 'token') { assistant.content += e.content ?? ''; expandedThinking.delete(assistant.id); }
    if (e.type === 'done') { assistant.generationMs = performance.now() - generationStarted; if (e.tokensPerSecond !== undefined) assistant.tokensPerSecond = e.tokensPerSecond; void save(target); }
      if (e.type === 'reasoning') { assistant.reasoning = (assistant.reasoning ?? '') + (e.content ?? ''); if (!assistant.content) expandedThinking.add(assistant.id); }
      if (e.type === 'tool' && e.tool) {
        assistant.toolCalls ??= []; let entry = assistant.toolCalls.find(item => item.id === e.tool!.id);
        if (!entry) { entry = { id: e.tool.id, name: e.tool.name, description: e.tool.description, input: e.tool.input, status: 'pending' }; assistant.toolCalls.push(entry); }
        entry.name = e.tool.name; entry.description = e.tool.description; entry.input = e.tool.input ?? entry.input;
        if (e.phase === 'started') entry.status = e.tool.requiresApproval ? 'pending' : 'running';
        if (e.phase === 'updated') entry.status = 'running';
        if (e.phase === 'updated' && e.result?.output !== undefined) entry.output = e.result.output;
        if (e.phase === 'finished') { entry.status = e.result?.success ? 'completed' : e.result?.output === 'Approval declined by the user.' ? 'denied' : 'error'; entry.output = e.result?.output; void save(target); }
      }
      if (e.type === 'error') { failed = true; assistant.content += `\n\n> **Orion error:** ${e.content}`; }
      if (e.type === 'cancelled') { failed = true; if (!assistant.content) assistant.content = '_Scheduled run was stopped._'; }
      scheduleSave(target);
    });
    const result = await window.orion.streamChat({ conversationId: target.id, model: target.model, messages: target.messages.slice(0, -1), think: false, agent: job.agent });
    const completedAssistant = target.messages.at(-1); if (completedAssistant) { completedAssistant.generationMs = performance.now() - generationStarted; if (result.tokensPerSecond !== undefined) completedAssistant.tokensPerSecond = result.tokensPerSecond; }
  } catch (error) {
    failed = true; const assistant = target.messages.at(-1);
    if (assistant && !assistant.content) assistant.content = `Orion error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    off(); const timer = persistTimers.get(target.id); if (timer) clearTimeout(timer); persistTimers.delete(target.id);
    try { await save(target, true); } catch (error) { failed = true; console.error('Could not save scheduled task conversation:', error); }
    setComposerStreaming(false); scheduledJobActive = false; sendButton.disabled = false;
    const assistant = target.messages.at(-1);
    try { await window.orion.completeScheduledJob(job.id, failed ? 'error' : 'completed', assistant?.content || assistant?.reasoning || '(No text response)', target.id); }
    catch (error) { console.error('Could not update scheduled task status:', error); }
    if (($('schedules-dialog') as HTMLDialogElement).open) void renderScheduledJobs();
    const next = waitingScheduledJobs.shift(); if (next) void runScheduledJob(next);
  }
}
window.orion.onScheduledJob(job => { void renderScheduledJobs(); void runScheduledJob(job); });
function setupUpdaterUi() {
  const header = document.querySelector<HTMLElement>('.header');
  if (!header) return;
  let dismissedVersion = '';
  const banner = document.createElement('section'); banner.className = 'app-update-banner'; banner.hidden = true; banner.setAttribute('aria-live', 'polite');
  const copy = document.createElement('div'); copy.className = 'app-update-copy';
  const title = document.createElement('strong'); title.className = 'app-update-title';
  const detail = document.createElement('span'); detail.className = 'app-update-detail';
  const progress = document.createElement('progress'); progress.className = 'app-update-progress'; progress.max = 100; progress.hidden = true;
  copy.append(title, detail, progress);
  const actions = document.createElement('div'); actions.className = 'app-update-actions';
  const install = document.createElement('button'); install.className = 'primary'; install.type = 'button'; install.textContent = 'Update';
  const later = document.createElement('button'); later.className = 'secondary'; later.type = 'button'; later.textContent = 'Later';
  actions.append(install, later); banner.append(copy, actions); header.insertAdjacentElement('afterend', banner);

  const render = (state: AppUpdateState) => {
    if (state.phase === 'idle' || (state.version && state.version === dismissedVersion)) { banner.hidden = true; return; }
    banner.hidden = false; title.textContent = state.phase === 'available' ? `Orion ${state.version} is available` : state.phase === 'downloading' ? `Updating Orion to ${state.version}` : state.phase === 'installing' ? 'Installing Orion update' : 'Orion update failed';
    detail.textContent = state.detail ?? (state.phase === 'available' ? 'Download and install this release.' : state.phase === 'installing' ? 'Orion will restart when installation completes.' : '');
    progress.hidden = state.phase !== 'downloading';
    if (state.total && state.total > 0) { progress.removeAttribute('value'); progress.value = Math.min(100, Math.round((state.received ?? 0) / state.total * 100)); }
    else progress.removeAttribute('value');
    install.hidden = state.phase !== 'available' && state.phase !== 'error'; install.disabled = false; install.textContent = state.phase === 'error' ? 'Retry' : 'Update';
    later.hidden = state.phase !== 'available' && state.phase !== 'error';
    if (state.phase === 'installing') actions.replaceChildren();
    else if (!actions.contains(install)) actions.append(install, later);
  };
  install.onclick = () => { install.disabled = true; void window.orion.startAppUpdate().catch(error => render({ phase: 'error', version: '', detail: error instanceof Error ? error.message : String(error) })); };
  later.onclick = () => { dismissedVersion = title.textContent.match(/\d+\.\d+\.\d+/)?.[0] ?? ''; banner.hidden = true; };
  window.orion.onAppUpdateState(render);
  void window.orion.getAppUpdateState().then(render).catch(() => undefined);
  void window.orion.consumeUpdateChangelog().then(update => {
    if (!update) return;
    const dialog = document.createElement('dialog'); dialog.className = 'update-changelog-dialog';
    const heading = document.createElement('div'); heading.className = 'dialog-title';
    const h2 = document.createElement('h2'); h2.textContent = `Updated to Orion ${update.version}`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'icon-button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close changelog'); close.onclick = () => dialog.close(); heading.append(h2, close);
    const content = document.createElement('div'); content.className = 'update-changelog-content'; content.append(safeMarkdownFragment(update.notes || 'This release includes improvements and fixes.'));
    const footer = document.createElement('div'); footer.className = 'dialog-actions'; const done = document.createElement('button'); done.type = 'button'; done.className = 'primary'; done.textContent = 'Done'; done.onclick = () => dialog.close(); footer.append(done);
    dialog.append(heading, content, footer); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  }).catch(error => console.error('Could not display the update changelog:', error));
}
async function renderScheduledJobs() {
  const list = $('jobs-list'); list.replaceChildren();
  const jobs = await window.orion.listScheduledJobs();
  if (!jobs.length) { const empty = document.createElement('p'); empty.className = 'schedule-empty'; empty.textContent = 'No scheduled tasks yet.'; list.append(empty); return; }
  const groups: [string, ScheduledJob[]][] = [['Created by you', jobs.filter(job => job.createdBy !== 'agent')], ['Created by Agent', jobs.filter(job => job.createdBy === 'agent')]];
  for (const [label, group] of groups) {
    if (!group.length) continue;
    const groupLabel = document.createElement('h3'); groupLabel.className = `job-group-label${label === 'Created by Agent' ? ' agent-created' : ''}`; groupLabel.textContent = label; list.append(groupLabel);
    for (const job of group) {
    const card = document.createElement('article'); card.className = 'job-card';
    const head = document.createElement('div'); head.className = 'job-card-head';
    const name = document.createElement('span'); name.className = 'job-card-name'; name.textContent = job.name;
    const status = document.createElement('span'); status.className = 'job-card-status'; status.textContent = job.enabled ? job.status : 'disabled';
    head.append(name, status); card.append(head);
    const meta = document.createElement('p'); meta.className = 'job-card-meta'; meta.textContent = `${job.cron} · ${job.timezone}${job.nextRunAt ? ` · Next ${new Date(job.nextRunAt).toLocaleString()}` : ''}${job.lastRunAt ? ` · Last ${new Date(job.lastRunAt).toLocaleString()}` : ''}`; card.append(meta);
    const actions = document.createElement('div'); actions.className = 'job-card-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.onclick = () => editScheduledJob(job);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = job.enabled ? 'Disable' : 'Enable'; toggle.onclick = async () => { await window.orion.saveScheduledJob({ ...job, enabled: !job.enabled }); await renderScheduledJobs(); };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.onclick = async () => { if (await askConfirm(`Delete schedule “${job.name}”?`, 'Delete schedule')) { await window.orion.deleteScheduledJob(job.id); await renderScheduledJobs(); } };
    actions.append(edit, toggle, remove); card.append(actions); list.append(card);
    }
  }
}
function fillJobModels(selected = settings.selectedModel) {
  const select = $('job-model') as HTMLSelectElement; select.replaceChildren();
  const choices = chatModels();
  for (const model of choices) select.add(new Option(modelSelectorLabel(model), model.name));
  if (!choices.length) select.add(new Option('No chat models found', ''));
  select.value = choices.some(model => model.name === selected) ? selected : choices[0]?.name ?? '';
}
function editScheduledJob(job: ScheduledJob) {
  fillJobModels(job.model); ($('job-id') as HTMLInputElement).value = job.id; ($('job-name') as HTMLInputElement).value = job.name;
  ($('job-cron') as HTMLInputElement).value = job.cron; ($('job-prompt') as HTMLTextAreaElement).value = job.prompt;
  ($('job-enabled') as HTMLInputElement).checked = job.enabled;
  const origin = $('job-origin'); origin.textContent = job.createdBy === 'agent' ? 'Created by Agent · edits keep this origin label.' : 'Created by you.'; origin.hidden = false;
  $('job-error').hidden = true; $('job-form').hidden = false;
}
async function openSchedules() { await renderScheduledJobs(); await refreshStorageWarning(); ($('job-form') as HTMLFormElement).hidden = true; ($('schedules-dialog') as HTMLDialogElement).showModal(); }
const schedulesDialog = $('schedules-dialog') as HTMLDialogElement;
schedulesDialog.addEventListener('close', () => updateActiveNav(activeView));
window.orion.onScheduledJobsChanged(() => { if (schedulesDialog.open) void renderScheduledJobs(); });
$('schedules-close').onclick = () => schedulesDialog.close();
$('job-new').onclick = () => { const form = $('job-form') as HTMLFormElement; form.reset(); ($('job-id') as HTMLInputElement).value = ''; ($('job-cron') as HTMLInputElement).value = '0 9 * * 1-5'; fillJobModels(); $('job-origin').hidden = true; $('job-error').hidden = true; form.hidden = false; ($('job-name') as HTMLInputElement).focus(); };
$('job-cancel').onclick = () => { ($('job-form') as HTMLFormElement).hidden = true; $('job-origin').hidden = true; $('job-error').hidden = true; };
$('job-form').addEventListener('submit', async e => {
  e.preventDefault(); const error = $('job-error'); error.hidden = true;
  try {
    await window.orion.saveScheduledJob({ id: ($('job-id') as HTMLInputElement).value || undefined, name: ($('job-name') as HTMLInputElement).value, cron: ($('job-cron') as HTMLInputElement).value, prompt: ($('job-prompt') as HTMLTextAreaElement).value, model: ($('job-model') as HTMLSelectElement).value, agent: true, enabled: ($('job-enabled') as HTMLInputElement).checked });
    ($('job-form') as HTMLFormElement).hidden = true; await renderScheduledJobs();
  } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; }
});
function ensureStartupPreferenceControl() { if (document.getElementById('start-new-conversation')) return; const label = document.createElement('label'); label.className = 'job-check';const input=document.createElement('input');input.id='start-new-conversation';input.type='checkbox';const description=document.createElement('span');description.textContent='Start a new conversation when Orion opens (otherwise restore the last chat).';label.append(input,description);$('keep-in-tray').closest('label')?.before(label); }
async function init() { setupUpdaterUi(); settings = await window.orion.settings();  ensureStartupPreferenceControl(); ($('start-new-conversation') as HTMLInputElement).checked = settings.startNewConversation; applyTheme(settings.theme); conversations = await window.orion.listConversations(); await refreshStorageWarning(); if (settings.startNewConversation) { current = null; } else if (conversations.length) current = conversations[0]!; else { current = null; } await refreshModels(); if (settings.startNewConversation) newConversation(); else switchCanvasConversation(current?.id); if(await window.orion.shouldShowLlamaIntro())llamaIntroDialog.showModal(); await Promise.all([refreshSystemResources(),refreshLlamaStatus(),refreshCreateEngineStatus()]); chatMode = 'chat'; updateChatModeUi(); renderHistory(); renderMessages(true);  void renderMemoryUsage(); window.setInterval(() => { void renderMemoryUsage(); }, 3000); window.setInterval(() => { void refreshSystemResources(); }, 1000);window.setInterval(() => {void refreshLlamaStatus();},15000); appInitialized = true; const next = waitingScheduledJobs.shift(); if (next) void runScheduledJob(next); }
ensureStartupPreferenceControl();
window.history.scrollRestoration = 'manual';
void init();
