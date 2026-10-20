import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
const child=Bun.spawn(['bun','scripts/check-conversation-history.ts'],{stdin:'pipe',stdout:'pipe',stderr:'inherit'});
const key=randomBytes(32).toString('base64');
const reader=createInterface({input:Readable.fromWeb(child.stdout)});
reader.on('line',line=>{try{const request=JSON.parse(line);if(request.type==='native'&&request.method==='storage-key'){child.stdin.write(JSON.stringify({type:'native-result',id:request.id,value:key})+'\n');return;}}catch{}console.log(line);});
process.exit(await child.exited);
