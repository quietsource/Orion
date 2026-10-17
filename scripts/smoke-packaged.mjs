import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [executable, ...args] = process.argv.slice(2);
const expectedVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
if (!executable) {
  console.error('Usage: bun scripts/smoke-packaged.mjs <executable> [args...]');
  process.exit(2);
}
const useWine = process.env.ORION_SMOKE_WINE === '1' && process.platform !== 'win32';
const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'orion-packaged-smoke-'));
// Model an upgrade from the previous onboarding implementation. The new
// versioned migration must still show the prompt even when the old marker exists.
const legacyBackendDir = path.join(userDataDir, 'orion', 'backends', 'llama.cpp');
await mkdir(legacyBackendDir, { recursive: true });
await writeFile(path.join(legacyBackendDir, 'intro-seen'), 'seen');
if (process.env.ORION_SMOKE_LLAMA_INSTALLED === '1') {
  const serverBinary = path.join(legacyBackendDir, 'runtime-gpu', 'llama-server');
  const cpuBinary = path.join(legacyBackendDir, 'runtime-cpu', 'llama-server');
  await mkdir(path.dirname(serverBinary), { recursive: true }); await mkdir(path.dirname(cpuBinary), { recursive: true });
  await writeFile(serverBinary, 'smoke'); await writeFile(cpuBinary, 'smoke');
  await writeFile(path.join(legacyBackendDir, 'orion-state.json'), JSON.stringify({ serverBinary, cpuBinary }));
}

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
if (!address || typeof address === 'string') throw new Error('Could not reserve a localhost debugging port.');
const port = address.port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

const launchArgs = [
  ...args,
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-address=127.0.0.1`,
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*'
];
const child = spawn(useWine ? 'wine' : executable, useWine ? [path.resolve(executable), ...launchArgs] : launchArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } : {}),
    ...(useWine ? { WINEDLLOVERRIDES: process.env.WINEDLLOVERRIDES ?? 'mscoree,mshtml=' } : {})
  },
  windowsHide: true,
  detached: process.platform !== 'win32'
});
let childExit;
let childOutput = '';
const captureOutput = stream => stream.on('data', chunk => {
  childOutput = (childOutput + chunk.toString()).slice(-8000);
});
captureOutput(child.stdout);
captureOutput(child.stderr);
child.once('error', error => { childExit = { error }; });
child.once('exit', (code, signal) => { childExit = { code, signal }; });

async function waitForRenderer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'No Orion page target appeared.';
  while (Date.now() < deadline) {
    if (childExit) throw new Error(`Packaged app exited before its window loaded: ${childExit.error?.message ?? `code=${childExit.code}, signal=${childExit.signal}`}${childOutput ? `\nApplication output:\n${childOutput}` : ''}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error(`DevTools returned HTTP ${response.status}.`);
      const targets = await response.json();
      const page = targets.find(target => target.type === 'page' && target.title === 'Orion' && target.url.startsWith('file:'));
      if (page?.webSocketDebuggerUrl) return page;
      lastError = `Waiting for Orion's file-backed page; found ${targets.filter(target => target.type === 'page').length} page target(s).`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`Orion did not load its window within ${timeoutMs / 1000} seconds. ${lastError}${childOutput ? `\nApplication output:\n${childOutput}` : ''}`);
}

