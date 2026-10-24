import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import type { McpServerConfig } from '../shared/types';

type McpJsonSchema = Record<string, unknown>;
type McpFunction = { type:'function'; function:{ name:string; description:string; parameters:McpJsonSchema } };
type Connected = { signature:string; client:Client; transport:StdioClientTransport|StreamableHTTPClientTransport; tools:Array<{name:string;description:string;inputSchema:McpJsonSchema}>; error?:string };

/** MCP tools are deliberately exposed to chat only. Belt never receives this manager. */
export class McpClientManager {
  private connected = new Map<string, Connected>();
  private status = new Map<string, {state:'connected'|'error'|'disabled';detail:string}>();
  private toolNames = new Map<string,{serverId:string;toolName:string}>();
  private syncQueue:Promise<void>=Promise.resolve();
  private closing=false;

  async sync(configs:McpServerConfig[], force=false) {
    if(this.closing)return configs.map(config=>({id:config.id,state:'disabled' as const,detail:'Orion is closing.',tools:[]}));
    const run=this.syncQueue.catch(()=>undefined).then(()=>this.syncNow(configs,force));
    this.syncQueue=run.then(()=>undefined,()=>undefined);
    return run;
  }

  private async syncNow(configs:McpServerConfig[],force:boolean) {
    const current = new Map(configs.map(config=>[config.id,config]));
    for(const [id,connection] of this.connected){const config=current.get(id),signature=config?JSON.stringify(config):'';if(!config||!config.enabled||force||connection.signature!==signature){await connection.client.close().catch(()=>undefined);this.connected.delete(id);}}
    for(const config of configs){
      if(!config.enabled){this.status.set(config.id,{state:'disabled',detail:'Disabled'});continue;}
      const signature=JSON.stringify(config),existing=this.connected.get(config.id);if(existing?.signature===signature){this.status.set(config.id,{state:'connected',detail:`Connected · ${existing.tools.length} tool(s)`});continue;}
      let client:Client|undefined;
      try{
        client=new Client({name:'Orion',version:'0.2.5'});
        let transport:StdioClientTransport|StreamableHTTPClientTransport;
        if(config.transport==='stdio'){
          if(!config.command?.trim())throw new Error('Choose a command for this local server.');
          const env=Object.fromEntries(Object.entries(config.env??{}).filter(([key,value])=>/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)&&typeof value==='string').slice(0,100));
          transport=new StdioClientTransport({command:config.command.trim(),args:(config.args??[]).slice(0,100),...(config.cwd?.trim()?{cwd:config.cwd.trim()}:{}),env,stderr:'ignore',maxBufferSize:2*1024*1024});
        }else{
          if(!config.url)throw new Error('Choose a Streamable HTTP endpoint.');
          const url=new URL(config.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('MCP endpoint must use HTTP(S) and cannot contain embedded credentials.');
          if(url.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname.replace(/^\[|\]$/g,'')))throw new Error('Remote MCP endpoints must use HTTPS.');
          const headers=Object.fromEntries(Object.entries(config.headers??{}).filter(([key,value])=>/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(key)&&typeof value==='string').slice(0,100));
          transport=new StreamableHTTPClientTransport(url,Object.keys(headers).length?{requestInit:{headers}}:{});
        }
        let timeout:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([client.connect(transport),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('MCP server connection timed out.')),15_000);timeout.unref?.();})]);}
        finally{if(timeout)clearTimeout(timeout);}
        const listed=await client.listTools();
        const tools=(listed.tools??[]).slice(0,100).map(tool=>{let schema=(tool.inputSchema&&typeof tool.inputSchema==='object'?tool.inputSchema:{type:'object',properties:{}}) as McpJsonSchema;try{if(JSON.stringify(schema).length>32_000)schema={type:'object',properties:{},additionalProperties:true};}catch{schema={type:'object',properties:{},additionalProperties:true};}return{name:String(tool.name).slice(0,200),description:String(tool.description??'').slice(0,2000),inputSchema:schema};});
        this.connected.set(config.id,{signature,client,transport,tools});this.status.set(config.id,{state:'connected',detail:`Connected · ${tools.length} tool(s)`});
      }catch(error){await client?.close().catch(()=>undefined);this.connected.delete(config.id);this.status.set(config.id,{state:'error',detail:error instanceof Error?error.message:String(error)});}
    }
    this.rebuildToolNames(configs);
    return configs.map(config=>({id:config.id,state:this.status.get(config.id)?.state??'disabled',detail:this.status.get(config.id)?.detail??'Disabled',tools:this.connected.get(config.id)?.tools.map(tool=>({name:tool.name,description:tool.description,enabled:(config.enabledTools??[]).includes(tool.name)}))??[]}));
  }

  private rebuildToolNames(configs:McpServerConfig[]){
    this.toolNames.clear();
    for(const config of configs){if(!config.enabled)continue;const connection=this.connected.get(config.id);if(!connection)continue;
      for(const tool of connection.tools){if(!(config.enabledTools??[]).includes(tool.name))continue;const prefix=config.id.replace(/-/g,'').slice(0,8),slug=tool.name.toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').slice(0,32)||'tool',suffix=createHash('sha256').update(tool.name).digest('hex').slice(0,6),name=`mcp_${prefix}_${slug}_${suffix}`;this.toolNames.set(name,{serverId:config.id,toolName:tool.name});}
    }
  }

  toolDefinitions(configs:McpServerConfig[]):McpFunction[]{
    this.rebuildToolNames(configs);const out:McpFunction[]=[];
    for(const [name,target] of this.toolNames){const config=configs.find(item=>item.id===target.serverId),tool=this.connected.get(target.serverId)?.tools.find(item=>item.name===target.toolName);if(!config||!tool)continue;out.push({type:'function',function:{name,description:`MCP server “${config.name}” tool “${tool.name}”. ${tool.description}`.slice(0,3500),parameters:tool.inputSchema}});}
    return out;
  }

  hasTool(name:string){return this.toolNames.has(name);}

  async callTool(name:string,input:Record<string,unknown>,configs:McpServerConfig[]){
    const target=this.toolNames.get(name);if(!target)throw new Error('This MCP tool is no longer enabled.');
    const config=configs.find(item=>item.id===target.serverId),connection=this.connected.get(target.serverId);
    if(!config?.enabled||!(config.enabledTools??[]).includes(target.toolName)||!connection)throw new Error('This MCP server or tool has been disabled.');
    if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>64_000)throw new Error('MCP tool arguments must be an object under 64 KB.');
    const result=await connection.client.callTool({name:target.toolName,arguments:input},undefined,{timeout:120_000,resetTimeoutOnProgress:true});
    const content=Array.isArray(result.content)?result.content:[];let remaining=190_000;const text=content.map((item:any)=>{if(remaining<=0)return'';const value=item.type==='text'?String(item.text):`[${String(item.type??'non-text')} MCP content omitted]`;const bounded=value.slice(0,remaining);remaining-=bounded.length;return bounded;}).filter(Boolean).join('\n');
    return{output:JSON.stringify({text,isError:result.isError===true}),success:result.isError!==true};
  }

  async close(){this.closing=true;await this.syncQueue.catch(()=>undefined);for(const connection of this.connected.values())await connection.client.close().catch(()=>undefined);this.connected.clear();this.toolNames.clear();}
}
