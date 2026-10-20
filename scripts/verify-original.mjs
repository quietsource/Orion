import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';
const root=path.resolve(import.meta.dir,'../..'), baseline=JSON.parse(await readFile(new URL('../.migration/source-baseline.json',import.meta.url),'utf8'));
const changed=[];for(const item of baseline){try{const data=await readFile(path.join(root,item.path));if(createHash('sha256').update(data).digest('hex')!==item.sha256)changed.push(item.path);}catch{changed.push(item.path);}}
if(changed.length)throw Error('Original source changed: '+changed.join(', '));console.log(`Verified all ${baseline.length} original source/assets remain unchanged.`);
