// OFS runs in Bun, the same runtime used by the bundled service.
const result=await Bun.build({entrypoints:['src/main/ofsWorker.ts'],outdir:'dist/main',target:'bun'});
if(!result.success)throw Error(result.logs.join('\n'));
const {OFSClient}=await import('../src/main/ofsClient.ts');
const {mkdtemp}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
const root=await mkdtemp(path.join(os.tmpdir(),'orion-tauri-ofs-'));const client=new OFSClient({dbPath:path.join(root,'memory.sqlite'),maxContextTokens:8192,reservedOutputTokens:1024,memoryBudgetRatio:.25},path.resolve('dist/main/ofsWorker.js'));
try{await client.ingestTurn('user','I prefer TypeScript for local desktop applications.',{conversationId:'check',messageId:'check',createdAt:Date.now()});const snapshot=await client.exportSnapshot();if(!snapshot.memories.length)throw Error('OFS did not capture memory');console.log('PASS: Bun OFS worker captured '+snapshot.memories.length+' memories.');}finally{await client.close();}
