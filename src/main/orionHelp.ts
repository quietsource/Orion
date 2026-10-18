type HelpArticle = { id: string; title: string; text: string; keywords: string[] };

const articles: HelpArticle[] = [
  { id:'chat', title:'Chat and model controls', keywords:['chat','model','context','thinking','think','response','prompt','reasoning'], text:'Chat is Orion’s main conversation view. Choose an installed model in the top selector. The adjacent context selector sets the request context limit. The composer context meter shows prompt and generated context use. Reasoning is automatic for supported models at their runtime defaults; there is no thinking toggle or reasoning-level selector. Use the paperclip to attach files. Models can search the web directly through their available tools.' },
  { id:'history', title:'Conversations and OrionFS memory', keywords:['conversation','history','memory','recall','remember','new','delete','OrionFS','ofs'], text:'The sidebar Conversation History lists saved chats. New conversation starts a fresh conversation. OrionFS captures useful statements from saved conversations and recalls related memories locally without an embedding model or network service. Cross-conversation memory is off by default and can be enabled in Settings. Memory supplements the model’s selected context; it does not enlarge the model’s native context window.' },
  { id:'models', title:'Models and downloads', keywords:['models','download','huggingface','ollama','llama','gguf','install','quantization','api','provider','endpoint','openai'], text:'Open Models in the sidebar to browse conversational models and image/video models. The Providers tab connects OpenAI-compatible Chat Completions APIs: enter the API base URL including /v1 or the provider prefix, an optional bearer API key, and discover models or enter model IDs manually. Save and choose the provider model in chat. Enable tools only when supported by the provider/model. Keys stay in a private local file. Installed Ollama models appear dynamically in the chat model selector. Orion-managed GGUF chat models use the local llama.cpp runtime. Image and video model downloads are bundles: use the single model download action, then choose the installed model in Create.' },
  { id:'create', title:'Image and video generation', keywords:['create','image','video','generation','native image/video engine','generate','gallery'], text:'Open Create in the sidebar for local image and video generation. On first entry Orion offers to install a private native inference engine runtime using a compact Vulkan-powered runtime. Choose Image or Video, select an installed model, enter a prompt, and click Generate. Built-in image generation supports checkpoint files; the bundled Wan 2.2 TI2V 5B video model includes its required text encoder and VAE. Active progress appears in the generation stage; completed outputs are available in the Create gallery.' },
  { id:'browser', title:'Orion Browser tabs', keywords:['browser','tabs','tab','address','navigate','focus','close'], text:'Orion Browser has visible tabs, an address and search bar, and navigation controls. Use Ctrl or Command plus T to create a tab, W to close the current tab, L to focus the address bar, and 1–9 to select a tab. The AI can list tabs, open new pages, focus or close a tab by its tab ID, and read or navigate a chosen tab. Links open in new tabs. Browser pages must use HTTPS.' },
  { id:'agent', title:'Tools and local research', keywords:['agent','tool','toolbox','browser','file','window','application','command','search','research'], text:'Orion can use the tools shown in chat for web search, page reading, local research, Canvas, and other supported actions. Research subagents run locally and can use OrionFS memories and conversation context. Orion’s tools are available directly during chat.' },
  { id:'settings', title:'Settings and system prompt', keywords:['settings','system','prompt','temperature','interconversation','cross','memory'], text:'Open Settings from the sliders button in the title bar. Settings include Ollama URL, default context size, temperature, tray behavior, and cross-conversation memory. The System prompt tab shows the active base instructions; each request also receives its active model name, current local date/time, available tool descriptions, and any retrieved context.' },
  { id:'code', title:'Code and formatted output', keywords:['code','syntax','copy','markdown'], text:'Orion renders Markdown and highlights fenced code with line numbers and copy controls. You can open generated Markdown, HTML, text, and code in Canvas. Use Edit for direct source changes and Preview to see the result. Select text and add a note, or describe a change and choose Apply changes with AI. Revisions reopen automatically; Previous swaps the latest AI revision with its predecessor. Canvas documents stay with their conversation and can be reopened from chat. Download exports a copy; editing does not overwrite original files. Drag either sidebar’s hover handle to resize it.' },
  { id:'graphs', title:'Orion Graph System', keywords:['ogs','graph','diagram','chart','mesh','radar','venn','pie','bar','line'], text:'Orion Graph System renders fenced ogs blocks directly in chat. Prefer its simple line format: graph type and title first, then data lines. JSON remains supported. Supported types are diagram, mesh, line, bar, pie, radar, and venn. Models describe labels, series, nodes, edges, or overlapping sets; Orion handles layout and styling. Each graph has a data view, Copy OGS, and Save SVG. Rendering is local and does not execute model-provided scripts. Venn diagrams show conceptual overlap; their areas are not proportional.' },
  { id:'queue', title:'Message queue', keywords:['queue','queued','message','enter','interrupt','followup','draft'], text:'While a response is generating, type a follow-up and press Enter to queue it. Compact cards appear immediately above the composer. Messages run in order after the current response. The arrow sends a queued message now by interrupting the current response; the trash icon deletes it. Shift+Enter inserts a newline. Queued messages retain their conversation and attachments without replacing a newer unsent draft. Stop or an error pauses automatic dispatch; use a card’s arrow to resume. Queues remain in memory for the current app session.' },
  { id:'privacy', title:'Local processing and privacy', keywords:['privacy','private','local','cloud','internet','network','data'], text:'Chat inference uses the selected local Ollama server, Orion-managed local llama.cpp server, or configured OpenAI-compatible API provider. Remote providers receive prompts and relevant memory. Saved conversations, OrionFS memories, model files, generated media, and preferences are stored in Orion’s local user-data directory. Model browsing and downloads, search engines, and opening websites can use the network. Review the Settings privacy note for the specific data sent by web search and external tools.' },
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
  const namesOrionFeature = /\b(ollama|llama\.cpp|stable-diffusion\.cpp|agent mode|toolbox|context selector|context meter|cross[- ]conversation memory|inter[- ]conversation memory|OrionFS|models page|create page|schedules page)\b/i.test(query);
  return asksAboutProduct || namesOrionFeature;
}
