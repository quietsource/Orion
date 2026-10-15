import type { ApiProvider } from '../shared/types';

export type ChatFunctionTool = { type?: string; function: { name: string; description: string; parameters: Record<string, unknown> } };

export function createProviderChatRequest(provider: ApiProvider, model: string, messages: Array<Record<string, unknown>>, tools: ChatFunctionTool[], temperature: number, maxTokens: number, thinking = false, thinkingLevel = 'default') {
  const system = String(messages.find(message => message.role === 'system')?.content ?? '');
  if (provider.kind === 'anthropic') {
    const source = messages.filter(message => message.role !== 'system');
    const contents: Array<{ role: 'user'|'assistant'; content: unknown }> = [];
    for (const message of source) {
      if (message.role === 'tool') {
        const result = { type: 'tool_result', tool_use_id: String(message.tool_call_id ?? ''), content: String(message.content ?? '') };
        const last = contents.at(-1);
        if (last?.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(result);
        else contents.push({ role: 'user', content: [result] });
      } else if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        const blocks: unknown[] = [];
        if (typeof message.content === 'string' && message.content) blocks.push({ type: 'text', text: message.content });
        for (const item of message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) {
          let input: unknown = {}; try { input = JSON.parse(item.function.arguments || '{}'); } catch { /* Preserve valid object default. */ }
          blocks.push({ type: 'tool_use', id: item.id, name: item.function.name, input });
        }
        contents.push({ role: 'assistant', content: blocks });
      } else {
        const blocks: unknown[] = [];
        if (String(message.content ?? '')) blocks.push({ type:'text', text:String(message.content ?? '') });
        for (const image of Array.isArray(message.images) ? message.images as string[] : []) { const match=/^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(image); if(match) blocks.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}}); }
        contents.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content:blocks.length?blocks:String(message.content ?? '') });
      }
    }
    const adaptive=/claude-(?:opus|sonnet)-4-(?:6|7|8)/i.test(model);
    const thinkingConfig=thinking?adaptive?{thinking:{type:'adaptive'},output_config:{effort:thinkingLevel==='default'?'medium':thinkingLevel}}: {thinking:{type:'enabled',budget_tokens:Math.max(1024,Math.min(12000,Math.floor(maxTokens*0.55)))}}:{};
    return { url: `${provider.baseUrl.replace(/\/+$/, '')}/messages`, body: { model, system, messages: contents, max_tokens: maxTokens, temperature:thinking&&!adaptive?1:temperature, stream: true, ...thinkingConfig, ...(tools.length ? { tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) } : {}) } };
  }
  if (provider.kind === 'google') {
    const source = messages.filter(message => message.role !== 'system');
    const contents: Array<{ role: 'user'|'model'; parts: unknown[] }> = [];
    const names = new Map<string, string>();
    for (const message of source) {
      if (message.role === 'tool') {
        const id = String(message.tool_call_id ?? ''), name = names.get(id) ?? 'unknown_tool';
        const part = { functionResponse: { name, response: { content: String(message.content ?? '') } } };
        const last = contents.at(-1);
        if (last?.role === 'user') last.parts.push(part); else contents.push({ role: 'user', parts: [part] });
      } else if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        const parts: unknown[] = [];
        if (typeof message.content === 'string' && message.content) parts.push({ text: message.content });
        for (const item of message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) {
          let args: unknown = {}; try { args = JSON.parse(item.function.arguments || '{}'); } catch { /* Preserve valid object default. */ }
          names.set(item.id, item.function.name);
          parts.push({ functionCall: { name: item.function.name, args } });
        }
        contents.push({ role: 'model', parts });
      } else {
        const parts: unknown[] = [];
        if(String(message.content ?? '')) parts.push({text:String(message.content ?? '')});
        for(const image of Array.isArray(message.images)?message.images as string[]:[]){const match=/^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(image);if(match)parts.push({inlineData:{mimeType:match[1],data:match[2]}});}
        contents.push({role:message.role==='assistant'?'model':'user',parts:parts.length?parts:[{text:''}]});
      }
    }
    const thinkingConfig=thinking?(/gemini-3/i.test(model)?{thinkingLevel:thinkingLevel==='default'?'high':thinkingLevel}:{thinkingBudget:thinkingLevel==='high'?24576:thinkingLevel==='medium'||thinkingLevel==='default'?8192:1024}):(/gemini-2\.5/i.test(model)?{thinkingBudget:0}:{});
    return { url: `${provider.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, body: { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), ...(tools.length ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }] } : {}), generationConfig: { temperature, maxOutputTokens: maxTokens, ...(Object.keys(thinkingConfig).length?{thinkingConfig}:{}) } } };
  }
  const visionMessages=messages.map(message=>{const images=Array.isArray(message.images)?message.images as string[]:[];if(!images.length)return message;const content:Array<Record<string,unknown>>=[];if(String(message.content??''))content.push({type:'text',text:String(message.content??'')});for(const url of images)content.push({type:'image_url',image_url:{url}});const{images:_images,...rest}=message;return{...rest,content};});
  const reasoning=/^(gpt-5|o[134](?:-|$))/i.test(model)?{reasoning_effort:thinking?(thinkingLevel==='default'?'medium':thinkingLevel):'none'}:thinking&&thinkingLevel!=='default'?{reasoning_effort:thinkingLevel}:{};
  return { url: `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, body: { model, messages:visionMessages, stream: true, stream_options: { include_usage: true }, temperature, max_tokens: maxTokens, ...reasoning, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) } };
}

