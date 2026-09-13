import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const port=18987;
const child=spawn(process.execPath,['control-server.mjs',String(port)],{stdio:['ignore','pipe','pipe']});
const output=[];
child.stdout.on('data',data=>output.push(String(data)));
child.stderr.on('data',data=>output.push(String(data)));
const base=`http://127.0.0.1:${port}`;
const waitForServer=async()=>{for(let i=0;i<50;i++){try{const response=await fetch(`${base}/api/v1/health`);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(output.join(''));};
const json=async(path,options={})=>{const response=await fetch(`${base}${path}`,options);return {status:response.status,body:await response.json()};};
try{
 await waitForServer();
 assert.equal((await json('/api/v1/health')).body.data.ready,false);
 const queued=await json('/api/v1/flight/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'move-1',type:'position',position:[10,20,30]})});
 assert.equal(queued.status,202);assert.equal(queued.body.data.status,'queued');
 const commands=await json('/api/v1/bridge/commands?after=0');assert.deepEqual(commands.body.data.commands[0].payload,{type:'position',position:[10,20,30]});
 await json('/api/v1/bridge/state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:{position:[10,20,30]},settings:{quality:'High'},routes:[{id:'valley'}]})});
 assert.deepEqual((await json('/api/v1/flight/state')).body.data.position,[10,20,30]);
 await json('/api/v1/bridge/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'move-1',sequence:1,response:{ok:true,data:{position:[10,20,30]}}})});
 assert.equal((await json('/api/v1/requests/move-1')).body.data.status,'completed');
 console.log('PASS control server');
}finally{child.kill();}
