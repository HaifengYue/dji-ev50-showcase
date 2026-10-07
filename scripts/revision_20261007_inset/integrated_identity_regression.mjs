/** Negative tests only: mutated copies live under the independent stage, never authored assets. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ROOT,STAGE,sha} from './integrated_identity_context.mjs';
const input=fs.readFileSync(path.join(STAGE,'xp4.glb'));
const size=input.readUInt32LE(12),baseDoc=JSON.parse(input.subarray(20,20+size));
const sourceTail=input.subarray(20+size);
function writeGlb(doc){const json=Buffer.from(JSON.stringify(doc)),padding=Buffer.alloc((-json.length)&3,0x20),chunk=Buffer.alloc(8),header=Buffer.from(input.subarray(0,12));chunk.writeUInt32LE(json.length+padding.length,0);chunk.writeUInt32LE(0x4e4f534a,4);header.writeUInt32LE(20+json.length+padding.length+sourceTail.length,8);return Buffer.concat([header,chunk,json,padding,sourceTail]);}
const tests=[
 {name:'primitive-material-drift',mutation:doc=>{doc.materials[0].pbrMetallicRoughness.roughnessFactor+=.01;},expected:/Serialized material changed/},
 {name:'critical-owner-trs-drift',mutation:doc=>{const n=doc.nodes.find(n=>n.name==='Composite_wing_L');n.translation=(n.translation??[0,0,0]).slice();n.translation[0]+=.000001;},expected:/serialized translation/},
 {name:'empty-alias-trs-drift',mutation:doc=>{const n=doc.nodes.find(n=>n.name==='WingLowerClosure_R');n.translation=(n.translation??[0,0,0]).slice();n.translation[1]+=.000001;},expected:/serialized translation/},
 {name:'animation-interpolation-drift',mutation:doc=>{doc.animations[0].samplers[0].interpolation='STEP';},expected:/Animation interpolation changed/},
 {name:'inherited-critical-exemption-removed',mutation:()=>{},reportMutation:report=>{report.quantization.float32PositionExceptions=report.quantization.float32PositionExceptions.filter(name=>name!=='Composite_wing_R');},expected:/Missing strict Float32 owner Composite_wing_R/},
];
const results=[];
for(const test of tests){
 const stage=path.join(STAGE,'identity-negative-fixtures',test.name);fs.mkdirSync(stage,{recursive:true});
 for(const name of ['xp4-source.glb','SOURCE_GEOMETRY_REFERENCE.json','v25-parent-validation.json','v25-parent-manifest.json'])fs.copyFileSync(path.join(STAGE,name),path.join(stage,name));
 const receipt=JSON.parse(fs.readFileSync(path.join(STAGE,'BAKE_RECEIPT.json'),'utf8'));
 for(const row of receipt.outputs)row.path=path.relative(ROOT,path.join(stage,path.basename(row.path)));
 fs.writeFileSync(path.join(stage,'BAKE_RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');
 const doc=structuredClone(baseDoc);test.mutation(doc);const runtime=writeGlb(doc);fs.writeFileSync(path.join(stage,'xp4.glb'),runtime);
 const report=JSON.parse(fs.readFileSync(path.join(STAGE,'model-validation.json'),'utf8'));report.runtimeBytes=runtime.length;test.reportMutation?.(report);
 fs.writeFileSync(path.join(stage,'model-validation.json'),JSON.stringify(report,null,2)+'\n');
 const child=spawnSync(process.execPath,[path.join(ROOT,'scripts/revision_20261007_inset/integrated_verify_source_runtime.mjs')],{cwd:ROOT,env:{...process.env,TRANSWING_INTEGRATED_STAGE:path.relative(ROOT,stage)},encoding:'utf8',timeout:120000});
 const output=child.stdout+child.stderr;fs.writeFileSync(path.join(stage,'expected-rejection.log'),output);
 assert.notEqual(child.status,0,'Mutated fixture unexpectedly accepted: '+test.name);assert.match(output,test.expected,'Mutation rejected for unexpected reason: '+test.name);
 results.push({test:test.name,passed:true,exitCode:child.status,expectedRejection:test.expected.source,mutatedRuntimeSha256:sha(runtime),log:path.relative(STAGE,path.join(stage,'expected-rejection.log')),temporaryFixtureAssetsRetained:false});
 // Keep rejection evidence, not duplicate source assets or deliberately invalid runtime models.
 for(const name of ['xp4-source.glb','xp4.glb','SOURCE_GEOMETRY_REFERENCE.json','v25-parent-validation.json','v25-parent-manifest.json','BAKE_RECEIPT.json','model-validation.json'])fs.unlinkSync(path.join(stage,name));
}
const result={passed:true,revision:27,scope:'Synthetic negative checks of current-stage copies only; no fixture grants model acceptance.',originalRuntimeSha256:sha(input),originalRuntimeUnchanged:sha(fs.readFileSync(path.join(STAGE,'xp4.glb')))===sha(input),tests:results};
assert.ok(result.originalRuntimeUnchanged);fs.writeFileSync(path.join(STAGE,'IDENTITY_NEGATIVE_TESTS.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