async function verifySidebarToggle(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Orion’s renderer.')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to Orion’s renderer debugging session.')); }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve(message);
  });
  const evaluate = (expression, timeoutMs = 45_000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Timed out checking Orion’s rendered UI.')); }, timeoutMs);
    pending.set(id, message => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const result = await evaluate(`(async () => {
      const expectsLlamaInstalled = ${process.env.ORION_SMOKE_LLAMA_INSTALLED === '1'};
      const readyUntil = Date.now() + 20000;
      while (Date.now() < readyUntil && document.querySelector('#connection-state')?.textContent === 'Checking') await new Promise(resolve => setTimeout(resolve, 50));
      const introUntil = Date.now() + (expectsLlamaInstalled ? 300 : 30000);
      while (Date.now() < introUntil && !document.querySelector('#llama-intro-dialog')?.open) await new Promise(resolve => setTimeout(resolve, 50));
      const llamaIntroShown = document.querySelector('#llama-intro-dialog')?.open === true;
      if (!expectsLlamaInstalled && llamaIntroShown) document.querySelector('#llama-intro-later')?.click();
      if (!expectsLlamaInstalled) for(let i=0;i<100 && await window.orion.shouldShowLlamaIntro();i++) await new Promise(resolve=>setTimeout(resolve,25));
      const llamaIntroDismissed = !(await window.orion.shouldShowLlamaIntro());
      const llamaInstalled = await window.orion.llamaStatus();
      const main = document.querySelector('.main');
      const messages = document.querySelector('#messages');
      const collapse = document.querySelector('#collapse');
      const expand = document.querySelector('#expand');
      if (document.title !== 'Orion' || !main || !messages || !collapse || !expand || document.querySelector('#connection-state')?.textContent === 'Checking') return { ok: false, state: 'app initialization did not finish' };
      collapse.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const collapsedClass = document.body.classList.contains('sidebar-collapsed');
      const collapsedMainWidth = main.getBoundingClientRect().width;
      const collapsedMessagesWidth = messages.getBoundingClientRect().width;
      const collapsed = collapsedClass && collapsedMainWidth > 0 && collapsedMessagesWidth > 0;
      expand.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const expanded = !document.body.classList.contains('sidebar-collapsed') && main.getBoundingClientRect().width > 0 && messages.getBoundingClientRect().width > 0;
      return { ok: llamaIntroShown === !expectsLlamaInstalled && llamaIntroDismissed && llamaInstalled === expectsLlamaInstalled && document.querySelector('#llama-state')?.textContent === (expectsLlamaInstalled ? 'Installed' : 'Not Installed') && collapsed && expanded, llamaIntroShown, llamaIntroDismissed, llamaInstalled, llamaState:document.querySelector('#llama-state')?.textContent, collapsed, collapsedClass, collapsedMainWidth, collapsedMessagesWidth, expanded, title: document.title };
    })()`);
    if (!result?.ok) throw new Error(`Orion renderer or sidebar smoke check failed: ${JSON.stringify(result)}`);
    console.log(`Rendered Orion page and sidebar collapse/expand passed (${result.title}).`);
  } finally {
    socket.close();
  }
}

