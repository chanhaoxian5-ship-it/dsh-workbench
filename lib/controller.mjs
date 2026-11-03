import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const packageRoot = fileURLToPath(new URL('../',import.meta.url));
export const defaultDataDir = () => path.join(os.homedir(),'.dsh','storages','workbench');
const fail = code => Object.assign(new Error(code),{code});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

export class Controller {
  constructor(config={}) {
    const dataDir=config.dataDir||defaultDataDir();
    if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw fail('absolute_data_directory_required');
    this.dataDir=path.resolve(dataDir);
    this.pythonPath=config.pythonPath||'python';
    this.preferredPort=config.preferredPort||0;
    if(!path.isAbsolute(this.dataDir)||!Number.isInteger(this.preferredPort)||(this.preferredPort!==0&&(this.preferredPort<49152||this.preferredPort>65535)))throw fail('invalid_configuration');
    this.pending=Promise.resolve();
  }
  serial(fn){const task=this.pending.then(fn,fn);this.pending=task.catch(()=>{});return task;}
  environment(){
    const keep=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT','HOME','LANG']);
    return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>keep.has(key.toUpperCase()))),
      PYTHONPATH:path.join(packageRoot,'backend'),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
  }
  async endpoint(){
    const bytes=await fs.readFile(path.join(this.dataDir,'endpoint.json'));
    if(bytes.length>4096)throw fail('invalid_endpoint');
    const value=JSON.parse(bytes);
    if(!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value.api_base)||!/^[a-f0-9]{32}$/.test(value.instance_id))throw fail('invalid_endpoint');
    const port=Number(new URL(value.api_base).port);if(!Number.isInteger(port)||port<1||port>65535)throw fail('invalid_endpoint');
    return value;
  }
  async request(endpoint,method,route,body){
    const token=(await fs.readFile(path.join(this.dataDir,'api-token.txt'),'ascii')).trim();
    if(!/^[!-~]{32,}$/.test(token))throw fail('invalid_token_file');
    return new Promise((resolve,reject)=>{
      const payload=body===undefined?null:JSON.stringify(body);
      const req=http.request(new URL(route,endpoint.api_base),{method,timeout:2000,headers:{Authorization:'Bearer '+token,...(payload===null?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)})}},res=>{
        let bytes=0,parts=[];
        res.on('data',part=>{bytes+=part.length;if(bytes>65536){res.destroy();reject(fail('invalid_response'));}else parts.push(part);});
        res.on('error',()=>reject(fail('transport_error')));
        res.on('end',()=>{try{if(res.statusCode!==200)throw fail('service_rejected');resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(fail('invalid_response'));}});
      });
      req.on('timeout',()=>req.destroy());req.on('error',()=>reject(fail('service_unavailable')));
      if(payload!==null)req.write(payload);req.end();
    });
  }
  async status(){
    let endpoint;
    try{endpoint=await this.endpoint();}catch{return {status:'stopped',dataDir:this.dataDir,version:'0.2.0'};}
    try{
      const runtime=await this.request(endpoint,'GET','/v1/runtime');
      if(runtime.instance_id!==endpoint.instance_id||runtime.api_base!==endpoint.api_base)throw fail('instance_mismatch');
      return {...runtime,dataDir:this.dataDir};
    }catch{return {status:'unavailable',dataDir:this.dataDir,version:'0.2.0'};}
  }
  start(){return this.serial(()=>this.startInner());}
  stop(){return this.serial(()=>this.stopInner());}
  restart(){return this.serial(async()=>{await this.stopInner();return this.startInner();});}
  async startInner(){
    if((await this.status()).status==='running')return this.status();
    await fs.mkdir(this.dataDir,{recursive:true});
    const child=spawn(this.pythonPath,['-m','workbench.managed','--data-dir',this.dataDir,'--preferred-port',String(this.preferredPort)],{cwd:packageRoot,env:this.environment(),windowsHide:true,detached:true,stdio:'ignore'});
    let spawnError=false;child.on('error',()=>{spawnError=true;});child.unref();
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      if(spawnError)throw fail('python_unavailable');
      const status=await this.status();if(status.status==='running')return status;
      if(child.exitCode!==null&&child.exitCode!==0){await wait(120);if((await this.status()).status==='running')return this.status();throw fail('backend_start_failed');}
      await wait(80);
    }
    // Never kill a PID read from disk or a server with an unverified identity.
    if(child.exitCode===null)child.kill();
    throw fail('backend_start_timeout');
  }
  async stopInner(){
    const status=await this.status();
    if(status.status==='stopped')return status;
    if(status.status!=='running')throw fail('cannot_verify_owned_instance');
    const endpoint=await this.endpoint();
    if(endpoint.instance_id!==status.instance_id)throw fail('instance_changed');
    await this.request(endpoint,'POST','/v1/runtime/stop',{instance_id:status.instance_id});
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const now=await this.status();
      if(now.status==='stopped')return now;
      if(now.status==='running'&&now.instance_id!==status.instance_id)throw fail('instance_changed');
      await wait(80);
    }
    throw fail('backend_stop_timeout');
  }
  async launch(){
    const status=await this.status();if(status.status!=='running')throw fail('backend_not_running');
    return this.request(status,'POST','/v1/runtime/ticket',{instance_id:status.instance_id});
  }
  tool(name,args,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted)return reject(fail('cancelled'));
      const raw=JSON.stringify(args);if(Buffer.byteLength(raw)>262144)return reject(fail('payload_too_large'));
      const child=spawn(this.pythonPath,['-m','workbench.mcp','--data-dir',this.dataDir,'--call',name],{cwd:packageRoot,env:this.environment(),windowsHide:true,stdio:['pipe','pipe','ignore']});
      const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
      let bytes=0,parts=[];const timer=setTimeout(()=>child.kill(),60000);
      child.stdout.on('data',part=>{bytes+=part.length;if(bytes>4*1024*1024)child.kill();else parts.push(part);});
      child.stdin.on('error',()=>{});
      child.on('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(fail('python_unavailable'));});
      child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(code!==0||signal?.aborted||bytes>4*1024*1024)throw fail('tool_result_unconfirmed');resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(fail('tool_result_unconfirmed'));}});
      child.stdin.end(raw);
    });
  }
  mcpConfig(){return {mcpServers:{workbench:{command:this.pythonPath,args:[path.join(packageRoot,'scripts','mcp.py'),'--data-dir',this.dataDir]}}};}
}
