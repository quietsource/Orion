import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {connectOrion} from './cdp.mjs';
const executable=process.argv[2];if(!executable)throw Error('Pass packaged native host path');
const profile=await mkdtemp(path.join(os.tmpdir(),'orion-tauri-smoke-'));
const child=Bun.spawn([executable],{env:{...process.env,ORION_TAURI_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9224'},stdout:'inherit',stderr:'inherit'});
let client;
try{
 for(let i=0;i<60;i++){try{client=await connectOrion();break;}catch{await Bun.sleep(500);}}
 if(!client)throw Error('Native window did not start');
 console.log(await client.evaluate('(async()=>({settings:await window.orion.settings(),conversations:await window.orion.listConversations(),voice:await window.orion.voice.state(),memory:await window.orion.memoryStats()}))()'));
 await client.evaluate("window.orion.windowAction('close')");
 const exit=await Promise.race([child.exited,Bun.sleep(20000).then(()=>{throw Error('Shutdown timed out')})]);
 if(exit!==0)throw Error('Native app exited with error '+exit);
 console.log('PASS: packaged Tauri start, API and graceful shutdown.');
}finally{client?.close();if(child.exitCode===null)child.kill();}