async function verifyModelsAndCreateViews(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Orion’s renderer.')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to Orion’s renderer debugging session.')); }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = nextId++, timeout = setTimeout(() => { pending.delete(id); reject(new Error('Timed out checking Orion’s model and Create pages.')); }, 120_000);
    pending.set(id, message => { clearTimeout(timeout); if (message.error) reject(new Error(message.error.message)); else resolve(message.result?.result?.value); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const result = await evaluate(`(async () => {
      const waitFor = async selector => { for(let i=0;i<400;i++){const found=document.querySelector(selector);if(found)return found;await new Promise(r=>setTimeout(r,25));}return null; };
      const search = document.querySelector('#search-open');
      search?.click();
      const searchEnabled = search?.getAttribute('aria-pressed') === 'true' && search.classList.contains('active');
      search?.click();
      const searchDisabled = search?.getAttribute('aria-pressed') === 'false' && !search.classList.contains('active');
      const settings = await window.orion.settings();
      settings.interConversationMemory = false;
      settings.approvalLevel = 'none';
      await window.orion.saveSettings(settings);
      await window.orion.saveConversation({ id:'smoke-memory-seed', title:'Smoke memory seed', model:'smoke', createdAt:Date.now(), updatedAt:Date.now(), messages:[{ id:'smoke-memory-message', role:'user', content:'A distinctive saved memory for the packaged smoke check.', createdAt:Date.now() }] }, true);
      document.querySelector('#new-chat')?.click();
      for(let i=0;i<200 && document.querySelector('#memory-label')?.textContent !== '0 / 1M tokens';i++) await new Promise(r=>setTimeout(r,25));
      const freshMemory = document.querySelector('#memory-label')?.textContent === '0 / 1M tokens';
      document.querySelector('.nav-item[data-view="Models"]')?.click();
      const models = await waitFor('.models-page');
      const composerHidden = getComputedStyle(document.querySelector('.composer-wrap')).display === 'none';
      const modelsChevronHidden = getComputedStyle(document.querySelector('#model-selector-wrap')).display === 'none' && getComputedStyle(document.querySelector('#model-selector-wrap'), '::after').display === 'none';
      const tabs = [...document.querySelectorAll('.models-page .model-tab')].map(x=>x.textContent.trim());
      document.querySelector('.nav-item[data-view="Create"]')?.click();
      const create = await waitFor('.create-page');
      const createChevronHidden = getComputedStyle(document.querySelector('#model-selector-wrap')).display === 'none' && getComputedStyle(document.querySelector('#model-selector-wrap'), '::after').display === 'none';
      const createComposer = document.querySelector('#create-composer-wrap');
      const setupPromptShown = await waitFor('#invoke-install-dialog[open]');
      const installControl = document.querySelector('#invoke-install');
      document.querySelector('#invoke-install-dialog button[value="cancel"]')?.click();
      document.querySelector('.nav-item[data-view="Chat"]')?.click();
      document.querySelector('.nav-item[data-view="Create"]')?.click();
      await new Promise(r=>setTimeout(r,150));
      const promptShownAgain = document.querySelector('#invoke-install-dialog')?.open === true;
      const settingsPositioned = document.querySelector('#settings-open')?.nextElementSibling?.classList.contains('window-controls') === true;
      return {ok:searchEnabled&&searchDisabled&&freshMemory&&!!models&&composerHidden&&modelsChevronHidden&&tabs.includes('Conversational')&&tabs.includes('Image / Video')&&tabs.includes('Manage')&&!!create&&createChevronHidden&&!!createComposer&&!!setupPromptShown&&!!installControl&&!promptShownAgain&&settingsPositioned,searchEnabled,searchDisabled,freshMemory,composerHidden,modelsChevronHidden,tabs,createPage:!!create,createChevronHidden,createComposer:!!createComposer,firstEntryPrompt:!!setupPromptShown,promptShownAgain,settingsPositioned};
    })()`);
    if (!result?.ok) throw new Error(`Orion model/Create page smoke check failed: ${JSON.stringify(result)}`);
    console.log('Model browser, hidden composer, lazy Create setup, and titlebar settings passed.');
  } finally { socket.close(); }
}

async function verifyOllamaChat(webSocketUrl, modelName) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Orion’s renderer.')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to Orion’s renderer debugging session.')); }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = nextId++, timeout = setTimeout(() => { pending.delete(id); reject(new Error('Timed out waiting for Orion’s Ollama chat.')); }, 180_000);
    pending.set(id, message => { clearTimeout(timeout); if (message.error) reject(new Error(message.error.message)); else resolve(message.result?.result?.value); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const escapedModel = JSON.stringify(modelName);
    const result = await evaluate(`(async () => {
      const waitFor = async (predicate, timeout=20000) => { const until=Date.now()+timeout; while(Date.now()<until){if(predicate())return true;await new Promise(r=>setTimeout(r,100));}return false; };
      document.querySelector('.nav-item[data-view="Chat"]')?.click();
      if (!await waitFor(()=>!document.querySelector('#chat')?.hidden)) return {ok:false,error:'Chat page did not open'};
      const model=document.querySelector('#model');
      if(!model || ![...model.options].some(option=>option.value===${escapedModel})) return {ok:false,error:'Requested Ollama model is not available in Orion'};
      model.value=${escapedModel}; model.dispatchEvent(new Event('change',{bubbles:true}));
      const prompt=document.querySelector('#prompt'); prompt.value='Reply with exactly: Orion stream works.';
      document.querySelector('#send')?.click();
      const started=await waitFor(()=>document.querySelector('#send')?.title==='Stop generation',10000);
      const done=started && await waitFor(()=>document.querySelector('#send')?.title==='Send' && [...document.querySelectorAll('.message')].some(message=>message.querySelector('.message-author')?.textContent!== 'You' && (message.querySelector('.message-body')?.textContent.trim().length??0)>0),180000);
      const answers=[...document.querySelectorAll('.message')].filter(message=>message.querySelector('.message-author')?.textContent!== 'You').map(message=>message.querySelector('.message-body')?.textContent.trim()??'').filter(Boolean);
      const answer=answers.at(-1)??'';
      return {ok:done&&answer.length>0&&!/ollama error:/i.test(answer),answer:answer.slice(0,240),done};
    })()`);
    if (!result?.ok) throw new Error(`Packaged Ollama streaming check failed: ${JSON.stringify(result)}`);
    console.log(`Packaged Ollama chat streamed a response from ${modelName}: ${result.answer}`);
  } finally { socket.close(); }
}

