import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const temporary=[];
for(const name of ['terrain','flight']){
 const source=fs.readFileSync('src/'+name+'.ts','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./terrain'","'./.terrain-test-tmp.mjs'");
 const file='.'+name+'-test-tmp.mjs';temporary.push(file);fs.writeFileSync(file,js);
}
try{
 const {FlightController,routes}=await import('./.flight-test-tmp.mjs');
 const {obstacleCeiling,mountainHeight,AIRCRAFT_RADIUS,CLEARANCE}=await import('./.terrain-test-tmp.mjs');
 const frames=JSON.parse(fs.readFileSync('public/flight.json','utf8')).frames;
 const c=new FlightController(frames);c.mode='flight';c.loop=false;
 assert.equal(c.duration,240);c.seek(100);assert.equal(c.state,'CRUISE');
 const p=c.position.clone();c.playing=false;c.tick(5);assert(c.position.equals(p));
 c.playing=true;c.seek(239.9);c.tick(.2);assert.equal(c.time,240);assert.equal(c.playing,false);assert.equal(c.position.length(),0);
 c.loop=true;c.playing=true;c.seek(239.9);c.tick(.2);assert(Math.abs(c.time-.1)<1e-8);
 let vertices=0;
 for(let k=0;k<3;k++)for(let j=0;j<=72;j++)for(let i=0;i<=240;i++){
  const a=i*2*Math.PI/240,r=235+k*170+j*3.8;
  assert(mountainHeight(a,r,k)<=127);vertices++;
 }
 const report=[];
 for(const route of Object.keys(routes)){
  c.setRoute(route);let minClearance=Infinity,maxSpeed=0;let previous=null;
  for(let i=0;i<=240*60;i++){
   c.seek(i/60);assert(c.position.toArray().every(Number.isFinite));assert(Math.abs(c.quaternion.length()-1)<1e-6);
   const {x,y,z}=c.position;
   if(Math.hypot(x,z)>14){const gap=y-AIRCRAFT_RADIUS-obstacleCeiling(x,z);assert(gap>=CLEARANCE,route+' collision at '+c.time);minClearance=Math.min(minClearance,gap);}
   else assert(y>=0);
   if(previous)maxSpeed=Math.max(maxSpeed,c.position.distanceTo(previous)*60);
   previous=c.position.clone();
  }
  assert.equal(c.position.length(),0);c.restart();assert.equal(c.position.length(),0);
  c.mode='product';c.seek(100);assert.equal(c.position.length(),0);c.mode='flight';
  report.push({route,minClearance,maxSpeed,samples:14401});
 }
 c.applyCommand({type:'position',position:[0,40,0]});assert.equal(c.position.y,40);
 c.applyCommand({type:'velocity',velocity:[2,0,0]});c.tick(2);assert.equal(c.position.x,4);
 c.applyCommand({type:'position',position:[300,-10,0]});assert(c.position.y>=131);
 c.applyCommand({type:'attitude',quaternion:[0,0,0,1]});assert.equal(c.quaternion.w,1);
 c.applyCommand({type:'motor',lift:.7,cruise:.3});assert.equal(c.lift,.7);
 assert.throws(()=>c.applyCommand({type:'position',position:[NaN,0,0]}));
 c.setRoute('valley');assert.equal(c.position.length(),0);
 fs.writeFileSync('../docs/flight_tests.json',JSON.stringify({passed:true,mountainVertices:vertices,routes:report,checks:['terrain clearance at 60 Hz','route endpoints','pause','seek','loop','product origin','velocity integration','command clearance','invalid commands']},null,2));
 console.log('PASS',JSON.stringify(report));
}finally{temporary.forEach(f=>fs.unlinkSync(f));}
