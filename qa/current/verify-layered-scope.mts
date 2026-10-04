/** The new wing edit is compared independently to the immediate accepted current model. */
import fs from 'node:fs';import assert from 'node:assert/strict';
import {captureModelReference,compareModelReference,digest} from './model-reference.mts';
import {verifiedReference} from './reference-records.mjs';
const reference=verifiedReference('previous-accepted-reference.json');
const acceptedSummary=verifiedReference('previous-accepted-summary.json');assert.equal(acceptedSummary.sha256,reference.data.acceptedSummarySha256);assert(acceptedSummary.data.passed&&acceptedSummary.data.stages.length===44&&acceptedSummary.data.stages.every(s=>s.exitCode===0));
assert.equal(reference.sha256,'eadb50535353fcf85ae8a518f23f5b81c3a869bd42f3c5df2a10b30a862f3cfd','Immediate accepted reference must not be regenerated from candidate');
const c=JSON.parse(fs.readFileSync('qa/contracts/layered-wing-refinement.json','utf8'));assert(c.reviewed);assert.equal(c.previousAcceptedReferenceSha256,reference.sha256);
const reports=[];
for(const [encoding,source]of [['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']]){
 const before=reference.data.models.find(m=>m.encoding===encoding),after=await captureModelReference(source),actual=compareModelReference(before,after),expected=c.previousChanges[encoding];
 assert.equal(after.modelSha256,c[encoding+'Sha256']);assert.deepEqual(actual,expected,'Exact independently reviewed current-change scope differs '+encoding);
 for(const field of ['addedNodes','removedNodes','parentChanges','materialChanges','visibilityChanges','typeChanges','animationStructureChanges','animationTimelineChanges'])assert.deepEqual(actual[field],[],field+' is outside the new wing shape/placement change');
 const map=new Map(before.nodes.map(n=>[n.name,n]));
 const wingDescendant=(name:string)=>{for(let n:any=map.get(name);n;n=map.get(n.parent))if(/^WingPivot_[LR]$/.test(n.name))return true;return false;};
 const permitted=(name:string)=>wingDescendant(name)||/^(Fixed_root_|Root|Brace)/.test(name)||(c.explicitDependentNodes??[]).some((n:any)=>n.name===name&&typeof n.reason==='string'&&n.reason.length>=20);
 for(const name of [...actual.geometryChanges,...actual.normalOnlyChanges,...actual.transformChanges,...actual.extrasChanges.map(x=>x.name),...actual.animationChanges.map(x=>x.track.split('.')[0])])assert(permitted(name),'Unrelated immediate-baseline node changed: '+name);
 const unchanged=before.nodes.filter(n=>n.isMesh&&!actual.geometryChanges.includes(n.name)&&!actual.normalOnlyChanges.includes(n.name)).map(n=>n.name);
 reports.push({passed:true,encoding,source,sha256:after.modelSha256,previousModelSha256:before.modelSha256,nodeCount:after.nodeCount,meshCount:after.meshCount,actual,unchangedGeometryAndNormals:unchanged,changedGeometryIsNotMotionScope:true});
}
const r={passed:true,previousAcceptedReference:{path:reference.path,sha256:reference.sha256},contractSha256:digest(fs.readFileSync('qa/contracts/layered-wing-refinement.json')),reports,limitations:['Exact edit-scope identity is independent of support, layer clearance and full-stroke collision acceptance','A locally unchanged mesh beneath a moved pivot is still motion-affected and cannot inherit collision pairs']};fs.writeFileSync(process.env.QA_OUT??'qa/current/layered-scope-report.json',JSON.stringify(r,null,2)+'\n');console.log({passed:true,reports:reports.map(r=>({encoding:r.encoding,geometryChanges:r.actual.geometryChanges.length,transforms:r.actual.transformChanges.length}))});