async function verifyApiProvider(webSocketUrl) {
  let requests = 0, toolRoundTrip = false;
  const api = createHttpServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer smoke-secret') { res.writeHead(401); res.end(); return; }
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({data:[{id:'smoke/chat'},{id:'smoke/slow'},{id:'smoke/error'},{id:'smoke/long'}]})); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); requests++;
    if (input.model === 'smoke/error') { res.writeHead(401); res.end('Unauthorized'); return; }
    res.writeHead(200, {'content-type':'text/event-stream'});
    const emit = data => { res.write('data: ' + JSON.stringify(data) + '\r\n\r\n'); res.flushHeaders(); };
    if (input.model === 'smoke/slow') { emit({choices:[{delta:{content:'Starting'}}]}); return; }
    const toolResult = input.messages.find(message => message.role === 'tool');
    if (!toolResult) {
      emit({choices:[{delta:{reasoning_content:'Checking Orion help.'}}]});
      emit({choices:[{delta:{tool_calls:[{index:0,id:'call_smoke',function:{name:'search_orion_help',arguments:'{"query":'}}]}}]});
      emit({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"API providers"}'}}]},finish_reason:'tool_calls'}]});
    } else {
      toolRoundTrip = toolResult.tool_call_id === 'call_smoke' && input.messages.some(message => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call_smoke');
      if (input.model === 'smoke/long') {
        emit({choices:[{delta:{content:'```javascript\n'}}]});
        for (let i = 0; i < 120; i++) { emit({choices:[{delta:{content:'const entry' + i + ' = ' + i + '; // Orion streaming performance sample\n'}}]}); await delay(10); }
        emit({choices:[{delta:{content:'```'},finish_reason:'stop'}]}); res.end('data: [DONE]\r\n\r\n'); return;
      }
      emit({choices:[{delta:{content:'Provider stream works.'},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:5}});
    }
    res.end('data: [DONE]\r\n\r\n');
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + api.address().port + '/v1';
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to Orion’s renderer.')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to Orion’s renderer debugging session.')); }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = nextId++, timeout = setTimeout(() => {
      pending.delete(id);
      const probeId = nextId++;
      const probeTimeout = setTimeout(() => { pending.delete(probeId); reject(new Error('Timed out checking Orion’s API provider flow; renderer checkpoint unavailable.')); }, 5_000);
      pending.set(probeId, message => {
        clearTimeout(probeTimeout);
        const stage = message.result?.result?.value;
        reject(new Error(`Timed out checking Orion’s API provider flow at ${stage ?? 'unknown stage'}.`));
      });
      socket.send(JSON.stringify({ id: probeId, method: 'Runtime.evaluate', params: { expression: 'window.__orionSmokeStage ?? "stage marker not set"', returnByValue: true } }));
    }, 180_000);
    pending.set(id, message => { clearTimeout(timeout); if (message.error) reject(new Error(message.error.message)); else resolve(message.result?.result?.value); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const result = await evaluate(`(async () => {
      const stage = value => { window.__orionSmokeStage = value; };
      stage('opening provider settings');
      const pause = () => new Promise(resolve => setTimeout(resolve, 30));
      document.querySelector('.nav-item[data-view="Models"]').click();
      let providersTab;
      for(let i=0;i<300 && !providersTab;i++){providersTab=[...document.querySelectorAll('.model-tab')].find(tab=>tab.textContent==='Providers');if(!providersTab)await pause();}
      if(!providersTab)return {ok:false,stage:'models view did not render'};
      providersTab.click();
      let form;
      for(let i=0;i<300 && !form;i++){form=document.querySelector('.provider-form');if(!form)await pause();}
      if(!form)return {ok:false,stage:'provider form did not render'};
      let inputs=form.querySelectorAll('input');
      inputs[0].value='Smoke API'; inputs[1].value=${JSON.stringify(baseUrl)}; inputs[2].value='smoke-secret'; inputs[4].checked=true;
      [...form.querySelectorAll('button')].find(button=>button.textContent==='Discover models').click();
      for(let i=0;i<200 && !inputs[3].value.includes('smoke/chat');i++) await pause();
      const discovered=inputs[3].value.includes('smoke/chat');
      if(!discovered)return {ok:false,stage:'provider model discovery',status:form.querySelector('[role=status]')?.textContent};
      const submitForm=document.querySelector('.provider-form');
      inputs=submitForm.querySelectorAll('input');
      if(inputs[0].value!=='Smoke API'||inputs[1].value!==${JSON.stringify(baseUrl)}){inputs[0].value='Smoke API';inputs[1].value=${JSON.stringify(baseUrl)};inputs[2].value='smoke-secret';inputs[3].value='smoke/chat, smoke/slow, smoke/error, smoke/long';inputs[4].checked=true;}
      submitForm.requestSubmit();
      stage('saving provider');
      for(let i=0;i<300 && !(await window.orion.listProviders()).length;i++) await pause();
      const provider=(await window.orion.listProviders())[0];
      if(!provider) return {ok:false,discovered,status:document.querySelector('.provider-form [role=status]')?.textContent,values:[...document.querySelectorAll('.provider-form input')].map(input=>input.type==='password'?'hidden':input.value)};
      const privateKey=provider.keyConfigured && !('apiKey' in provider);
      await window.orion.saveProvider({...provider,name:'Smoke API edited'});
      stage('saving provider edits');
      const keptKey=(await window.orion.listProviders())[0].keyConfigured;
      const choices=await window.orion.listModels();
      const model=choices.find(item=>item.source==='api' && item.details.label.endsWith('smoke/chat')).name;
      const events=[]; const unsubscribe=window.orion.onStream(event=>events.push(event));
      const id='provider-smoke'; const messages=[{id:'provider-user',role:'user',content:'Explain API providers in Orion',createdAt:Date.now()}];
      await window.orion.saveConversation({id,title:'Provider smoke',model,createdAt:Date.now(),updatedAt:Date.now(),messages});
      stage('saving smoke settings');
      const testSettings=await window.orion.settings(); testSettings.approvalLevel='none'; await window.orion.saveSettings(testSettings);
      const firstStream=window.orion.streamChat({conversationId:id,model,messages,think:false,agent:true});
      stage('running tool round trip');
      const firstStreamState=await Promise.race([firstStream.then(()=> 'done',error=>'error:'+String(error)),new Promise(resolve=>setTimeout(()=>resolve('timeout'),20000))]);
      if(firstStreamState!=='done') return {ok:false,firstStreamState,eventTypes:events.map(event=>event.type+':'+(event.phase??'')),approval:document.querySelector('#tool-approval')?.outerHTML.slice(0,600)};
      const streamed=events.some(event=>event.type==='token' && event.content==='Provider stream works.');
      const reasoning=events.some(event=>event.type==='reasoning');
      const tools=events.some(event=>event.type==='tool' && event.phase==='finished');
      const done=events.some(event=>event.type==='done');
      const slow=choices.find(item=>item.source==='api' && item.details.label.endsWith('smoke/slow')).name;
      stage('testing stream cancellation');
      const pending=window.orion.streamChat({conversationId:id,model:slow,messages,think:false,agent:false});
      for(let i=0;i<200 && !events.some(event=>event.content==='Starting');i++) await pause();
      await window.orion.cancelStream(); await pending;
      const cancelled=events.some(event=>event.type==='cancelled');
      const errorModel=choices.find(item=>item.source==='api' && item.details.label.endsWith('smoke/error')).name;
      stage('testing provider error handling');
      await window.orion.streamChat({conversationId:id,model:errorModel,messages,think:false,agent:false}).catch(()=>undefined);
      const error=events.some(event=>event.type==='error' && event.content.includes('401'));
      unsubscribe();
      const longModel=choices.find(item=>item.source==='api' && item.details.label.endsWith('smoke/long')).name;
      stage('testing long chat rendering');
      document.querySelector('.nav-item[data-view="Chat"]').click(); document.querySelector('#new-chat').click();
      const approval=document.querySelector('.approval-selector'); approval.value='none';
      const chatSettings=await window.orion.settings(); chatSettings.approvalLevel='none'; await window.orion.saveSettings(chatSettings);
      approval.dispatchEvent(new Event('change',{bubbles:true}));
      const selector=document.querySelector('#model'); selector.value=longModel; selector.dispatchEvent(new Event('change',{bubbles:true})); await pause();
      const prompt=document.querySelector('#prompt'); prompt.value='Generate a longer code response for the rendering smoke check'; prompt.dispatchEvent(new Event('input',{bubbles:true}));
      let lastTick=performance.now(),maxStall=0; const heartbeat=setInterval(()=>{const tick=performance.now();maxStall=Math.max(maxStall,tick-lastTick);lastTick=tick;},16);
      document.querySelector('#send').click();
      for(let i=0;i<200 && !(document.querySelector('.message-assistant .message-body')?.textContent.length>3000);i++) await pause();
      const toolPanel=document.querySelector('.message-assistant .tool-activity');
      const activeArticle=document.querySelector('.message-assistant'); const captureState=document.querySelector('#send').title; await new Promise(resolve=>setTimeout(resolve,100));
      const stablePanel=!!toolPanel && toolPanel===document.querySelector('.message-assistant .tool-activity') && activeArticle===document.querySelector('.message-assistant');
      for(let i=0;i<2400 && !(document.querySelector('#send').title==='Send' && document.querySelector('.message-assistant .message-body')?.textContent.includes('const entry119 = 119'));i++) await pause();
      clearInterval(heartbeat);
      const longStream=document.querySelector('.message-assistant .message-body')?.textContent.includes('const entry119 = 119');
      await window.orion.deleteProvider(provider.id);
      stage('removing provider');
      const removed=!(await window.orion.listModels()).some(item=>item.source==='api');
      return {ok:document.querySelector('.version')?.textContent===${JSON.stringify(`Orion · ${expectedVersion}`)}&&discovered&&privateKey&&keptKey&&streamed&&reasoning&&tools&&done&&cancelled&&error&&removed&&longStream&&stablePanel&&maxStall<500,discovered,privateKey,keptKey,streamed,reasoning,tools,done,cancelled,error,removed,longStream,stablePanel,maxStall,captureState,toolPanelExists:!!toolPanel,articleStable:activeArticle===document.querySelector('.message-assistant'),bodyTail:document.querySelector('.message-assistant .message-body')?.textContent.slice(-100)};
    })()`);
    if (!result?.ok || !toolRoundTrip || requests < 4) throw new Error('API provider smoke check failed: '+JSON.stringify({result,toolRoundTrip,requests}));
    console.log('Packaged API provider UI, discovery, private keys, streaming, reasoning, tools, cancellation, errors, and removal passed.');
    console.log(`Long streamed code kept tool panels stable; largest renderer heartbeat gap: ${result.maxStall.toFixed(1)}ms.`);
    if (process.env.ORION_SMOKE_SCREENSHOT) {
      const screenshot = await new Promise(resolve => { const id = nextId++; pending.set(id, message => resolve(message.result?.data)); socket.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } })); });
      await writeFile(process.env.ORION_SMOKE_SCREENSHOT, Buffer.from(screenshot, 'base64'));
    }
  } finally { socket.close(); api.closeAllConnections(); await new Promise(resolve=>api.close(resolve)); }
}

