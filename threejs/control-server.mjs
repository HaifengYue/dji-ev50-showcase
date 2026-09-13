/**
 * Loopback-only HTTP bridge for a local EV50 page.
 * The browser remains the owner of the Three.js scene; this process only
 * queues commands and relays telemetry. It intentionally has no auth and is
 * therefore suitable for local development, not a network deployment.
 */
import http from 'node:http';
import {randomUUID} from 'node:crypto';

const port=Number(process.env.EV50_CONTROL_PORT??process.argv[2]??8787);
const queue=[];
const requests=new Map();
const telemetryClients=new Set();
let sequence=0,lastSnapshot=null;
const routes=[{id:'valley',name:'山谷穿越 · 3 km'},{id:'plateau',name:'高原巡检 · 3 km'},{id:'ridge',name:'山脊环线 · 3 km'}];
const endpoints=['system.health','system.capabilities','flight.state','flight.command','flight.play','flight.pause','flight.resume','flight.reset','flight.seek','flight.speed','mission.list','mission.select','settings.get','settings.update'];

const send=(response,status,body)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});response.end(JSON.stringify(body));};
const failure=(response,status,code,message)=>send(response,status,{ok:false,error:{code,message}});
const readJson=request=>new Promise((resolve,reject)=>{
 let size=0,body='';
 request.on('data',chunk=>{size+=chunk.length;if(size>65536){reject(new Error('Request body exceeds 64 KB'));request.destroy();}else body+=chunk;});
 request.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch{reject(new Error('Malformed JSON'));}});
 request.on('error',reject);
});
const broadcast=payload=>{const message=`event: telemetry\ndata: ${JSON.stringify(payload)}\n\n`;for(const client of telemetryClients)client.write(message);};
const enqueue=(operation,payload,id=randomUUID())=>{
 const command={sequence:++sequence,id,operation,payload};
 queue.push(command);requests.set(id,{id,operation,status:'queued',queuedAt:new Date().toISOString()});
 if(queue.length>1000)queue.splice(0,queue.length-1000);
 return command;
};
const queueResponse=(response,operation,payload,id)=>{const command=enqueue(operation,payload,id);send(response,202,{ok:true,data:{id:command.id,operation,status:'queued',sequence:command.sequence}});};
const snapshotData=key=>lastSnapshot?.[key];

const server=http.createServer(async(request,response)=>{
 if(request.method==='OPTIONS'){response.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,OPTIONS','access-control-allow-headers':'content-type'});response.end();return;}
 const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`),{pathname}=url;
 try{
  if(request.method==='GET'&&pathname==='/api/v1/health')return send(response,200,{ok:true,data:{ready:Boolean(lastSnapshot),bridge:'http-poll',queued:queue.length}});
  if(request.method==='GET'&&pathname==='/api/v1/capabilities')return send(response,200,{ok:true,data:{transport:'http-poll',operations:endpoints}});
  if(request.method==='GET'&&pathname==='/api/v1/flight/state')return snapshotData('state')?send(response,200,{ok:true,data:snapshotData('state')}):failure(response,503,'NOT_READY','The browser page has not reported telemetry yet');
  if(request.method==='GET'&&pathname==='/api/v1/missions')return send(response,200,{ok:true,data:snapshotData('routes')??routes});
  if(request.method==='GET'&&pathname==='/api/v1/settings')return snapshotData('settings')?send(response,200,{ok:true,data:snapshotData('settings')}):failure(response,503,'NOT_READY','The browser page has not reported settings yet');
  if(request.method==='GET'&&pathname==='/api/v1/telemetry'){
   response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','access-control-allow-origin':'*'});response.write(': connected\n\n');telemetryClients.add(response);if(lastSnapshot)broadcast(lastSnapshot);request.on('close',()=>telemetryClients.delete(response));return;
  }
  if(request.method==='GET'&&pathname==='/api/v1/bridge/commands'){
   const after=Math.max(0,Number(url.searchParams.get('after')??0)||0);return send(response,200,{ok:true,data:{after,commands:queue.filter(command=>command.sequence>after)}});
  }
  if(request.method==='GET'&&pathname.startsWith('/api/v1/requests/')){
   const record=requests.get(decodeURIComponent(pathname.slice('/api/v1/requests/'.length)));return record?send(response,200,{ok:true,data:record}):failure(response,404,'REQUEST_NOT_FOUND','Unknown request id');
  }
  const body=await readJson(request);
  if(request.method==='POST'&&pathname==='/api/v1/flight/commands'){const {id,...command}=body;return queueResponse(response,'flight.command',command.payload??command.command??command,id);}
  for(const action of ['play','pause','resume','reset'])if(request.method==='POST'&&pathname===`/api/v1/flight/${action}`)return queueResponse(response,`flight.${action}`,undefined,body.id);
  if(request.method==='PUT'&&pathname==='/api/v1/flight/time')return queueResponse(response,'flight.seek',body,body.id);
  if(request.method==='PUT'&&pathname==='/api/v1/flight/speed')return queueResponse(response,'flight.speed',body,body.id);
  if(request.method==='PUT'&&pathname==='/api/v1/missions/current')return queueResponse(response,'mission.select',body,body.id);
  if(request.method==='PATCH'&&pathname==='/api/v1/settings')return queueResponse(response,'settings.update',body,body.id);
  if(request.method==='POST'&&pathname==='/api/v1/bridge/state'){
   lastSnapshot={...body,receivedAt:new Date().toISOString()};broadcast(lastSnapshot);return send(response,202,{ok:true});
  }
  if(request.method==='POST'&&pathname==='/api/v1/bridge/results'){
   const record=requests.get(body.id);if(record)requests.set(body.id,{...record,status:'completed',completedAt:new Date().toISOString(),response:body.response});return send(response,202,{ok:true});
  }
  return failure(response,404,'NOT_FOUND',`${request.method} ${pathname} is not an EV50 API endpoint`);
 }catch(error){return failure(response,400,'INVALID_REQUEST',error instanceof Error?error.message:String(error));}
});

server.listen(port,'127.0.0.1',()=>console.log(`EV50 control server listening at http://127.0.0.1:${port}`));
