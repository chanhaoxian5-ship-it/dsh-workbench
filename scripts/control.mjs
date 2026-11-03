import {Controller} from '../lib/controller.mjs';
const [action='status',...rest]=process.argv.slice(2);
const config={};
let projectDir;
for(let i=0;i<rest.length;i+=2){if(rest[i]==='--data-dir')config.dataDir=rest[i+1];else if(rest[i]==='--python')config.pythonPath=rest[i+1];else if(rest[i]==='--project-dir')projectDir=rest[i+1];else if(rest[i]==='--preferred-port')config.preferredPort=Number(rest[i+1]);else throw Error('Unknown option');}
if(!['status','start','stop','restart','mcpConfig'].includes(action))throw Error('Unknown action');
try{console.log(JSON.stringify(await new Controller(config)[action](...(action==='mcpConfig'?[projectDir]:[]))));}catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code||'control_failed'}}));process.exitCode=1;}
