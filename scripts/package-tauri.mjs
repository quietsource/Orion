import {mkdir,copyFile,readdir,readFile,writeFile,cp,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dir,'..');process.chdir(root);
const version=JSON.parse(await readFile('package.json','utf8')).version;
const bundles=process.platform==='win32'?'nsis':'deb,rpm,appimage';
const child=Bun.spawn(['bun','node_modules/@tauri-apps/cli/tauri.js','build','--bundles',bundles],{stdout:'inherit',stderr:'inherit'});
if(await child.exited!==0)throw Error('Native package build failed');
const destination=path.join(root,'release',version);await mkdir(destination,{recursive:true});
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await collect(file);else if(entry.name.includes(version)&&/\.(exe|deb|rpm|AppImage)$/.test(entry.name)){const name='Orion-Tauri_'+entry.name.replace(/^Orion[_-]/,'');await copyFile(file,path.join(destination,name));}}}
await collect('src-tauri/target/release/bundle');
if(process.platform==='win32'){
 const portable=path.join(root,'.migration','portable');await mkdir(portable,{recursive:true});
 for(const name of ['orion-tauri.exe','orion-service.exe'])await copyFile(path.join(root,'src-tauri/target/release',name),path.join(portable,name));
 await cp(path.join(root,'dist/main'),path.join(portable,'dist/main'),{recursive:true});
 await cp(path.join(root,'build/icons'),path.join(portable,'build/icons'),{recursive:true});
 await copyFile(path.join(root,'LICENSE'),path.join(portable,'LICENSE'));
 const archive=path.join(destination,`Orion-Tauri_${version}_windows-x64-portable.zip`);
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const zip=Bun.spawn(['powershell','-NoProfile','-Command',`Compress-Archive -Path ${quote(path.join(portable,'*'))} -DestinationPath ${quote(archive)} -Force`],{stdout:'inherit',stderr:'inherit'});
 if(await zip.exited!==0)throw Error('Portable ZIP packaging failed');
 const nsis=path.join(process.env.LOCALAPPDATA,'tauri/NSIS');
 const compiler=path.join(nsis,'makensis.exe');await access(compiler);
 const portableExe=path.join(destination,`Orion-Tauri_${version}_x64-portable.exe`);
 const script=path.join(root,'.migration','portable.nsi');
 const escape=value=>value.replaceAll('$','$$').replaceAll('"','$\\"');
 await writeFile(script,(await readFile(path.join(root,'build/portable.nsi.in'),'utf8')).replaceAll('@VERSION@',version).replaceAll('@OUTPUT@',escape(portableExe)).replaceAll('@ICON@',escape(path.join(root,'build/icons/orion.ico'))).replaceAll('@FILES@',escape(path.join(portable,'*'))));
 const portableBuild=Bun.spawn([compiler,'/V2',script],{env:{...process.env,NSISDIR:nsis},stdout:'inherit',stderr:'inherit'});
 if(await portableBuild.exited!==0)throw Error('Portable EXE packaging failed');
}
const hashes=[];for(const name of await readdir(destination)){if(name==='SHA256SUMS.txt')continue;const bytes=await readFile(path.join(destination,name));hashes.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);}
await writeFile(path.join(destination,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
await writeFile(path.join(destination,'SHA256SUMS'),hashes.join('\n')+'\n');
console.log('Native packages staged in '+destination);
