/** Pure adversarial coverage of four new finite material interfaces. Never loads a model. */
import assert from 'node:assert/strict';
import {nacelleSupportSpecifications} from './nacelle-support-additions.mjs';
import {reviewAdditionalFixedMaterialInterfaces,verifyFormalSupportCoordinateEvidence,MODEL_PATHS} from './support-coordinate-review.mjs';
import {verifiedReference} from './reference-records.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),encodings=['source','runtime'],union=bs=>[0,1,2].map(k=>[Math.min(...bs.map(b=>b[k][0])),Math.max(...bs.map(b=>b[k][1]))]);
export function runNacelleSupportAdditionSelftests(){let checks=0;const test=f=>{f();checks++;},prior=verifiedReference('previous-supports.json').data,bounds=verifiedReference('previous-support-bounds.json'),previousReference=verifiedReference('previous-accepted-reference.json').data,context={bounds:bounds.data,sha256:bounds.sha256,previousReference},c={sourceSha256:'a'.repeat(64),runtimeSha256:'b'.repeat(64)};
 function fixture(){const records=nacelleSupportSpecifications().map(spec=>{const base=prior.fixed.find(d=>d.id===spec.physicalLimitsFromFixedInterfaceId),oldUnion=union(encodings.map(e=>bounds.data.models.find(m=>m.encoding===e).fixed.find(r=>r.id===base.id).observedBounds)),padding=oldUnion.map((b,k)=>({lower:b[0]-base.min[k],upper:base.max[k]-b[1]})),evidence=Object.fromEntries(encodings.map(encoding=>{const bs=encoding==='source'?[[1,2],[3,4],[5,6]]:[[.9,2.2],[3,4],[5,6]],spanTriangleArea=.05;return [encoding,{modelSha256:c[encoding+'Sha256'],actualContactBounds:bs,sampleCount:6,spanTriangleArea,minimumContactArea:base.minimumContactArea,corePassed:true,surfaceContact:true,componentCoverage:spec.pair.map(mesh=>({mesh,component:0,meshComponentCount:1,contactSpanArea:.025,contactSamples:3})),finiteRegionValidation:{passed:true,badCount:0,coverage:[{index:0,samples:6,spanArea:spanTriangleArea,observedBounds:clone(bs)}]},requiredAcceptanceStage:'support'}];})),observedBoundsUnion=union(encodings.map(e=>evidence[e].actualContactBounds)),after={id:spec.id,pair:clone(spec.pair),frame:spec.frame,reason:spec.reason,min:observedBoundsUnion.map((b,k)=>b[0]-padding[k].lower),max:observedBoundsUnion.map((b,k)=>b[1]+padding[k].upper),minimumContactArea:base.minimumContactArea};return {id:spec.id,kind:'additional-fixed-material',supporting:true,collisionExemption:false,physicalLimitsFromFixedInterfaceId:spec.physicalLimitsFromFixedInterfaceId,previousSupportBoundsSha256:bounds.sha256,after,preservedPadding:padding,observedBoundsUnion,evidence};});return {wing:{supportInterfaceChanges:[],additionalFixedMaterialInterfaces:records},c:clone(c),context:clone(context)};}
 const current=f=>({...prior,fixed:[...prior.fixed,...f.wing.additionalFixedMaterialInterfaces.map(r=>clone(r.after))]}),run=f=>reviewAdditionalFixedMaterialInterfaces(prior,current(f),f.wing,f.c,f.context),formal=f=>({passed:true,contractReviewed:true,reports:encodings.map(encoding=>({source:MODEL_PATHS[encoding],sha256:c[encoding+'Sha256'],encodingTolerance:encoding==='source'?1e-6:6e-5,passed:true,rows:f.wing.additionalFixedMaterialInterfaces.map(r=>{const e=r.evidence[encoding];return {id:r.id,type:'fixed-material',passed:true,sameRigid:true,surfaceContact:true,pair:clone(r.after.pair),frame:r.after.frame,bad:[],unresolved:[],observedBounds:clone(e.actualContactBounds),sampleCount:e.sampleCount,spanTriangleArea:e.spanTriangleArea,componentCoverage:clone(e.componentCoverage),regionCoverage:e.finiteRegionValidation.coverage.map(({index,samples,spanArea})=>({index,samples,spanArea}))};})}))});
 test(()=>assert.equal(run(fixture()).additionalFixedMaterialInterfaceCount,4));
 test(()=>assert.equal(reviewAdditionalFixedMaterialInterfaces(prior,prior,{},c,null).additionalFixedMaterialInterfaceCount,0));
 test(()=>{const f=fixture();assert.equal(verifyFormalSupportCoordinateEvidence(formal(f),f.wing,c).additionalMeasuredInterfacesPerEncoding,4);});
 for(const mutate of [
  f=>f.wing.additionalFixedMaterialInterfaces.pop(),
  f=>{const r=clone(f.wing.additionalFixedMaterialInterfaces[0]);r.id='fixed:unapproved/fifth';r.after.id=r.id;f.wing.additionalFixedMaterialInterfaces.push(r);},
  f=>f.wing.additionalFixedMaterialInterfaces.push(clone(f.wing.additionalFixedMaterialInterfaces[0])),
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.minimumContactArea*=.9,
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.frame='Scene',
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.pair.reverse(),
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.maximumMaterialDepth=1,
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.inheritedFrom='old',
  f=>f.wing.additionalFixedMaterialInterfaces[0].inheritedFrom='old',
  f=>f.wing.additionalFixedMaterialInterfaces[0].collisionExemption=true,
  f=>f.wing.additionalFixedMaterialInterfaces[0].supporting=false,
  f=>f.wing.additionalFixedMaterialInterfaces[0].physicalLimitsFromFixedInterfaceId='fixed:Composite_wing_L/Nacelle_L_Front',
  f=>f.wing.additionalFixedMaterialInterfaces[0].previousSupportBoundsSha256='c'.repeat(64),
  f=>{const r=f.wing.additionalFixedMaterialInterfaces[0];r.preservedPadding[0].upper+=.000001;r.after.max[0]+=.000001;},
  f=>f.wing.additionalFixedMaterialInterfaces[0].after.min[0]-=.000001,
  f=>f.wing.additionalFixedMaterialInterfaces[0].observedBoundsUnion[0][1]-=.1,
  f=>delete f.wing.additionalFixedMaterialInterfaces[0].evidence.runtime,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.extra=clone(f.wing.additionalFixedMaterialInterfaces[0].evidence.source),
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.runtime.modelSha256='c'.repeat(64),
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.runtime.inheritedFrom='old',
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.discoveryFile='private.json',
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.corePassed=false,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.surfaceContact=false,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.sampleCount=2,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.spanTriangleArea=0,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.minimumContactArea=1e-12,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.requiredAcceptanceStage='development',
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.finiteRegionValidation.badCount=1,
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.finiteRegionValidation.coverage=[],
  f=>f.wing.additionalFixedMaterialInterfaces[0].evidence.source.componentCoverage[0].meshComponentCount=2,
  f=>f.context.sha256='c'.repeat(64),
  f=>f.context.bounds.models[1].fixed.pop(),
 ])test(()=>{const f=fixture();mutate(f);assert.throws(()=>run(f));});
 for(const mutate of [
  r=>r.reports[0].rows.pop(),r=>r.reports[0].rows[0].rerun=false,r=>r.reports[0].rows[0].inheritedFrom={modelSha256:c.sourceSha256},r=>r.reports[0].rows[0].sameRigid=false,r=>r.reports[0].rows[0].surfaceContact=false,r=>r.reports[0].rows[0].observedBounds[0][0]+=.000001,r=>r.reports[1].rows[0].componentCoverage[0].contactSamples++,r=>r.reports[1].rows[0].regionCoverage[0].samples++,r=>r.reports[1].rows[0].unresolved.push({reason:'unresolved'}),r=>r.reports[1].rows[0].bad.push({point:[0,0,0]}),
 ])test(()=>{const f=fixture(),r=formal(f);mutate(r);assert.throws(()=>verifyFormalSupportCoordinateEvidence(r,f.wing,c));});
 return {passed:true,checks,noModelsLoaded:true,newFiniteMaterialInterfaces:4,unchangedExistingMaterialThresholds:true,formalNewSupportMeasurementsRequired:true};
}