export function normalizeProvider(value: ApiProvider): ApiProvider {
  const url = new URL(value.baseUrl.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API base URL without credentials, query parameters, or fragments.');
  if (!/^[\w-]+$/.test(value.id) || !value.name.trim()) throw new Error('Provider name and identifier are required.');
  const supportedKinds = ['openai-compatible','openai','anthropic','google','zai','moonshotai','opencode','opencode-go','openrouter'];
  const kind = supportedKinds.includes(String(value.kind)) ? value.kind : 'openai-compatible';
  return { id: value.id, name: value.name.trim().slice(0, 100), baseUrl: url.toString().replace(/\/+$/, ''), models: [...new Set(value.models.map(model => model.trim()).filter(Boolean))], tools: value.tools === true, kind, apiKey: value.apiKey?.trim() };
}
export function providerModelKey(provider: string, model: string) { return `api:${provider}:${encodeURIComponent(model)}`; }
export function resolveProviderModel(providers: ApiProvider[], key: string) {
  if (!key.startsWith('api:')) return undefined;
  const match = /^api:([^:]+):(.+)$/.exec(key);
  const provider = providers.find(item => item.id === match?.[1]);
  const model = match ? decodeURIComponent(match[2]!) : '';
  if (!provider || !provider.models.includes(model)) throw new Error('This API model is no longer configured. Open Model browser → Providers.');
  return { provider, model };
}
export function providerHeaders(provider: ApiProvider): Record<string, string> {
  if (provider.kind === 'anthropic') return { 'content-type': 'application/json', ...(provider.apiKey ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' } : {}) };
  if (provider.kind === 'google') return { 'content-type': 'application/json', ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {}) };
  return { 'content-type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) };
}
export async function discoverProviderModels(provider: ApiProvider): Promise<string[]> {
  const response = await fetch(`${provider.baseUrl}/models`, { headers: providerHeaders(provider), signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}. Check the base URL and API key, or enter model IDs manually.`);
  const body = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
  const ids = provider.kind === 'google'
    ? body.models?.map(item => item.name?.replace(/^models\//, ''))
    : body.data?.map(item => item.id);
  if (!Array.isArray(ids)) throw new Error('The provider returned an unrecognized models response. Enter model IDs manually.');
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && Boolean(id)))];
}
