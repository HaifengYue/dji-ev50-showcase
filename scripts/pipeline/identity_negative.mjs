/** Bounded adversarial checks: one generated fixture is reused; authored files are untouched. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {ROOT,STAGE} from './integrated_identity_context.mjs';
const target=path.join(STAGE,'negative-fixture');fs.mkdirSync(target,{recursive:true});
for(const name of ['xp4-source.glb','SOURCE_GEOMETRY_REFERENCE.json']){const dest=path.join(target,name);if(!fs.existsSync(dest))fs.symlinkSync(path.join(STAGE,name),dest);}
const original=fs.readFileSync(path.join(STAGE,'xp4.glb')),length=original.readUInt32LE(12),base=JSON.parse(original.subarray(20,20+length));
const report=JSON.parse(fs.readFileSync(path.join(STAGE,'model-validation.json'),'utf8'));
const receipt=JSON.parse(fs.readFileSync(path.join(STAGE,'BAKE_RECEIPT.json'),'utf8'));receipt.outputs=receipt.outputs.map(row=>({...row,path:path.relative(ROOT,path.join(target,path.basename(row.path)))}));fs.writeFileSync(path.join(target,'BAKE_RECEIPT.json'),JSON.stringify(receipt));
function encode(doc){const json=Buffer.from(JSON.stringify(doc)),pad=Buffer.alloc((-json.length)&3,0x20),chunk=Buffer.alloc(8),header=Buffer.from(original.subarray(0,12)),tail=original.subarray(20+length);chunk.writeUInt32LE(json.length+pad.length,0);chunk.writeUInt32LE(0x4e4f534a,4);header.writeUInt32LE(20+json.length+pad.length+tail.length,8);return Buffer.concat([header,chunk,json,pad,tail]);}
const checks=[
 ['material',doc=>{doc.materials[0].pbrMetallicRoughness.roughnessFactor+=.01;},/Serialized material changed/],
 ['critical-transform',doc=>{const n=doc.nodes.find(n=>n.name==='Composite_wing_L');n.translation=(n.translation??[0,0,0]).slice();n.translation[0]+=.000001;},/serialized translation/],
 ['alias-transform',doc=>{const n=doc.nodes.find(n=>n.name==='WingLowerClosure_R');n.translation=(n.translation??[0,0,0]).slice();n.translation[1]+=.000001;},/serialized translation/],
 ['animation-interpolation',doc=>{doc.animations[0].samplers[0].interpolation='STEP';},/Animation interpolation changed/],
 ['critical-policy',()=>{},/Missing strict Float32 owner Composite_wing_R/],
];const results=[];
for(const[name,mutate,expected]of checks){const doc=structuredClone(base),validation=structuredClone(report);mutate(doc);if(name==='critical-policy')validation.quantization.float32PositionExceptions=validation.quantization.float32PositionExceptions.filter(n=>n!=='Composite_wing_R');const mutated=encode(doc);validation.runtimeBytes=mutated.length;fs.writeFileSync(path.join(target,'xp4.glb'),mutated);fs.writeFileSync(path.join(target,'model-validation.json'),JSON.stringify(validation));const run=spawnSync(process.execPath,['scripts/pipeline/integrated_verify_source_runtime.mjs'],{cwd:ROOT,env:{...process.env,TRANSWING_INTEGRATED_STAGE:path.relative(ROOT,target)},encoding:'utf8'});assert.notEqual(run.status,0,name+' mutation was wrongly accepted');assert.match(run.stderr+run.stdout,expected,name+' failed for wrong reason');results.push({name,rejected:true});}
fs.writeFileSync(path.join(STAGE,'IDENTITY_NEGATIVE_CHECK.json'),JSON.stringify({passed:true,tests:results,authoredFilesModified:false},null,2));console.log(JSON.stringify(results));
