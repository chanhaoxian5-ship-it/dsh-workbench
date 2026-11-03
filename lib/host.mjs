import fs from 'node:fs/promises';
import {Controller} from './controller.mjs';
export function createHostPlugin({Remote,TypertRemoteService},defineTool){
// Equivalent of public @Remote method decoration for plain ESM (no TS build).
const initializers=[];
for(const method of ['status','start','stop','restart','launch','mcpConfig'])Remote(undefined,{kind:'method',name:method,static:false,private:false,addInitializer:fn=>initializers.push(fn)});
class WorkbenchService extends TypertRemoteService {
  constructor(ctx,config){super(ctx,'workbench');this.controller=new Controller(config);for(const fn of initializers)fn.call(this);}
  owner(){const caller=this.ctx.invocation?.peer?.principal;if(caller&&caller.kind!=='owner')throw Error('workbench: owner required');}
  async status(){this.owner();return this.controller.status();}
  async start(){this.owner();return this.controller.start();}
  async stop(){this.owner();return this.controller.stop();}
  async restart(){this.owner();return this.controller.restart();}
  async launch(){this.owner();return this.controller.launch();}
  async mcpConfig(){this.owner();return this.controller.mcpConfig();}
}

async function apply(ctx,config){
  const fork=ctx.plugin(WorkbenchService,config);await fork.await();
  const service=ctx.get('workbench');
  const tools=JSON.parse(await fs.readFile(new URL('./tools.json',import.meta.url),'utf8'));
  for(const tool of tools){
    const parameters=Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key,value])=>[key,{
      type:value.type,...(value.type==='object'?{additionalProperties:true}:{}),
      ...(value.enum?{enum:value.enum}:{}),...(tool.inputSchema.required?.includes(key)?{required:true}:{})
    }]));
    const dispose=ctx.tools.register(defineTool({name:tool.name,description:tool.description,parameters,
      output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      async execute(args,exec){try{return await service.controller.tool(tool.name,args,exec.signal);}catch(error){return {ok:false,error:{code:error.code||'unconfirmed',retryable:true}};}}
    }));
    if(typeof dispose==='function')ctx.effect(()=>dispose);
  }
  const dispose=ctx.skills.registerProvider(()=>({name:'workbench-suite',
    list:async()=>[{name:'workbench-agent-guide',description:'Use the local Workbench safely: inspect schema, publish source-grounded records, preserve operation keys and verify receipts.',provider:'workbench-suite',source:'bundled',rank:1000,invocation:{modelInvocable:true,userInvocable:true},locator:'workbench-agent-guide'}],
    get:async candidate=>candidate.name==='workbench-agent-guide'?{...candidate,content:await fs.readFile(new URL('../docs/AGENT_GUIDE.md',import.meta.url),'utf8')}:undefined
  }));
  if(typeof dispose==='function')ctx.effect(()=>dispose);
  if(config.autoStart)await service.start();
  // Backend remains available to other Agents after DSH unload. Stop is explicit.
}

return {WorkbenchService,apply};
}
