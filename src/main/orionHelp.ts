type HelpArticle = { id: string; title: string; text: string; keywords: string[] };

const articles: HelpArticle[] = [
  { id:'chat', title:'Chat and model controls', keywords:['chat','model','context','thinking','think','response','prompt','reasoning'], text:'Chat is Orion’s main conversation view. Choose an installed model in the top selector. The adjacent context selector sets the request context limit. The composer context meter shows prompt and generated context use. Think enables reasoning when supported. Use the paperclip to attach files and Search to include DuckDuckGo results. Press / in the empty composer to open the command palette.' },
  { id:'history', title:'Conversations and memory', keywords:['conversation','history','memory','recall','remember','archive','new','delete'], text:'The sidebar Conversation History lists saved chats. New conversation starts a fresh conversation and memory scope. Orion indexes saved conversations for up to one million archive tokens and retrieves relevant excerpts when useful. Cross-conversation memory is off by default and can be enabled in Settings. The archive supplements a model’s selected context; it does not enlarge its native context window.' },
  { id:'models', title:'Models and downloads', keywords:['models','download','huggingface','ollama','llama','gguf','install','quantization','api','provider','endpoint','openai'], text:'Open Models in the sidebar to browse conversational models and image/video models. The Providers tab connects OpenAI-compatible Chat Completions APIs: enter the API base URL including /v1 or the provider prefix, an optional bearer API key, and discover models or enter model IDs manually. Save and choose the provider model in chat or schedules. Enable tools only when supported by the provider/model. Keys stay in a private local file. Installed Ollama models appear dynamically in the chat model selector. Orion-managed GGUF chat models use the local llama.cpp runtime. Image and video model downloads are bundles: use the single model download action, then choose the installed model in Create.' },
  { id:'create', title:'Image and video generation', keywords:['create','image','video','generation','ComfyUI','generate','gallery'], text:'Open Create in the sidebar for local image and video generation. On first entry Orion offers to install a private headless ComfyUI runtime using uv and its managed Python 3.12. Choose Image or Video, select an installed model, enter a prompt, and click Generate. Built-in image generation supports checkpoint files; the bundled Wan 2.2 TI2V 5B video model includes its required text encoder and VAE. Active progress appears in the generation stage; completed outputs are available in the Create gallery.' },
  { id:'browser', title:'Orion Browser tabs', keywords:['browser','tabs','tab','address','navigate','focus','close'], text:'Orion Browser has visible tabs, an address and search bar, and navigation controls. Use Ctrl or Command plus T to create a tab, W to close the current tab, L to focus the address bar, and 1–9 to select a tab. The AI can list tabs, open new pages, focus or close a tab by its tab ID, and read or navigate a chosen tab. Links open in new tabs. Browser pages must use HTTPS.' },
  { id:'agent', title:'Tools, project workspace, and approvals', keywords:['agent','tool','toolbox','approval','browser','file','window','application','command','search','palette','slash','project','sandbox','bubblewrap','diff','changes','git','checkpoint'], text:'Models can call any enabled tool during chat; tools are enabled by default. Press / in the empty composer to open the command palette and toggle individual tools. Create a project there under Documents/Orion Projects or select an existing folder. Linux commands run in a Bubblewrap sandbox inside a private per-conversation project copy and always require approval. File edits and command-created changes remain private until you approve the Files changed review above the composer. Reject discards the private copy. In a Git workspace, save checkpoints in the palette; click the rollback arrow to inspect a preview and confirm or cancel.' },
  { id:'settings', title:'Settings and system prompt', keywords:['settings','system','prompt','temperature','workspace','interconversation','cross','approval'], text:'Open Settings from the sliders button in the title bar. Settings include Ollama URL, default context size, temperature, approval behavior, workspace folder, tray behavior, cross-conversation memory, and semantic memory options. View system prompt shows the current base instructions; each request also gets its active model name, current local date/time, available tool descriptions, and any retrieved context.' },
  { id:'code', title:'Project files and code output', keywords:['code','workspace','file','syntax','copy','markdown','diagram','mermaid'], text:'Select a project in the / command palette. Models can read and stage file edits there; review the changed-file list and diff above the composer, then approve or reject the entire project proposal. Commands require individual approval. Orion renders Markdown, highlights fenced code with line numbers and copy controls, and renders supported Mermaid diagrams.' },
  { id:'privacy', title:'Local processing and privacy', keywords:['privacy','private','local','cloud','internet','network','data'], text:'Chat inference uses the selected local Ollama server, Orion-managed local llama.cpp server, or configured OpenAI-compatible API provider. Remote providers receive prompts and relevant memory. Saved conversations, model files, memory index, generated media, and preferences are stored in Orion’s local user-data directory. Model browsing and downloads, search engines, opening websites, and approved external actions can use the network. Review the Settings privacy note for the specific data sent by web search and external tools.' },
  { id:'schedules', title:'Schedules', keywords:['schedule','scheduled','cron','recurring','task'], text:'Open Schedules in the sidebar to create and manage recurring local tasks. Schedules use a five-field cron expression in the device timezone and run while Orion is open. Enable Keep Orion running in the system tray in Settings if schedules should continue after closing the window.' }
];

function words(value: string) {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 2) ?? [];
}

export function searchOrionHelp(query: string, maxCharacters = 4500) {
  const queryWords = [...new Set(words(query))];
  const ranked = articles.map(article => {
    const haystack = `${article.title} ${article.text} ${article.keywords.join(' ')}`.toLocaleLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (article.keywords.some(keyword => keyword === word || keyword.startsWith(word) || word.startsWith(keyword))) score += 3;
      if (haystack.includes(word)) score += 1;
    }
    return { article, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score-a.score).slice(0, 3);
  let output = '';
  for (const { article } of ranked) {
    const next = `${article.title}: ${article.text}`;
    if (output.length + next.length + 2 > maxCharacters) break;
    output += `${output ? '\n\n' : ''}${next}`;
  }
  return output || 'No matching Orion help entry was found.';
}

export function isOrionHelpQuestion(query: string) {
  const asksAboutProduct = /\b(orion|this app|this application|in the app|in orion)\b/i.test(query) &&
    /\b(how|where|what|why|which|help|use|open|find|change|enable|disable|set|settings|toolbox|context|memory|model|download|create|schedule|approval|install|is|does|can|supported|available|private|local|data)\b/i.test(query);
  const namesOrionFeature = /\b(ollama|llama\.cpp|ComfyUI|agent mode|toolbox|command palette|context selector|context meter|cross[- ]conversation memory|inter[- ]conversation memory|orion memory|models page|create page|schedules page|bubblewrap|git checkpoint)\b/i.test(query);
  return asksAboutProduct || namesOrionFeature;
}
