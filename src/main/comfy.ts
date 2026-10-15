import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { CreateProgress, InstalledModel, BackendState } from '../shared/types';

type ProgressSink=(progress:CreateProgress)=>void;
type Hardware={mode:'cuda'|'rocm'|'mps'|'cpu';label:string};
type ComfyHistoryEntry={outputs?:Record<string,{images?:Array<{filename:string;subfolder?:string;type?:string}>;videos?:Array<{filename:string;subfolder?:string;type?:string}>}>;status?:{status_str?:string;completed?:boolean;messages?:unknown[]}};
const isWindows=String(process.platform)==='win32';
const initialState=():BackendState=>({installed:false,running:false,firstEntrySeen:false,phase:'not-installed',detail:'',gpu:'Not checked'});
const execute=(command:string,args:string[],options:{cwd?:string;timeout?:number;onOutput?:(text:string)=>void;env?:NodeJS.ProcessEnv;input?:string}={})=>new Promise<{code:number;stdout:string;stderr:string}>((resolve,reject)=>{const child=spawn(command,args,{cwd:options.cwd,env:options.env,windowsHide:true,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});let stdout='',stderr='';if(options.input!==undefined)child.stdin?.end(options.input);const timer=setTimeout(()=>child.kill(),options.timeout??30000);child.stdout?.on('data',chunk=>{const text=chunk.toString();stdout=(stdout+text).slice(-16000);options.onOutput?.(text);});child.stderr?.on('data',chunk=>{const text=chunk.toString();stderr=(stderr+text).slice(-16000);options.onOutput?.(text);});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);resolve({code:code??-1,stdout,stderr});});});