async function verifyMemorySettingsAndShutdown(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => { const response = JSON.parse(String(event.data)); pending.get(response.id)?.(response); });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error('Memory/settings smoke check timed out')); }, 30000);
    pending.set(id, response => { clearTimeout(timer); pending.delete(id); if (response.error || response.result?.exceptionDetails) reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails))); else resolve(response.result?.result?.value); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  try {
    const result = await evaluate(`(async () => {
      const waitFor = async predicate => { for(let i=0;i<1200;i++){if(await predicate())return true;await new Promise(resolve=>setTimeout(resolve,25));}return false; };
      document.querySelector('.nav-item[data-view="Chat"]').click();
      const settings = await window.orion.settings(); settings.experimentalOfsMemory = true; settings.keepInTray = false;
      await window.orion.saveSettings(settings);
      await window.orion.saveConversation({id:'ofs-smoke',title:'OFS smoke',model:'no-model-needed',createdAt:Date.now(),updatedAt:Date.now(),messages:[{id:'ofs-smoke-message',role:'user',content:'I prefer model-free memory with no inference servers.',createdAt:Date.now()}]},true);
      const persisted = await waitFor(async()=> (await window.orion.listOFSMemories()).items.some(item=>item.sourceMessageId==='ofs-smoke-message'));
      const stats = await window.orion.memoryStats();
      document.querySelector('#settings-open').click();
      await waitFor(()=>document.querySelector('#settings-dialog').open);
      [...document.querySelectorAll('.settings-nav-item')].find(button=>button.textContent==='Memory & privacy').click();
      const memoryVisible = await waitFor(()=>document.querySelector('#memory-inspector-items').textContent.includes('model-free memory'));
      const modelFree = stats.engine === 'ofs' && stats.embeddingModel === null && stats.embeddedChunks === 0;
      document.querySelector('#settings-cancel').click();
      settings.experimentalOfsMemory = false; await window.orion.saveSettings(settings);
      document.querySelector('#settings-open').click(); await waitFor(()=>document.querySelector('#settings-dialog').open);
      const legacyVisible = await waitFor(()=>document.querySelector('#memory-inspector-stats').textContent.includes('Orion Memory'));
      document.querySelector('#settings-close').click();
      const context = getComputedStyle(document.querySelector('#context-window'));
      return {ok:persisted&&memoryVisible&&modelFree&&legacyVisible&&context.cursor==='pointer'&&parseFloat(context.borderTopWidth)>0,persisted,memoryVisible,memoryStatus:document.querySelector('#memory-inspector-status')?.textContent,memoryItems:document.querySelector('#memory-inspector-items')?.textContent,modelFree,legacyVisible,contextCursor:context.cursor,contextBorder:context.borderTopWidth};
    })()`);
    if (!result?.ok) throw new Error(`OFS/settings smoke check failed: ${JSON.stringify(result)}`);
    console.log('Model-free OFS worker, saved memory viewer, legacy statistics, and context control passed.');
    await evaluate(`setTimeout(()=>void window.orion.windowAction('close'),100); true`);
    const deadline = Date.now() + 20000;
    while (!childExit && Date.now() < deadline) await delay(50);
    if (!childExit || childExit.code !== 0) throw new Error(`Orion failed to fully exit with Keep in tray disabled: ${JSON.stringify(childExit)}`);
    console.log('Closing Orion with Keep in tray disabled exited the full application, including its hidden browser.');
  } finally { socket.close(); }
}

try {
  const page = await waitForRenderer();
  await verifySidebarToggle(page.webSocketDebuggerUrl);
  if (process.env.ORION_SMOKE_API_ONLY !== '1') await verifyModelsAndCreateViews(page.webSocketDebuggerUrl);
  await verifyApiProvider(page.webSocketDebuggerUrl);
  if (process.env.ORION_SMOKE_OLLAMA_MODEL) await verifyOllamaChat(page.webSocketDebuggerUrl, process.env.ORION_SMOKE_OLLAMA_MODEL);
  await verifyMemorySettingsAndShutdown(page.webSocketDebuggerUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (child.pid && !childExit) {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await Promise.race([once(killer, 'exit').catch(() => undefined), delay(5000)]);
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The process group may already have exited. */ }
      await Promise.race([once(child, 'exit').catch(() => undefined), delay(1000)]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The process group may already have exited. */ }
      await Promise.race([once(child, 'exit').catch(() => undefined), delay(3000)]);
      if (useWine) {
        const server = spawn('wineserver', ['-k'], { stdio: 'ignore' });
        await Promise.race([once(server, 'exit').catch(() => undefined), delay(5000)]);
      }
    }
  }
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}
