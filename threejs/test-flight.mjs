import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync('src/flight.ts','utf8'),js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
fs.writeFileSync('.flight-test-tmp.mjs',js);
try{const {FlightController}=await import('./.flight-test-tmp.mjs');const frames=JSON.parse(fs.readFileSync('public/flight.json','utf8')).frames;
 const c=new FlightController(frames);c.mode='flight';c.playing=true;c.loop=false;
 c.seek(25);assert.equal(c.state,'CRUISE');assert.equal(c.lift,0);assert.equal(c.cruise,1);
 const p=c.position.clone();c.playing=false;c.tick(5);assert(c.position.equals(p));assert.equal(c.time,25);
 c.playing=true;c.seek(59.9);c.tick(.2);assert.equal(c.time,60);assert.equal(c.playing,false);assert.equal(c.position.length(),0);
 c.loop=true;c.playing=true;c.seek(59.9);c.tick(.2);assert(Math.abs(c.time-.1)<1e-8);assert(c.playing);
 for(let j=0;j<200;j++){c.seek((j*13.79)%60);assert(c.position.toArray().every(Number.isFinite));assert(Math.abs(c.quaternion.length()-1)<1e-6);}
 c.restart();assert.equal(c.time,0);assert.equal(c.position.length(),0);c.mode='product';c.seek(25);assert.equal(c.position.length(),0);assert.equal(c.lift,0);
 fs.writeFileSync('../docs/flight_tests.json',JSON.stringify({passed:true,checks:['seek','pause','non-loop stop','loop wrap','200 deterministic seeks','unit quaternion','restart','static mode']},null,2));console.log('PASS: flight state, pause, seeking, loop, reset, static mode');
}finally{fs.unlinkSync('.flight-test-tmp.mjs');}