/** Private, loopback-only ComfyUI runtime owned by Orion. */
export class ComfyManager {
  private child:ChildProcess|null=null;
  private state:BackendState=initialState();
  private initialized=false;
  private installTask:Promise<BackendState>|null=null;
  private readonly root:string;
  private readonly runtimeDir:string;
  private readonly comfyDir:string;
  private readonly statePath:string;
  private readonly uvPath:string;
  private readonly modelsDir:string;
  constructor(dataRoot:string,private readonly emit:ProgressSink){this.root=path.join(dataRoot,'orion');this.runtimeDir=path.join(this.root,'backends','comfyui');this.comfyDir=path.join(this.runtimeDir,'ComfyUI');this.statePath=path.join(this.runtimeDir,'state.json');this.uvPath=path.join(this.runtimeDir,'tools',isWindows?'uv.exe':'uv');this.modelsDir=path.join(this.root,'models');}
  private pythonPath(){return path.join(this.runtimeDir,'.venv',isWindows?'Scripts':'bin',isWindows?'python.exe':'python');}
  private mainPath(){return path.join(this.comfyDir,'main.py');}
  private send(id:string,phase:string,detail:string,percent?:number,extras:Partial<CreateProgress>={}){this.emit({id,phase,detail,...(percent===undefined?{}:{percent}),...extras});}
  private async saveState(){await fs.mkdir(path.dirname(this.statePath),{recursive:true});await fs.writeFile(this.statePath,JSON.stringify(this.state,null,2),{mode:0o600});}
  private async loadState(){try{this.state={...initialState(),...JSON.parse(await fs.readFile(this.statePath,'utf8'))};}catch{this.state=initialState();}this.state.installed=await fs.access(this.mainPath()).then(()=>true,()=>false);this.state.running=Boolean(this.child&&!this.child.killed);this.initialized=true;return this.state;}
  async isInstalled(){return fs.access(this.mainPath()).then(()=>true,()=>false);}
  private async hardware():Promise<Hardware>{if(process.platform==='darwin'){const profile=await execute('system_profiler',['SPDisplaysDataType'],{timeout:12000}).catch(()=>null);const name=profile?.stdout.match(/Chipset Model:\s*(.+)/)?.[1]?.trim();return{mode:'mps',label:name?`Apple Metal · ${name}`:'Apple Metal GPU'};}const nvidia=await execute(process.platform==='win32'?'nvidia-smi.exe':'nvidia-smi',['--query-gpu=name','--format=csv,noheader'],{timeout:8000}).catch(()=>null);if(nvidia?.code===0&&nvidia.stdout.trim())return{mode:'cuda',label:`NVIDIA ${nvidia.stdout.trim().split('\n')[0]}`};if(process.platform==='linux'){const rocm=await execute('rocminfo',[],{timeout:9000}).catch(()=>null);if(rocm?.code===0)return{mode:'rocm',label:'AMD ROCm GPU'};}return{mode:'cpu',label:'CPU inference (no supported accelerator detected)'};}
  private async ensureUv(id:string){
    await fs.mkdir(path.dirname(this.uvPath),{recursive:true});
    if(await fs.access(this.uvPath).then(()=>true,()=>false)){
      const existing=await execute(this.uvPath,['--version'],{cwd:this.runtimeDir,timeout:10000}).catch(error=>({code:-1,stdout:'',stderr:String(error)}));
      if(existing.code===0)return;
      await fs.rm(this.uvPath,{force:true});
    }
    this.send(id,'install-uv','Installing Orion’s private uv runtime manager',2);
    if(isWindows){
      const architecture=process.arch==='arm64'?'aarch64':'x86_64';
      const archive=path.join(this.runtimeDir,'tools',`uv-${architecture}-pc-windows-msvc.zip`);
      const unpacked=path.join(this.runtimeDir,'tools','uv-extracted');
      const response=await fetch(`https://github.com/astral-sh/uv/releases/latest/download/uv-${architecture}-pc-windows-msvc.zip`,{headers:{'user-agent':'Orion-Local-AI'},signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error(`Could not download Orion’s private uv runtime manager (${response.status}).`);
      await fs.writeFile(archive,Buffer.from(await response.arrayBuffer()),{mode:0o600});
      await fs.rm(unpacked,{recursive:true,force:true});await fs.mkdir(unpacked,{recursive:true});
      const extracted=await execute('tar.exe',['-xf',archive,'-C',unpacked],{cwd:this.runtimeDir,timeout:60000});
      if(extracted.code!==0){await fs.rm(archive,{force:true});await fs.rm(unpacked,{recursive:true,force:true});throw new Error(`Could not extract Orion’s private uv runtime manager: ${(extracted.stderr||extracted.stdout).slice(-1200)}`);}
      const candidates=[path.join(unpacked,'uv.exe'),path.join(unpacked,'uv','uv.exe')];let binary:string|undefined;
      for(const candidate of candidates)if(await fs.access(candidate).then(()=>true,()=>false)){binary=candidate;break;}
      if(!binary){await fs.rm(archive,{force:true});await fs.rm(unpacked,{recursive:true,force:true});throw new Error('The downloaded uv archive did not contain uv.exe.');}
      await fs.copyFile(binary,this.uvPath);await fs.rm(archive,{force:true});await fs.rm(unpacked,{recursive:true,force:true});
      const check=await execute(this.uvPath,['--version'],{cwd:this.runtimeDir,timeout:10000}).catch(error=>({code:-1,stdout:'',stderr:String(error)}));
      if(check.code!==0){await fs.rm(this.uvPath,{force:true});throw new Error(`Orion downloaded uv for ${architecture}, but Windows could not run it: ${(check.stderr||check.stdout||'unknown executable error').slice(-1200)}`);}
      return;
    }
    const url='https://astral.sh/uv/install.sh';
    const response=await fetch(url,{headers:{'user-agent':'Orion-Local-AI'},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Could not download the uv installer (${response.status}).`);
    const script=await response.text();const env={...process.env,UV_UNMANAGED_INSTALL:path.dirname(this.uvPath),UV_NO_MODIFY_PATH:'1'};
    const command='sh';const args=['-s'];
    const result=await execute(command,args,{cwd:this.runtimeDir,timeout:180000,env,input:script});
    if(result.code!==0)throw new Error(`Could not install uv: ${(result.stderr||result.stdout).slice(-1600)}`);
    const check=await execute(this.uvPath,['--version'],{cwd:this.runtimeDir,timeout:10000,env}).catch(()=>null);
    if(check?.code!==0)throw new Error('uv installation finished, but Orion could not run its private uv binary.');
  }
  async enter(){if(!this.initialized){await fs.mkdir(this.runtimeDir,{recursive:true});await this.loadState();}const showInstallPrompt=!this.state.firstEntrySeen&&!this.state.installed;this.state.firstEntrySeen=true;await this.saveState();if(this.state.installed){try{await this.start();}catch(error){this.state.detail=error instanceof Error?error.message:String(error);await this.saveState();}}return{state:this.state,showInstallPrompt};}
  async getState():Promise<BackendState>{return this.initialized?this.state:this.loadState();}
  async install():Promise<BackendState>{if(this.installTask)return this.installTask;this.installTask=this.installInternal().finally(()=>{this.installTask=null;});return this.installTask;}
  private async installInternal(){const id=randomUUID();try{const hw=await this.hardware();this.state.gpu=hw.label;this.state.phase='installing';this.state.detail=`Preparing headless ComfyUI for ${hw.label}`;await this.saveState();await fs.mkdir(this.runtimeDir,{recursive:true});await this.ensureUv(id);const env={...process.env,UV_PYTHON_INSTALL_DIR:path.join(this.runtimeDir,'python'),UV_PYTHON_BIN_DIR:path.join(this.runtimeDir,'python','bin'),UV_NO_MODIFY_PATH:'1'};this.send(id,'install-python','Installing Orion’s private Python 3.12 with uv',4);await this.runPackages(this.uvPath,['python','install','3.12'],id,'install-python','Installing managed Python 3.12',env);this.send(id,'create-environment','Creating ComfyUI’s private Python environment',8);const venv=path.join(this.runtimeDir,'.venv');const made=await execute(this.uvPath,['venv','--clear','--python','3.12',venv],{cwd:this.runtimeDir,timeout:180000,env});if(made.code!==0)throw new Error(`Could not create ComfyUI’s Python environment: ${(made.stderr||made.stdout).slice(-1600)}`);
      const archive=path.join(this.runtimeDir,'comfyui.tar.gz'),temp=path.join(this.runtimeDir,'ComfyUI.new');await fs.rm(temp,{recursive:true,force:true});await fs.mkdir(temp,{recursive:true});this.send(id,'download-comfyui','Downloading the official ComfyUI source',10);const tar=await fetch('https://github.com/Comfy-Org/ComfyUI/archive/refs/heads/master.tar.gz',{headers:{'user-agent':'Orion-Local-AI'},signal:AbortSignal.timeout(120000)});if(!tar.ok||!tar.body)throw new Error(`Could not download ComfyUI (${tar.status}).`);const archiveSize=Number(tar.headers.get('content-length')??0);const handle=await fs.open(archive,'w',0o600);let bytes=0;try{const reader=tar.body.getReader();while(true){const{value,done}=await reader.read();if(done)break;await handle.writeFile(value);bytes+=value.byteLength;this.send(id,'download-comfyui',`Downloading ComfyUI source · ${Math.round(bytes/1048576)} MB`,archiveSize?10+Math.min(3,bytes/archiveSize*3):undefined);}await handle.sync();}finally{await handle.close();}if(!bytes)throw new Error('ComfyUI source download was empty.');this.send(id,'extract-comfyui','Extracting ComfyUI source',14);const extracted=await execute('tar',['-xzf',archive,'-C',temp,'--strip-components=1'],{cwd:this.runtimeDir,timeout:180000});if(extracted.code!==0)throw new Error(`Could not extract ComfyUI: ${(extracted.stderr||extracted.stdout).slice(-1200)}`);await fs.rm(this.comfyDir,{recursive:true,force:true});await fs.rename(temp,this.comfyDir);await fs.rm(archive,{force:true});
      const py=this.pythonPath();let torchArgs=['pip','install','--python',py,'torch','torchvision','torchaudio'];if(hw.mode==='cuda')torchArgs.push('--index-url','https://download.pytorch.org/whl/cu130');else if(hw.mode==='rocm')torchArgs.push('--index-url','https://download.pytorch.org/whl/rocm7.2');this.send(id,'install-torch',`Installing PyTorch for ${hw.label}`,17);await this.runPackages(this.uvPath,torchArgs,id,'install-torch',`Installing PyTorch for ${hw.label}`,env);this.send(id,'install-comfyui','Installing ComfyUI requirements',58);await this.runPackages(this.uvPath,['pip','install','--python',py,'-r',path.join(this.comfyDir,'requirements.txt')],id,'install-comfyui','Installing ComfyUI requirements',env);await this.configureModels();this.state.installed=true;this.state.phase='installed';this.state.detail=`Headless ComfyUI is installed · ${hw.label}`;await this.saveState();this.send(id,'installed',this.state.detail,94);await this.start();this.send(id,'complete','ComfyUI is ready for local generation',100);return this.state;}catch(error){this.state.installed=await this.isInstalled();this.state.phase='error';this.state.detail=error instanceof Error?error.message:String(error);await this.saveState();this.send(id,'error',this.state.detail,undefined,{error:this.state.detail});throw error;}}
  private async runPackages(command:string,args:string[],id:string,phase:string,label:string,env:NodeJS.ProcessEnv){let output='',last=Date.now();const heartbeat=setInterval(()=>this.send(id,phase,`${label} · ${Math.floor((Date.now()-last)/1000)}s`),1500);try{const result=await execute(command,args,{cwd:this.runtimeDir,timeout:90*60_000,env,onOutput:text=>{output=(output+text).slice(-1000);last=Date.now();const line=output.split(/[\r\n]+/).filter(Boolean).at(-1);if(line)this.send(id,phase,`${label} · ${line.slice(-100)}`);}});if(result.code!==0)throw new Error(`${label} failed: ${(result.stderr||result.stdout).slice(-1800)}`);}finally{clearInterval(heartbeat);}}
  private async freePort(){return new Promise<number>((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=(server.address() as {port:number}).port;server.close(error=>error?reject(error):resolve(port));});});}
  private async configureModels(){const dirs=['checkpoints','diffusion_models','unet','text_encoders','clip','vae','loras','clip_vision'];for(const dir of dirs)await fs.mkdir(path.join(this.modelsDir,dir),{recursive:true});const base=this.modelsDir.replace(/\\/g,'/');const yaml=`orion:\n  base_path: ${JSON.stringify(base)}\n  checkpoints: checkpoints\n  diffusion_models: diffusion_models\n  unet: unet\n  text_encoders: text_encoders\n  clip: clip\n  vae: vae\n  loras: loras\n  clip_vision: clip_vision\n`;await fs.writeFile(path.join(this.comfyDir,'extra_model_paths.yaml'),yaml,{mode:0o600});}
  async start(){if(!this.initialized)await this.loadState();if(!this.state.installed)throw new Error('Install ComfyUI from the Create page before generating.');if(this.child&&!this.child.killed)return this.state;await this.configureModels();const port=await this.freePort(),env={...process.env,PYTHONUNBUFFERED:'1'};this.child=spawn(this.pythonPath(),[this.mainPath(),'--listen','127.0.0.1','--port',String(port),'--disable-auto-launch'],{cwd:this.comfyDir,env,windowsHide:true,stdio:'ignore'});this.child.once('exit',()=>{this.child=null;this.state.running=false;this.state.phase='stopped';this.state.detail='ComfyUI is stopped.';void this.saveState();});this.state.running=true;this.state.port=port;this.state.phase='starting';this.state.detail='Starting private headless ComfyUI';await this.saveState();const base=`http://127.0.0.1:${port}`,deadline=Date.now()+240000;while(Date.now()<deadline){if(!this.child||this.child.killed)break;const ready=await fetch(`${base}/system_stats`,{signal:AbortSignal.timeout(2500)}).then(r=>r.ok).catch(()=>false);if(ready){this.state.phase='ready';this.state.detail='Headless ComfyUI is ready';await this.saveState();return this.state;}await delay(1000);}throw new Error('ComfyUI did not become ready within four minutes. Review the GPU driver and private Python install, then retry.');}
  private baseUrl(){if(!this.state.port)throw new Error('ComfyUI is not running.');return`http://127.0.0.1:${this.state.port}`;}
  private async api(url:string,init:RequestInit={}){const response=await fetch(`${this.baseUrl()}${url}`,{...init,signal:AbortSignal.any([init.signal??new AbortController().signal,AbortSignal.timeout(30000)])});if(!response.ok)throw new Error(`ComfyUI request failed (${response.status}): ${(await response.text()).slice(0,900)}`);return response;}
  private executionError(entry:ComfyHistoryEntry){
    const details:string[]=[];
    for(const message of entry.status?.messages??[]){
      if(!Array.isArray(message)||message[0]!=='execution_error'||!message[1]||typeof message[1]!=='object')continue;
      const error=message[1] as {node_type?:unknown;node_id?:unknown;exception_message?:unknown;traceback?:unknown};
      const node=typeof error.node_type==='string'?error.node_type:typeof error.node_id==='string'?`node ${error.node_id}`:'ComfyUI node';
      const reason=typeof error.exception_message==='string'?error.exception_message.trim():'';
      if(reason)details.push(`${node}: ${reason}`);
      if(Array.isArray(error.traceback)){const useful=error.traceback.filter((line):line is string=>typeof line==='string').map(line=>line.trim()).filter(Boolean).slice(-3);if(useful.length)details.push(useful.join('\n'));}
    }
    return details.length?`ComfyUI generation failed. ${details.join('\n')}`:'ComfyUI reported an execution error, but did not provide diagnostic details.';
  }
  async generate(prompt:string,modelId:string,installed:InstalledModel[],progressId?:string,kind:'image'|'video'='image'){
    prompt=prompt.trim();if(!prompt||prompt.length>10000)throw new Error('Enter a prompt under 10,000 characters.');
    const selected=installed.find(item=>item.id===modelId&&item.category===kind);if(!selected)throw new Error(`Choose a downloaded ${kind} model first.`);
    await this.start();const id=progressId??randomUUID();let progressSocket:WebSocket|undefined;let samplerProgress:{value:number;max:number}|undefined;
    try{
      this.send(id,'queued',`Preparing your ${kind}`,5,{mediaType:kind});await this.configureModels();
      // ComfyUI streams sampler progress over its client-scoped websocket. Keep
      // this scoped to the generation job so the card can show real progress.
      const wsUrl=this.baseUrl().replace(/^http/,'ws');
      progressSocket=new WebSocket(`${wsUrl}/ws?clientId=${encodeURIComponent(id)}`);
      progressSocket.addEventListener('message',event=>{
        try{
          const message=JSON.parse(String(event.data)) as {type?:string;data?:{value?:number;max?:number}};
          const value=message.data?.value,max=message.data?.max;
          if(message.type==='progress'&&typeof value==='number'&&typeof max==='number'&&max>0)samplerProgress={value,max};
        }catch{/* Ignore non-JSON and binary websocket messages. */}
      });
      let graph:Record<string,{class_type:string;inputs:Record<string,unknown>}>;
      if(kind==='image'){
        if(!/\.(safetensors|ckpt)$/i.test(selected.file))throw new Error('The built-in ComfyUI image workflow needs a single .safetensors or .ckpt checkpoint.');
        const checkpoint=path.relative(path.join(this.modelsDir,'checkpoints'),path.resolve(this.modelsDir,selected.path)).split(path.sep).join('/');
        graph={
          '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:checkpoint}},
          '2':{class_type:'CLIPTextEncode',inputs:{text:prompt,clip:['1',1]}},
          '3':{class_type:'CLIPTextEncode',inputs:{text:'',clip:['1',1]}},
          '4':{class_type:'EmptyLatentImage',inputs:{width:1024,height:1024,batch_size:1}},
          '5':{class_type:'KSampler',inputs:{seed:Math.floor(Math.random()*2**32),steps:24,cfg:7,sampler_name:'euler',scheduler:'normal',denoise:1,model:['1',0],positive:['2',0],negative:['3',0],latent_image:['4',0]}},
          '6':{class_type:'VAEDecode',inputs:{samples:['5',0],vae:['1',2]}},
          '7':{class_type:'SaveImage',inputs:{filename_prefix:'Orion',images:['6',0]}}
        };
      }else{
        const bundle=selected.files??[selected.path];const textFile=bundle.find(file=>/text_encoders[\\/]umt5_xxl_fp8_e4m3fn_scaled\.safetensors$/i.test(file));const vaeFile=bundle.find(file=>/vae[\\/]wan(?:2\.2|_2\.1)_vae\.safetensors$/i.test(file));
        if(!/wan2\.2_ti2v_5b_fp16\.safetensors$/i.test(selected.file)||!textFile||!vaeFile)throw new Error('Orion’s built-in ComfyUI video workflow currently supports the Wan 2.2 TI2V 5B bundle. Select that model in the Video tab so Orion can install its diffusion model, text encoder, and VAE together.');
        const modelName=path.basename(selected.path),textName=path.basename(textFile),vaeName=path.basename(vaeFile);
        graph={
          '1':{class_type:'UNETLoader',inputs:{unet_name:modelName,weight_dtype:'default'}},
          '2':{class_type:'ModelSamplingSD3',inputs:{model:['1',0],shift:8}},
          '3':{class_type:'CLIPLoader',inputs:{clip_name:textName,type:'wan',device:'default'}},
          '4':{class_type:'VAELoader',inputs:{vae_name:vaeName}},
          '5':{class_type:'CLIPTextEncode',inputs:{text:prompt,clip:['3',0]}},
          '6':{class_type:'CLIPTextEncode',inputs:{text:'low quality, blurry, distorted motion, text, watermark',clip:['3',0]}},
          '7':{class_type:'Wan22ImageToVideoLatent',inputs:{width:832,height:480,length:41,batch_size:1,vae:['4',0]}},
          '8':{class_type:'KSampler',inputs:{seed:Math.floor(Math.random()*2**32),steps:20,cfg:5,sampler_name:'uni_pc',scheduler:'simple',denoise:1,model:['2',0],positive:['5',0],negative:['6',0],latent_image:['7',0]}},
          '9':{class_type:'VAEDecode',inputs:{samples:['8',0],vae:['4',0]}},
          '10':{class_type:'CreateVideo',inputs:{images:['9',0],fps:16}},
          '11':{class_type:'SaveVideo',inputs:{video:['10',0],filename_prefix:'Orion',format:'auto',codec:'auto'}}
        };
      }
      const queued=await this.api('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:graph,client_id:id})}).then(r=>r.json()) as {prompt_id?:string;node_errors?:Record<string,{errors?:Array<{type?:string;message?:string;details?:string}>}>};
      if(!queued.prompt_id){const issues=Object.entries(queued.node_errors??{}).flatMap(([node,detail])=>(detail.errors??[]).map(issue=>`node ${node}${issue.type?` (${issue.type})`:''}: ${issue.message??issue.details??'workflow rejected'}`));throw new Error(issues.length?`ComfyUI rejected the workflow. ${issues.join(' · ')}`:'ComfyUI rejected the workflow before it could start. Check that this model is compatible with the selected generation workflow.');}
      const deadline=Date.now()+40*60_000;let lastUpdate=0;
      while(Date.now()<deadline){
        const history=await this.api(`/history/${encodeURIComponent(queued.prompt_id)}`).then(r=>r.json()) as Record<string,ComfyHistoryEntry>;
        const result=history[queued.prompt_id];if(result?.status?.status_str==='error')throw new Error(this.executionError(result));
        if(result?.status?.completed){const outputs=Object.values(result.outputs??{});const files=kind==='video'?outputs.flatMap(output=>output.videos??[]):outputs.flatMap(output=>output.images??[]);const output=files.find(item=>item.type!=='temp')??files[0];if(!output)throw new Error(`ComfyUI finished, but returned no ${kind} output.`);const query=new URLSearchParams({filename:output.filename,subfolder:output.subfolder??'',type:output.type??'output'});const bytes=await(await this.api(`/view?${query}`)).arrayBuffer();const imagePath=path.join(this.root,'creations',`${id}${path.extname(output.filename)||(kind==='video'?'.mp4':'.png')}`);await fs.mkdir(path.dirname(imagePath),{recursive:true});await fs.writeFile(imagePath,Buffer.from(bytes),{mode:0o600});this.send(id,'complete',`${kind==='video'?'Video':'Image'} ready`,100,{imagePath,mediaType:kind});progressSocket.close();return{id,imagePath,mediaType:kind};}
        if(Date.now()-lastUpdate>1400){const percent=samplerProgress?5+Math.floor(Math.min(1,samplerProgress.value/samplerProgress.max)*94):5;this.send(id,'running',`ComfyUI is generating your ${kind}`,percent,{mediaType:kind});lastUpdate=Date.now();}await delay(1000);
      }
      throw new Error('ComfyUI generation exceeded 40 minutes.');
    }catch(error){progressSocket?.close();const message=error instanceof Error?error.message:String(error);this.send(id,'error',message,undefined,{error:message,mediaType:kind});throw error;}
  }
  async releaseModels(){
    if(!this.child||this.child.killed)return;
    try{await this.api('/free',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})});}
    catch(error){throw new Error(`ComfyUI could not release GPU memory before Orion resumes the chat model: ${error instanceof Error?error.message:String(error)}`);}
  }
  async stop(){this.child?.kill();this.child=null;this.state.running=false;this.state.phase='stopped';this.state.detail='ComfyUI is stopped.';await this.saveState();}
}
