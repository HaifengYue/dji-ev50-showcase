/** Pure coordinate/provenance faults: no model load or material scan. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {compactSupportMeasurementEvidence,reviewSupportCoordinateChange,reviewSupportCoordinateChanges,verifyFormalSupportCoordinateEvidence,validatePreviousSupportBounds,translatedRegionDelta,unionBounds,MODEL_PATHS,PREVIOUS_SUPPORT_BOUNDS_SHA256} from './support-coordinate-review.mjs';
import {reviewLowerDriveDescription} from './layered-contract-logic.mjs';
import {verifiedReference} from './reference-records.mjs';
import {runNacelleSupportAdditionSelftests} from './nacelle-support-additions.selftest.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),encodings=['source','runtime'],c={sourceSha256:'a'.repeat(64),runtimeSha256:'b'.repeat(64)};
function fixture(multi=false){
 const region=(i=0)=>({min:[i*20,0,0],max:[i*20+10,10,10],cylinder:{center:[i*20+5,5,5],axis:[1,0,0],range:[-4,4],minimumRadius:.1,radius:8}}),before={id:'fixed:a/b',pair:['a','b'],frame:null,minimumContactArea:1e-12,...(multi?{regions:Array.from({length:4},(_,i)=>region(i))}:region())},delta=[3,-1,2],after=clone(before),rs=d=>d.regions??[d];
 for(const r of rs(after)){for(const key of ['min','max'])r[key]=r[key].map((v,k)=>v+delta[k]);r.cylinder.center=r.cylinder.center.map((v,k)=>v+delta[k]);}
 const oldRows={},evidence={};for(const encoding of encodings){const bs=rs(before).map(r=>r.min.map((v,k)=>[v+1+k*.1,v+8+k*.1])),nextBounds=bs.map(b=>b.map((p,k)=>p.map(v=>v+delta[k])));oldRows[encoding]={passed:true,observedBounds:unionBounds(bs),regionCoverage:bs.map((_,index)=>({index,samples:6,spanArea:1}))};evidence[encoding]={modelSha256:c[encoding+'Sha256'],actualContactBounds:unionBounds(nextBounds),sampleCount:6*bs.length,spanTriangleArea:1,minimumContactArea:before.minimumContactArea,corePassed:true,requiredAcceptanceStage:'support',finiteRegionValidation:{passed:true,badCount:0,coverage:nextBounds.map((observedBounds,index)=>({index,samples:6,spanArea:1,observedBounds}))}};}
 const u=unionBounds(encodings.map(e=>oldRows[e].observedBounds)),preservedPadding=multi?null:u.map((b,k)=>({lower:b[0]-before.min[k],upper:before.max[k]-b[1]})),change={id:before.id,before:clone(before),after:clone(after),preservedPadding,observedBoundsUnion:unionBounds(encodings.map(e=>evidence[e].actualContactBounds)),evidence};
 return {before,after,oldRows,change,c:clone(c),translation:multi?delta:undefined};
}
const run=f=>reviewSupportCoordinateChange(f.change,f.before,f.after,f.oldRows,f.c,f.translation);
const formal=f=>({passed:true,contractReviewed:true,reports:encodings.map(encoding=>{const e=f.change.evidence[encoding];return {source:MODEL_PATHS[encoding],sha256:c[encoding+'Sha256'],encodingTolerance:encoding==='source'?1e-6:6e-5,passed:true,rows:[{id:f.before.id,type:'fixed-material',passed:true,sameRigid:true,pair:f.after.pair,frame:f.after.frame,bad:[],unresolved:[],observedBounds:clone(e.actualContactBounds),sampleCount:e.sampleCount,spanTriangleArea:e.spanTriangleArea,regionCoverage:e.finiteRegionValidation.coverage.map(({index,samples,spanArea})=>({index,samples,spanArea}))}]};})});
export function runSupportCoordinateReviewSelftests(){let checks=0;const test=fn=>{fn();checks++;};
 test(()=>assert.equal(run(fixture()).method,'exact-previous-union-padding'));
 test(()=>assert.equal(run(fixture(true)).regions,4));
 const asymmetric=()=>{const f=fixture();f.oldRows.runtime.observedBounds[0][0]-=.25;for(const [encoding,end,offset]of [['source',0,-.5],['runtime',1,.5]]){f.change.evidence[encoding].actualContactBounds[0][end]+=offset;f.change.evidence[encoding].finiteRegionValidation.coverage[0].observedBounds[0][end]+=offset;}const old=unionBounds(encodings.map(e=>f.oldRows[e].observedBounds)),now=unionBounds(encodings.map(e=>f.change.evidence[e].actualContactBounds));f.change.preservedPadding=old.map((b,k)=>({lower:b[0]-f.before.min[k],upper:f.before.max[k]-b[1]}));f.change.observedBoundsUnion=now;f.after.min=now.map((b,k)=>b[0]-f.change.preservedPadding[k].lower);f.after.max=now.map((b,k)=>b[1]+f.change.preservedPadding[k].upper);f.change.after=clone(f.after);return f;};
 test(()=>assert.equal(run(asymmetric()).method,'exact-previous-union-padding'));
 test(()=>{const f=asymmetric();f.change.observedBoundsUnion=clone(f.change.evidence.source.actualContactBounds);f.after.max=f.change.observedBoundsUnion.map((b,k)=>b[1]+f.change.preservedPadding[k].upper);f.change.after=clone(f.after);assert.throws(()=>run(f));});
 test(()=>{const f=asymmetric();f.change.preservedPadding[0].lower=f.oldRows.source.observedBounds[0][0]-f.before.min[0];f.after.min[0]=f.change.observedBoundsUnion[0][0]-f.change.preservedPadding[0].lower;f.change.after=clone(f.after);assert.throws(()=>run(f));});
 for(const mutate of [
  f=>{f.after.max[0]+=.000001;f.change.after.max[0]+=.000001;},
  f=>{f.after.min[0]-=.000001;f.change.after.min[0]-=.000001;},
  f=>{f.change.preservedPadding[0].upper+=.000001;f.after.max[0]+=.000001;f.change.after.max[0]+=.000001;},
  f=>f.change.preservedPadding[0].lower+=.01,
  f=>f.change.evidence.source.modelSha256=c.runtimeSha256,
  f=>f.change.evidence.runtime.modelSha256='f'.repeat(64),
  f=>delete f.change.evidence.runtime,
  f=>f.change.evidence.extra=clone(f.change.evidence.source),
  f=>f.change.observedBoundsUnion[0][0]-=.01,
  f=>f.change.evidence.source.actualContactBounds[0][0]-=.01,
  f=>f.change.evidence.source.finiteRegionValidation.coverage=[],
  f=>f.change.evidence.source.finiteRegionValidation.coverage[0].samples=2,
  f=>f.change.evidence.source.finiteRegionValidation.coverage[0].observedBounds[0][0]=-100,
  f=>f.change.evidence.source.corePassed=false,
  f=>f.change.evidence.source.requiredAcceptanceStage='development',
  f=>f.change.evidence.source.discoveryFile='unshipped.json',
  f=>f.change.evidence.source.discoverySha256='c'.repeat(64),
  f=>f.change.evidence.source.developmentProvenance={discoverySha256:'c'.repeat(64),acceptanceEvidence:true},
  f=>f.oldRows.source=null,
  f=>f.oldRows.runtime.observedBounds[0][0]=NaN,
  f=>{f.after.cylinder.radius+=.01;f.change.after.cylinder.radius+=.01;},
 ])test(()=>{const f=fixture();mutate(f);assert.throws(()=>run(f));});
 for(const mutate of [
  f=>{f.after.regions.pop();f.change.after.regions.pop();},
  f=>{f.after.regions[1].max[0]+=.001;f.change.after.regions[1].max[0]+=.001;},
  f=>{for(const k of ['min','max']){f.after.regions[1][k][0]+=.001;f.change.after.regions[1][k][0]+=.001;}},
  f=>{f.after.regions[2].cylinder.center[0]+=.001;f.change.after.regions[2].cylinder.center[0]+=.001;},
  f=>f.change.evidence.runtime.finiteRegionValidation.coverage.pop(),
  f=>f.oldRows.source.regionCoverage.pop(),
  f=>f.translation[0]+=.001,
  f=>f.translation=undefined,
 ])test(()=>{const f=fixture(true);mutate(f);assert.throws(()=>run(f));});
 test(()=>{const r=compactSupportMeasurementEvidence({evidence:{source:{discoveryFile:'private.json',discoverySha256:'c'.repeat(64),actualContactBounds:[[1,2],[3,4],[5,6]]}}});assert(!JSON.stringify(r).includes('private.json'));assert.equal(r.evidence.source.developmentProvenance.acceptanceEvidence,false);assert.equal(r.evidence.source.requiredAcceptanceStage,'support');});
 test(()=>{const f=fixture(),r=verifyFormalSupportCoordinateEvidence(formal(f),{supportInterfaceChanges:[f.change]},c);assert.equal(r.measuredChangedInterfacesPerEncoding,1);});
 for(const mutate of [
  r=>r.contractReviewed=false,r=>r.reports.pop(),r=>r.reports[1].source=MODEL_PATHS.source,
  r=>r.reports[0].sha256=c.runtimeSha256,r=>r.reports[0].rows=[],r=>r.reports[0].rows[0].rerun=false,
  r=>r.reports[0].rows[0].inheritedFrom={modelSha256:c.sourceSha256},r=>r.reports[0].rows[0].observedBounds[0][0]+=.000001,
  r=>r.reports[0].rows[0].regionCoverage[0].samples++,r=>r.reports[0].rows[0].spanTriangleArea+=.01,
  r=>r.reports[1].encodingTolerance=.001,
 ])test(()=>{const f=fixture(),r=formal(f);mutate(r);assert.throws(()=>verifyFormalSupportCoordinateEvidence(r,{supportInterfaceChanges:[f.change]},c));});
 const previous=verifiedReference('previous-accepted-reference.json'),prior=verifiedReference('previous-supports.json'),reference=verifiedReference('previous-support-bounds.json');
 test(()=>{assert.equal(reference.sha256,PREVIOUS_SUPPORT_BOUNDS_SHA256);assert.equal(validatePreviousSupportBounds(reference.data,previous.data,prior.data).source.size,238);});
 for(const mutate of [
  r=>r.provenance.rawReport.sha256='c'.repeat(64),r=>r.provenance.previousSupports.sha256='c'.repeat(64),
  r=>r.models[0].sha256='c'.repeat(64),r=>r.models[0].encoding='runtime',r=>r.models[1].fixed.pop(),
  r=>r.models[1].fixed[0].regionCoverage=[],r=>r.models[0].source=MODEL_PATHS.runtime,
 ])test(()=>{const r=clone(reference.data);mutate(r);assert.throws(()=>validatePreviousSupportBounds(r,previous.data,prior.data));});
 test(()=>{const n={layeredWingJoint:{newRightPivotBlender:[1.5,-1.4700000286102295,-.2199999988079071]}},design={rightPivotBlender:[1.5,-1.47,-.22]};assert.deepEqual(translatedRegionDelta('fixed:ControlFlexureFixed_L_Inboard/ControlHingeFixed_L_Inboard',previous.data,n,design),[.1499999761581421,0,-.1700000762939453]);assert.throws(()=>translatedRegionDelta('fixed:unapproved',previous.data,n,design));});
 test(()=>{const n={layeredWingJoint:{newRightPivotBlender:[1.50000001,-1.4700000286102295,-.2199999988079071]}};assert.throws(()=>translatedRegionDelta('fixed:ControlFlexureFixed_L_Inboard/ControlHingeFixed_L_Inboard',previous.data,n,{rightPivotBlender:[1.5,-1.47,-.22]}),/reviewed pivot/);});
 test(()=>{const f=fixture();assert.throws(()=>reviewSupportCoordinateChanges({fixed:[f.before]},{fixed:[f.after]},{supportInterfaceChanges:[]},c,{}));});
 const old=previous.data.manifest.internalDrive.layoutV22,next={...clone(old),reason:'低置固定布局保留；实际新翼侧球心与定长杆闭合重新决定滑架行程，不使用伸缩杆或虚假球心'},record={path:'internalDrive.layoutV22.reason',before:old.reason,after:next.reason};
 test(()=>assert.equal(reviewLowerDriveDescription(old,next,[record]).reviewedDescriptionChangeCount,1));
 test(()=>assert.equal(reviewLowerDriveDescription(old,old,[]).reviewedDescriptionChangeCount,0));
 for(const mutate of [
  a=>a.next.guideSpan[0]-=.01,a=>a.next.extra='unknown',a=>delete a.next.frontSupportY,
  a=>a.next.reason+=' arbitrary',a=>a.changes=[],a=>a.changes[0].path='internalDrive.*',a=>a.changes.push(clone(record)),
 ])test(()=>{const a={next:clone(next),changes:[clone(record)]};mutate(a);assert.throws(()=>reviewLowerDriveDescription(old,a.next,a.changes));});
 const additionalMaterial=runNacelleSupportAdditionSelftests();return {passed:true,checks:checks+additionalMaterial.checks,coordinateChecks:checks,additionalMaterial,noModelsLoaded:true,formalCurrentSupportReportStillRequired:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=runSupportCoordinateReviewSelftests();if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(r,null,2)+'\n');console.log(r);}
