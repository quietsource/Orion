import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
// Keep renderer intermediates outside the application's release inputs.
const temporary = await mkdtemp(path.join(os.tmpdir(), 'orion-metal-icons-'));
const entry = path.join(temporary, 'capture.ts');
await writeFile(entry, `import { captureLiquidMetalStill } from ${JSON.stringify(path.join(root, 'src/renderer/welcomeArt.ts'))}; window.captureLiquidMetalStill = captureLiquidMetalStill;`);
const result = await Bun.build({ entrypoints: [entry], outdir: temporary, target: 'browser', minify: true });
if (!result.success) throw new Error(result.logs.join('\n'));
await writeFile(path.join(temporary, 'index.html'), '<!doctype html><html><body style="margin:0;background:transparent"><script type="module" src="./capture.js"></script></body></html>');
const helper = path.join(temporary, 'render.cjs');
await writeFile(helper, `
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'); const path=require('node:path');
app.whenReady().then(async()=>{try{
  const win=new BrowserWindow({show:false,width:1024,height:1024,transparent:true,webPreferences:{backgroundThrottling:false}});
  await win.loadFile(path.join(__dirname,'index.html'));
  const data=await win.webContents.executeJavaScript('window.captureLiquidMetalStill(2048,1.8)');
  const image=nativeImage.createFromDataURL(data),out=${JSON.stringify(path.join(root,'build/icons'))};
  if(image.isEmpty())throw Error('The icon render was empty');
  const bitmap=image.toBitmap();if(bitmap[3]!==0)throw Error('The icon background must be transparent');
  fs.writeFileSync(path.join(out,'orion-logo-source.png'),image.toPNG());
  const png=new Map();for(const size of [16,32,64,128,256,512,1024]){const bytes=image.resize({width:size,height:size,quality:'best'}).toPNG();png.set(size,bytes);fs.writeFileSync(path.join(out,'orion-'+size+'.png'),bytes);}
  fs.writeFileSync(path.join(out,'orion-512x512.png'),png.get(512));
  const sizes=[16,32,64,128,256],header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  sizes.forEach((size,index)=>{const entry=6+index*16,bytes=png.get(size);header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(bytes.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=bytes.length;});
  fs.writeFileSync(path.join(out,'orion.ico'),Buffer.concat([header,...sizes.map(size=>png.get(size))]));
  const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{const bytes=png.get(size),head=Buffer.alloc(8);head.write(type,0,'ascii');head.writeUInt32BE(bytes.length+8,4);return Buffer.concat([head,bytes]);});
  const icns=Buffer.alloc(8);icns.write('icns');icns.writeUInt32BE(8+chunks.reduce((total,chunk)=>total+chunk.length,0),4);fs.writeFileSync(path.join(out,'orion.icns'),Buffer.concat([icns,...chunks]));
  fs.writeFileSync(path.join(out,'orion.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Orion liquid metal</title><image width="1024" height="1024" href="data:image/png;base64,'+png.get(1024).toString('base64')+'"/></svg>');
  console.log('Generated transparent Orion liquid-metal PNG, ICO, ICNS and SVG assets.');win.destroy();app.quit();
}catch(error){console.error(error);app.exit(1);}});
`);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
await new Promise((resolve, reject) => {
  const child = spawn(electron, [helper], { env: environment, stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Icon renderer exited with ${code}`)));
});
