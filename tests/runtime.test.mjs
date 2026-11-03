import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {Controller,packageRoot} from '../lib/controller.mjs';

async function fixture(t,config={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wb-suite-'));
  const controller=new Controller({dataDir:path.join(root,'data'),...config});
  t.after(async()=>{await controller.stop().catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
  return {root,controller};
}
async function post(url,body,token){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});}

test('concurrent managers share one owned high-port service; restart persists data',async t=>{
  const {root,controller}=await fixture(t);
  const second=new Controller({dataDir:controller.dataDir});
  const [a,b]=await Promise.all([controller.start(),second.start()]);
  assert.equal(a.instance_id,b.instance_id);assert.equal(a.pid,b.pid);
  assert.ok(Number(new URL(a.api_base).port)>=49152);
  const project=path.join(root,'project');await fs.mkdir(project);await fs.writeFile(path.join(project,'PLAN.md'),'Synthetic fixture.');
  const envelope=(key,item)=>({schema_version:1,operation_key:key,expected_version:0,item});
  const request={schema_version:1,operation_key:'register-test',expected_version:0,workspace:{id:'test-space',name:'Synthetic workspace',root_path:project,kind:'project',view:'paper',status:'active',favorite:false,description:'Isolated test',is_test:true}};
  const saved=await controller.tool('workbench_publish_project',{collection:'workspaces',payload:request});
  assert.equal(saved.ok,true);assert.equal(saved.result.readback_confirmed,true);
  assert.equal((await controller.tool('workbench_publish_project',{collection:'workspaces',payload:request})).result.receipt_id,saved.result.receipt_id);
  const artifact=envelope('file-test',{id:'file-test',kind:'artifact',title:'Plan',archived:false,data:{relative_path:'PLAN.md',category:'document',description:'Synthetic source',expected_sha256:null}});
  assert.equal((await controller.tool('workbench_publish_project',{collection:'artifacts',workspace_id:'test-space',payload:artifact})).ok,true);
  const stage=envelope('stage-test',{id:'stage-test',kind:'stage',title:'Prepare',archived:false,data:{status:'unknown',date:null,summary:'Synthetic',refs:[{id:'file-test',kind:'artifact',role:'source',version:1}]}});
  assert.equal((await controller.tool('workbench_publish_project',{collection:'stages',workspace_id:'test-space',payload:stage})).ok,true);
  const after=await controller.restart();assert.notEqual(after.instance_id,a.instance_id);
  const read=await controller.tool('workbench_read',{path:'/v1/workspaces/test-space/stages/stage-test?version=1'});
  assert.equal(read.result.id,'stage-test');
  assert.equal((await controller.tool('workbench_read',{path:'/v1/search?q=中文&include_test=true'})).ok,true);
  const token=(await fs.readFile(path.join(controller.dataDir,'api-token.txt'),'utf8')).trim();
  assert.ok(!JSON.stringify(after).includes(token));assert.ok(!JSON.stringify(controller.mcpConfig()).includes(token));
});

test('occupied preferred port falls back to another high port without touching its listener',async t=>{
  const listener=net.createServer(socket=>socket.end());
  let reserved;
  for(let n=0;n<100;n++){const port=49152+Math.floor(Math.random()*16000);try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',()=>{listener.removeListener('error',reject);resolve();});});reserved=port;break;}catch{}}
  assert.ok(reserved);t.after(()=>new Promise(resolve=>listener.close(resolve)));
  const {controller}=await fixture(t,{preferredPort:reserved});
  const status=await controller.start();const port=Number(new URL(status.api_base).port);
  assert.ok(port>=49152);assert.notEqual(port,reserved);assert.equal(listener.listening,true);
});

test('browser ticket is single use; shutdown requires authentication and instance match',async t=>{
  const {controller}=await fixture(t);const status=await controller.start();const {url}=await controller.launch();
  const permanent=(await fs.readFile(path.join(controller.dataDir,'api-token.txt'),'utf8')).trim();
  assert.ok(!url.includes(permanent));assert.equal(new URL(url).search,'');
  const ticket=new URLSearchParams(new URL(url).hash.slice(1)).get('launch');
  let response=await post(status.api_base+'/v1/runtime/connect',{ticket});assert.equal(response.status,200);assert.equal((await response.json()).token,permanent);
  response=await post(status.api_base+'/v1/runtime/connect',{ticket});assert.equal(response.status,401);
  response=await post(status.api_base+'/v1/runtime/stop',{instance_id:status.instance_id});assert.equal(response.status,401);
  response=await post(status.api_base+'/v1/runtime/stop',{instance_id:'wrong'},permanent);assert.equal(response.status,409);
  assert.equal((await controller.status()).status,'running');
  const page=await fetch(status.api_base+'/');assert.equal(page.status,200);assert.ok((await page.text()).includes('/launch.js'));
  assert.equal((await fetch(status.api_base+'/launch.js')).status,200);
});

test('a mismatched endpoint identity cannot be stopped',async t=>{
  const {controller}=await fixture(t);await controller.start();
  const file=path.join(controller.dataDir,'endpoint.json'),raw=await fs.readFile(file,'utf8');
  await fs.writeFile(file,JSON.stringify({...JSON.parse(raw),instance_id:'0'.repeat(32)}));
  assert.equal((await controller.status()).status,'unavailable');
  await assert.rejects(controller.stop(),/cannot_verify_owned_instance/);
  await fs.writeFile(file,raw);assert.equal((await controller.status()).status,'running');
});

test('stdio MCP handshake, tools, offline status and URL rejection',async t=>{
  const {controller}=await fixture(t);
  const child=spawn(controller.pythonPath,[path.join(packageRoot,'scripts/mcp.py'),'--data-dir',controller.dataDir],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill());
  let buffer='',id=0;const pending=new Map();let stderr='';child.stderr.on('data',b=>stderr+=b);
  child.stdout.on('data',part=>{buffer+=part;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timeout=setTimeout(()=>reject(Error('MCP timeout '+stderr)),10000);pending.set(key,m=>{clearTimeout(timeout);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
  let response=await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(response.result.protocolVersion,'2024-11-05');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  response=await call('tools/list');assert.equal(response.result.tools.length,4);
  response=await call('tools/call',{name:'workbench_service_status',arguments:{}});assert.equal(JSON.parse(response.result.content[0].text).result.status,'stopped_or_unavailable');
  assert.equal((await controller.status()).status,'stopped');
  response=await call('tools/call',{name:'workbench_read',arguments:{path:'http://example.invalid/'}});assert.equal(response.result.isError,true);
  const first=await controller.start();
  response=await call('tools/call',{name:'workbench_read',arguments:{path:'/v1/capabilities'}});assert.equal(JSON.parse(response.result.content[0].text).result.database_version,3);
  const restarted=await controller.restart();assert.notEqual(first.instance_id,restarted.instance_id);
  response=await call('tools/call',{name:'workbench_service_status',arguments:{}});assert.equal(JSON.parse(response.result.content[0].text).result.instance_id,restarted.instance_id);
  assert.equal(stderr,'');child.stdin.end();
});
