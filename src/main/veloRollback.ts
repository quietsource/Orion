import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { app } from '../platform/nativeHost';
import { readEncryptedText, writeEncryptedText } from './secure-storage';
import type { Conversation } from '../shared/types';

type Ref = { messageId: string; revision: string; textHash: string };
type State = { refs: Ref[] };
type ConfigRef = { ref: string; label: string; createdAt: number; hash: string };
type PrivateConfigState = { refs: ConfigRef[] };
const uuid = /^[a-f0-9-]{36}$/i;

function rootFor(id: string) {
  if (!uuid.test(id)) throw Error('Invalid conversation reference.');
  return path.join(app.getPath('userData'), 'orion', 'rollback', id);
}
function binaryPath() {
  return path.join(app.getAppPath(), 'build', 'velo', process.platform === 'win32' ? 'velo.exe' : `velo-${process.platform}-${process.arch}`);
}
async function hasManagedVelo() { return fs.access(binaryPath()).then(() => true, () => false); }
function statePath(id: string) { return path.join(app.getPath('userData'), 'orion', 'rollback-state', `${id}.json.enc`); }

async function run(args: string[], cwd: string): Promise<string> {
  const binary = binaryPath();
  await fs.access(binary);
  const child = Bun.spawn([binary, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  if (code !== 0) throw Error(output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim().slice(-1200) || `Velo ${args[0]} failed.`);
  return output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

async function readState(id: string): Promise<State> {
  try { return JSON.parse(await readEncryptedText(statePath(id))) as State; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { refs: [] }; throw error; }
}
async function saveState(id: string, state: State) {
  await writeEncryptedText(statePath(id), JSON.stringify(state));
}

/** Velo stores only the already encrypted snapshot; no conversation text reaches its repository. */
export async function checkpointConversation(conversation: Conversation, messageId: string) {
  const at = conversation.messages.findIndex(message => message.id === messageId && message.role === 'user');
  if (at < 0) throw Error('The user message could not be checkpointed.');
  const snapshot: Conversation = { ...structuredClone(conversation), messages: structuredClone(conversation.messages.slice(0, at + 1)) };
  const root = rootFor(conversation.id), state = await readState(conversation.id);
  await fs.mkdir(root, { recursive: true });
  const dataFile = path.join(root, 'conversation.json.enc');
  const text = JSON.stringify(snapshot);
  const textHash = createHash('sha256').update(text).digest('hex');
  const latest = state.refs.at(-1);
  if (latest?.messageId === messageId && latest.textHash === textHash) return;
  let revision: string;
  if (await hasManagedVelo()) {
    if (!(await fs.access(path.join(root, '.velo')).then(() => true, () => false))) await run(['init', '--local'], root);
    await writeEncryptedText(dataFile, text);
    await run(['seal', '--local', 'Conversation checkpoint'], root);
    const veloState = JSON.parse(await fs.readFile(path.join(root, '.velo', 'state.json'), 'utf8')) as { oplog?: Array<{ action?: string; new_ref?: string }> };
    const sealed = [...(veloState.oplog ?? [])].reverse().find(item => item.action === 'seal' && /^[a-f0-9]{40}$/i.test(item.new_ref ?? ''))?.new_ref;
    if (!sealed) throw Error('Velo saved a checkpoint but did not return its revision.');
    revision = sealed;
  } else {
    revision = `local-${randomUUID()}`;
    const snapshots = path.join(app.getPath('userData'), 'orion', 'rollback-snapshots', conversation.id);
    await fs.mkdir(snapshots, { recursive: true });
    await writeEncryptedText(path.join(snapshots, `${revision}.enc`), text);
  }
  state.refs.push({ messageId, revision, textHash });
  await saveState(conversation.id, state);
}

export async function rollbackConversation(conversationId: string, messageId: string): Promise<Conversation> {
  const root = rootFor(conversationId), state = await readState(conversationId);
  let target = -1;
  for (let index = state.refs.length - 1; index >= 0; index--) if (state.refs[index]!.messageId === messageId) { target = index; break; }
  if (target < 0) throw Error('No Velo checkpoint exists for this message.');
  let text: string;
  if (state.refs[target]!.revision.startsWith('local-')) {
    text = await readEncryptedText(path.join(app.getPath('userData'), 'orion', 'rollback-snapshots', conversationId, `${state.refs[target]!.revision}.enc`));
  } else {
    await run(['restore', state.refs[target]!.revision, '--local'], root);
    text = await readEncryptedText(path.join(root, 'conversation.json.enc'));
  }
  const conversation = JSON.parse(text) as Conversation;
  if (conversation.id !== conversationId || !conversation.messages.some(message => message.id === messageId && message.role === 'user')) throw Error('The Velo checkpoint does not match this conversation.');
  state.refs = state.refs.slice(0, target + 1);
  await saveState(conversationId, state);
  return conversation;
}

export async function removeConversationRollback(conversationId: string) {
  const root = rootFor(conversationId), profile = path.join(app.getPath('userData'), 'orion');
  await Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(path.join(profile, 'rollback-state', `${conversationId}.json.enc`), { force: true }),
    fs.rm(path.join(profile, 'rollback-snapshots', conversationId), { recursive: true, force: true }),
  ]);
}

const configNames = new Set(['settings', 'tools']);
function configRoot(name: string) {
  if (!configNames.has(name)) throw Error('Unsupported private configuration history.');
  return path.join(app.getPath('userData'), 'orion', 'configuration-history', name);
}
function privateConfigStatePath(name:'settings'|'tools'){return path.join(app.getPath('userData'),'orion','rollback-state',`${name}-config.json.enc`);}
function privateConfigSnapshots(name:'settings'|'tools'){return path.join(app.getPath('userData'),'orion','rollback-snapshots',`${name}-config`);}
async function readPrivateConfigState(name:'settings'|'tools'):Promise<PrivateConfigState>{try{const state=JSON.parse(await readEncryptedText(privateConfigStatePath(name))) as PrivateConfigState;return Array.isArray(state.refs)?state:{refs:[]};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{refs:[]};throw error;}}
async function writePrivateConfigState(name:'settings'|'tools',state:PrivateConfigState){await writeEncryptedText(privateConfigStatePath(name),JSON.stringify(state));}

/** Velo receives only an already-encrypted configuration snapshot. */
export async function checkpointPrivateConfig(name: 'settings'|'tools', text: string) {
  const root=configRoot(name),dataFile=path.join(root,'snapshot.enc'),hash=createHash('sha256').update(text).digest('hex');
  if(!(await hasManagedVelo())){const state=await readPrivateConfigState(name);if(state.refs.at(-1)?.hash===hash)return;const ref=`local-${randomUUID()}`,createdAt=Date.now(),snapshots=privateConfigSnapshots(name);await fs.mkdir(snapshots,{recursive:true});await writeEncryptedText(path.join(snapshots,`${ref}.enc`),text);state.refs.push({ref,label:`${name==='settings'?'Settings':'Tool registry'} updated`,createdAt,hash});if(state.refs.length>100)state.refs.splice(0,state.refs.length-100);await writePrivateConfigState(name,state);return;}
  const prior=await readEncryptedText(dataFile).catch(()=>null);
  if(prior!==null&&prior!==undefined&&createHash('sha256').update(prior).digest('hex')===hash)return;
  await fs.mkdir(root,{recursive:true});
  if(!(await fs.access(path.join(root,'.velo')).then(()=>true,()=>false)))await run(['init','--local'],root);
  await writeEncryptedText(dataFile,text);
  await run(['seal','--local',`${name==='settings'?'Settings':'Tool registry'} updated`],root);
}

export async function listPrivateConfigHistory(name: 'settings'|'tools') {
  if(!(await hasManagedVelo()))return(await readPrivateConfigState(name)).refs.map(item=>({id:item.ref,ref:item.ref,label:item.label,createdAt:item.createdAt}));
  const root=configRoot(name);
  try {
    const state=JSON.parse(await fs.readFile(path.join(root,'.velo','state.json'),'utf8')) as {oplog?:Array<{action?:string;new_ref?:string;ref?:string;message?:string;created_at?:number;timestamp?:number}>};
    return (state.oplog??[]).filter(row=>row.action==='seal'&&/^[a-f0-9]{40}$/i.test(row.new_ref??row.ref??'')).map(row=>{const ref=row.new_ref??row.ref!;return{id:ref,ref,label:String(row.message??`${name} checkpoint`).slice(0,100),createdAt:Number(row.created_at??row.timestamp)||Date.now()};}).slice(-100);
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error; }
}

export async function restorePrivateConfig(name: 'settings'|'tools', revision: string) {
  if(revision.startsWith('local-')){const state=await readPrivateConfigState(name);if(!state.refs.some(item=>item.ref===revision))throw Error('Configuration checkpoint not found.');return readEncryptedText(path.join(privateConfigSnapshots(name),`${revision}.enc`));}
  if(!/^[a-f0-9]{40}$/i.test(revision))throw Error('Invalid Velo configuration revision.');
  const root=configRoot(name),history=await listPrivateConfigHistory(name);
  if(!history.some(item=>item.ref===revision))throw Error('Configuration checkpoint not found.');
  await run(['restore',revision,'--local'],root);
  return readEncryptedText(path.join(root,'snapshot.enc'));
}
