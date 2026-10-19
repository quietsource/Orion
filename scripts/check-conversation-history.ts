import { app } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { MemoryHistory } from "../src/main/memoryHistory";
import { OFSClient } from "../src/main/ofsClient";
import { initializeSecureStorage } from "../src/main/secure-storage";
import type { Conversation } from "../src/shared/types";

void app.whenReady().then(async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"orion-history-check-"));
  let history: MemoryHistory | undefined, base: OFSClient | undefined;
  try {
    await initializeSecureStorage(path.join(root,"secure"));
    const worker=path.join(process.cwd(),"dist/main/ofsWorker.js");
    const engine=(name:string)=>new OFSClient({dbPath:path.join(root,`${name}.sqlite`),maxContextTokens:8192,reservedOutputTokens:1024,memoryBudgetRatio:.25},worker);
    base=engine("base");
    const first=randomUUID(), second=randomUUID(), oldFile=`${randomUUID()}.png`, usedFile=`${randomUUID()}.png`, recentFile=`${randomUUID()}.png`;
    const conversations:Conversation[]=[first,second].map((id,i)=>({id,title:`Synthetic ${i}`,model:"orion-gguf:test",createdAt:1,updatedAt:1,messages:[{id:randomUUID(),role:"user",content:i?"I live in Seattle and use Rust for my projects.":"I live in Portland and prefer TypeScript for my projects.",createdAt:1}]}));
    conversations[0]!.messages[0]!.attachments=[{id:usedFile.slice(0,-4),name:"synthetic.png",mimeType:"image/png",kind:"image"}];
    const attachmentDirectory=path.join(root,"attachments");await fs.mkdir(attachmentDirectory);
    for(const file of [oldFile,usedFile,recentFile])await fs.writeFile(path.join(attachmentDirectory,file),"synthetic");
    for(const file of [oldFile,usedFile])await fs.utimes(path.join(attachmentDirectory,file),new Date(0),new Date(0));
    let busy=false;
    history=new MemoryHistory({directory:path.join(root,"history"),attachmentDirectory,readConversations:async()=>structuredClone(conversations),saveConversation:async value=>{const index=conversations.findIndex(item=>item.id===value.id);if(index<0)conversations.push(structuredClone(value));else conversations[index]=structuredClone(value);},baseEngine:async()=>base!,createEngine:async id=>({client:engine(id),fresh:true}),busy:()=>busy});
    for(const conversation of conversations)for(const message of conversation.messages)await base.ingestTurn("user",message.content,{conversationId:conversation.id,messageId:message.id,createdAt:1});
    const snapshot=await base.exportSnapshot();const own=snapshot.memories.filter(row=>row.conversation_id===first), other=snapshot.memories.filter(row=>row.conversation_id===second);assert(own.length&&other.length,"Synthetic ingestion must produce owned memories");
    const checkpoint=await history.checkpoint(first,"Synthetic checkpoint");
    const branch=await history.branch(checkpoint.id,"Synthetic branch");
    const preview=await history.cleanupPreview(first);assert.deepEqual(preview.attachments.map(item=>item.id),[oldFile]);
    const empty={memoryIds:[],checkpointIds:[],assumptionIds:[],canvasIds:[],attachmentIds:[]} as {memoryIds:string[];checkpointIds:string[];assumptionIds:string[];canvasIds:string[];attachmentIds:string[]};
    await assert.rejects(history.cleanup(first,{...empty,memoryIds:[String(other[0]!.id)]}),/changed/);
    busy=true;await assert.rejects(history.cleanup(first,{...empty,memoryIds:[String(own[0]!.id)]}),/generation/);busy=false;
    // A formerly unused attachment gains a live reference between preview and apply.
    conversations[1]!.messages[0]!.attachments=[{id:oldFile.slice(0,-4),name:"new-reference.png",mimeType:"image/png",kind:"image"}];
    await assert.rejects(history.cleanup(first,{...empty,attachmentIds:[oldFile]}),/changed/);
    conversations[1]!.messages[0]!.attachments=[];
    await history.cleanup(first,{...empty,memoryIds:[String(own[0]!.id)],attachmentIds:[oldFile]});
    const after=await base.exportSnapshot();assert(!after.memories.some(row=>row.id===own[0]!.id));assert(after.memories.some(row=>row.id===other[0]!.id));
    assert((await (await history.engine(branch)).exportSnapshot()).memories.some(row=>row.id===own[0]!.id),"Branch retains independent memory snapshot");
    await assert.rejects(fs.stat(path.join(attachmentDirectory,oldFile)),{code:"ENOENT"});await fs.stat(path.join(attachmentDirectory,usedFile));await fs.stat(path.join(attachmentDirectory,recentFile));
    const packet=await history.packet(first);assert.deepEqual(packet.canvasIds,[]);
    await assert.rejects(history.carry(first,{...packet,model:"api:test:model"}),/local chat model/);
    const handoff=await history.carry(first,{...packet,model:"orion-gguf:test"});assert.equal(conversations.find(item=>item.id===handoff)?.localOnly,true);
    assert.equal((await (await history.engine(handoff)).exportSnapshot()).memories.length,0,"Handoff starts with no hidden copied memories");
    console.log("PASS: scoped cleanup, busy guard, cross-conversation rejection, stale cache revalidation, checkpoint/branch retention, recent-file protection and local handoff.");
  } finally {await history?.close();await base?.close();await fs.rm(root,{recursive:true,force:true});}
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
