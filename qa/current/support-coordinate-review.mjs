/** Exact old-padding reconciliation. Compact discovery records never replace the formal support gate. */
import assert from 'node:assert/strict';
import {assertFixedCoordinateOnly} from './fairing-support-roles.mjs';
import {reviewAdditionalNacelleSupportValues,verifyFormalAdditionalNacelleSupportEvidence} from './nacelle-support-additions.mjs';
export const PREVIOUS_SUPPORT_REPORT_SHA256='9b4df1a79cb7fbbfb0a1f377fda37a50e00e1e65df32d29baff276fc21047b8d';
export const PREVIOUS_SUPPORT_CONTRACT_SHA256='64cadf0b8fd862350b2ca8b4911ba05a12d05387e2aff9a3796b4760d599d013';
export const PREVIOUS_ACCEPTED_REFERENCE_SHA256='eadb50535353fcf85ae8a518f23f5b81c3a869bd42f3c5df2a10b30a862f3cfd';
export const PREVIOUS_SUPPORT_BOUNDS_SHA256='a880438f7cdcef2d5f5958b08e813683acff8a9afac84049e388f5089185337e';
export const MODEL_PATHS={source:'assets/blender/xp4-source.glb',runtime:'public/models/xp4.glb'};
const encodings=['source','runtime'],clone=x=>JSON.parse(JSON.stringify(x)),sort=x=>[...x].sort(),hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const regions=d=>d.regions??[d],unique=(rows,label)=>{assert(Array.isArray(rows),label);const map=new Map(rows.map(r=>[r.id,r]));assert.equal(map.size,rows.length,'Duplicate '+label);return map;};
function bounds(b,label){assert(Array.isArray(b)&&b.length===3&&b.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]<=p[1]),'Invalid observed bounds '+label);return b;}
export const unionBounds=bs=>[0,1,2].map(k=>[Math.min(...bs.map(b=>b[k][0])),Math.max(...bs.map(b=>b[k][1]))]);
function coverage(rows,count,label){assert(Array.isArray(rows)&&rows.length===count,'Incomplete region coverage '+label);for(let i=0;i<count;i++){const r=rows[i];assert.equal(r.index,i,'Region identity/order differs '+label);assert(Number.isSafeInteger(r.samples)&&r.samples>=3,'Missing material region '+label);assert(Number.isFinite(r.spanArea)&&r.spanArea>1e-12,'Degenerate material region '+label);}}
/** Keep only pathless development provenance; a nonexistent private file is never an acceptance dependency. */
export function compactSupportMeasurementEvidence(value){
 if(Array.isArray(value))return value.map(compactSupportMeasurementEvidence);if(!value||typeof value!=='object')return value;
 const out={};for(const [key,v]of Object.entries(value))if(!['discoveryFile','discoverySha256'].includes(key))out[key]=compactSupportMeasurementEvidence(v);
 if(value.discoverySha256){assert(hash(value.discoverySha256));out.developmentProvenance={discoverySha256:value.discoverySha256,acceptanceEvidence:false};out.requiredAcceptanceStage='support';}
 return out;
}
function currentEvidence(e,before,after,c,encoding){
 assert(e&&typeof e==='object','Missing '+encoding+' material measurement '+before.id);assert.equal(e.modelSha256,c[encoding+'Sha256'],'Wrong '+encoding+' model hash '+before.id);assert(hash(e.modelSha256));
 assert(!Object.hasOwn(e,'discoveryFile'),'Unshipped discovery paths are not reproducible evidence '+before.id);
 assert(!Object.hasOwn(e,'discoverySha256'),'Discovery digest must be marked as development provenance '+before.id);
 if(e.developmentProvenance){assert(hash(e.developmentProvenance.discoverySha256));assert.equal(e.developmentProvenance.acceptanceEvidence,false);}
 assert.equal(e.requiredAcceptanceStage,'support','Formal support acceptance required '+before.id);assert.equal(e.corePassed,true);assert.equal(e.minimumContactArea,before.minimumContactArea);
 assert(Number.isSafeInteger(e.sampleCount)&&e.sampleCount>=3);assert(Number.isFinite(e.spanTriangleArea)&&e.spanTriangleArea>=before.minimumContactArea);
 bounds(e.actualContactBounds,before.id);const v=e.finiteRegionValidation;assert(v&&v.passed===true&&v.badCount===0,'Unbounded actual material '+before.id);const rs=regions(after);coverage(v.coverage,rs.length,before.id);
 for(const [i,r]of v.coverage.entries()){bounds(r.observedBounds,before.id+' region '+i);const eps=encoding==='source'?1e-6:6e-5;for(let k=0;k<3;k++)assert(r.observedBounds[k][0]>=rs[i].min[k]-eps&&r.observedBounds[k][1]<=rs[i].max[k]+eps,'Region evidence exceeds exact finite box '+before.id);}
 assert.deepEqual(unionBounds(v.coverage.map(r=>r.observedBounds)),e.actualContactBounds,'Region evidence does not cover complete observed bounds '+before.id);
 // Original materialContact sampleCount is deduplicated; regionCoverage counts original samples.
 if(rs.length===1)assert.equal(v.coverage[0].spanArea,e.spanTriangleArea);
 return e.actualContactBounds;
}
/** The four reviewed multi-region rows retain every complete box and finite cylinder by one common translation. */
export function translatedRegionDelta(id,previousReference,manifest,reviewedDesign){
 const match=/^fixed:ControlFlexureFixed_([LR])_(Inboard|Outboard)\/ControlHingeFixed_\1_\2$/.exec(id);assert(match,'Only four explicit multi-region rebases are authorized: '+id);
 const name='WingPivot_'+match[1],oldPositions=encodings.map(encoding=>{const model=previousReference.models.find(m=>m.encoding===encoding),node=model?.nodes.find(n=>n.name===name);assert(node?.parent==='Scene');return node.position;});assert.deepEqual(oldPositions[0],oldPositions[1]);
 const nominal=reviewedDesign?.rightPivotBlender;assert(Array.isArray(nominal)&&nominal.length===3&&nominal.every(Number.isFinite),'Actual geometry gate must bind the reviewed nominal pivot');
 const b=manifest.layeredWingJoint.newRightPivotBlender;assert.deepEqual(b,nominal.map(Math.fround),'Decoded manifest pivot differs from the actual-geometry reviewed pivot');const current=[(match[1]==='L'?-1:1)*b[0],b[2],-b[1]];
 return oldPositions[0].map((v,k)=>v-current[k]);
}
export function validatePreviousSupportBounds(reference,previousReference,prior){
 assert.equal(reference.formatVersion,1);assert.equal(reference.provenance.rawReport.sha256,PREVIOUS_SUPPORT_REPORT_SHA256);assert.equal(reference.provenance.previousAcceptedReference.sha256,PREVIOUS_ACCEPTED_REFERENCE_SHA256);assert.equal(reference.provenance.previousSupports.sha256,PREVIOUS_SUPPORT_CONTRACT_SHA256);
 assert.deepEqual(reference.models.map(m=>m.encoding),encodings);const ids=sort(prior.fixed.map(r=>r.id));
 for(const m of reference.models){assert.equal(m.source,MODEL_PATHS[m.encoding]);assert.equal(m.sha256,previousReference.models.find(p=>p.encoding===m.encoding)?.modelSha256,'Stale baseline model');assert.equal(m.encodingTolerance,m.encoding==='source'?1e-6:6e-5);const rows=unique(m.fixed,'previous bounds');assert.deepEqual(sort([...rows.keys()]),ids,'Incomplete frozen fixed bounds');for(const d of prior.fixed){const r=rows.get(d.id);assert.equal(r.passed,true);bounds(r.observedBounds,d.id);coverage(r.regionCoverage,regions(d).length,d.id);}}
 return Object.fromEntries(reference.models.map(m=>[m.encoding,new Map(m.fixed.map(r=>[r.id,r]))]));
}
/** Pure single-record check, exported for synthetic fault regressions. */
export function reviewSupportCoordinateChange(change,before,after,oldRows,c,translation){
 assert.deepEqual(change.before,before);assert.deepEqual(change.after,after);assert.equal(change.id,before.id);assertFixedCoordinateOnly(before,after);
 assert.deepEqual(sort(Object.keys(change.evidence??{})),encodings.slice().sort(),'Both unique encoding measurements required');
 const currentUnion=unionBounds(encodings.map(e=>currentEvidence(change.evidence[e],before,after,c,e)));assert.deepEqual(change.observedBoundsUnion,currentUnion,'Current union must be recomputed from both observations');
 const rs=regions(before),ns=regions(after);for(const e of encodings){assert(oldRows[e]?.passed===true,'Missing prior measurement');bounds(oldRows[e].observedBounds,before.id);coverage(oldRows[e].regionCoverage,rs.length,before.id);}
 if(rs.length===1){
  const oldUnion=unionBounds(encodings.map(e=>oldRows[e].observedBounds)),padding=[0,1,2].map(k=>({lower:oldUnion[k][0]-rs[0].min[k],upper:rs[0].max[k]-oldUnion[k][1]}));assert(padding.every(p=>Number.isFinite(p.lower)&&Number.isFinite(p.upper)&&p.lower>=0&&p.upper>=0),'Prior padding must be finite nonnegative');
  assert.deepEqual(change.preservedPadding,padding,'Claimed old padding differs from frozen observed union');
  assert.deepEqual(ns[0].min,currentUnion.map((b,k)=>b[0]-padding[k].lower),'Lower finite bound changed original padding');assert.deepEqual(ns[0].max,currentUnion.map((b,k)=>b[1]+padding[k].upper),'Upper finite bound changed original padding');
  return {id:before.id,method:'exact-previous-union-padding',padding};
 }
 assert(Array.isArray(translation)&&translation.length===3&&translation.every(Number.isFinite),'Explicit multi-region frame translation required');assert.equal(change.preservedPadding,null,'Multi-region padding is preserved by exact region translation, not a fabricated aggregate padding');
 for(let i=0;i<rs.length;i++){for(const key of ['min','max'])assert.deepEqual(ns[i][key],rs[i][key].map((v,k)=>v+translation[k]),'Every old region endpoint must have the exact same translation');if(rs[i].cylinder)assert.deepEqual(ns[i].cylinder.center,rs[i].cylinder.center.map((v,k)=>v+translation[k]),'Finite cylinder center must follow the same region translation');}
 return {id:before.id,method:'exact-whole-region-translation',translation,regions:rs.length};
}
export function reviewSupportCoordinateChanges(prior,current,wing,c,context){
 const old=unique(prior.fixed,'previous fixed'),next=unique(current.fixed,'current fixed'),changes=unique(wing.supportInterfaceChanges??[],'support changes');
 const changed=[...next].filter(([id,d])=>old.has(id)&&JSON.stringify(d)!==JSON.stringify(old.get(id))).map(([id])=>id);assert.deepEqual(sort([...changes.keys()]),sort(changed),'Missing or extra exact support coordinate records');
 if(!changed.length)return {exactSupportCoordinatePaddingPreserved:true,supportCoordinateChangeCount:0,requiredSupportAcceptanceStage:'support',supportMaterialAcceptanceEstablished:false};
 assert(context?.bounds&&context.previousReference&&context.manifest,'Immutable previous bounds context required');assert.equal(context.sha256,PREVIOUS_SUPPORT_BOUNDS_SHA256,'Compact previous bounds byte identity changed');const oldRows=validatePreviousSupportBounds(context.bounds,context.previousReference,prior);
 const rows=changed.map(id=>reviewSupportCoordinateChange(changes.get(id),old.get(id),next.get(id),Object.fromEntries(encodings.map(e=>[e,oldRows[e].get(id)])),c,regions(old.get(id)).length>1?translatedRegionDelta(id,context.previousReference,context.manifest,wing.design):undefined));
 return {exactSupportCoordinatePaddingPreserved:true,supportCoordinateChangeCount:rows.length,singleRegionUnionPaddingCount:rows.filter(r=>r.method==='exact-previous-union-padding').length,exactTranslatedMultiRegionCount:rows.filter(r=>r.method==='exact-whole-region-translation').length,previousSupportBoundsSha256:context.sha256,requiredSupportAcceptanceStage:'support',supportMaterialAcceptanceEstablished:false};
}
/** Separate new material edges retain original saddle limits; historical direct fairing roles are unchanged. */
export function reviewAdditionalFixedMaterialInterfaces(prior,current,wing,c,context){
 const records=wing.additionalFixedMaterialInterfaces??[];if(!records.length)return reviewAdditionalNacelleSupportValues(prior,current,wing,c,null,null);
 assert(context?.bounds&&context.previousReference,'Immutable previous support observations required for additional material');assert.equal(context.sha256,PREVIOUS_SUPPORT_BOUNDS_SHA256);const oldRows=validatePreviousSupportBounds(context.bounds,context.previousReference,prior);return reviewAdditionalNacelleSupportValues(prior,current,wing,c,oldRows,context.sha256);
}
/** Final acceptance must replay the actual current material algorithm and match all compact measurements. */
export function verifyFormalSupportCoordinateEvidence(report,wing,c){
 assert(report?.passed===true&&report.contractReviewed===true,'Formal reviewed support report required');assert(Array.isArray(report.reports)&&report.reports.length===2);assert.deepEqual(sort(report.reports.map(r=>r.source)),sort(Object.values(MODEL_PATHS)));
 const changes=unique(wing.supportInterfaceChanges,'support changes');
 for(const encoding of encodings){const m=report.reports.find(r=>r.source===MODEL_PATHS[encoding]);assert(m?.passed===true);assert.equal(m.sha256,c[encoding+'Sha256']);assert.equal(m.encodingTolerance,encoding==='source'?1e-6:6e-5);const rows=unique(m.rows,'formal support rows');
  for(const change of changes.values()){const r=rows.get(change.id),e=change.evidence?.[encoding];assert(r&&e,'Missing formal material observation '+change.id);currentEvidence(e,change.before,change.after,c,encoding);assert.equal(r.passed,true);assert.equal(r.type,'fixed-material');assert(r.rerun!==false&&!r.inheritedFrom,'Relocated support may not inherit historical material evidence');assert.equal(r.sameRigid,true);assert.deepEqual(r.bad,[]);assert.deepEqual(r.unresolved,[]);assert.deepEqual(r.pair,change.after.pair);assert.equal(r.frame??null,change.after.frame??null);assert.deepEqual(r.observedBounds,e.actualContactBounds,'Formal material bounds differ from coordinate review');assert.equal(r.sampleCount,e.sampleCount);assert.equal(r.spanTriangleArea,e.spanTriangleArea);assert.deepEqual(r.regionCoverage,e.finiteRegionValidation.coverage.map(({index,samples,spanArea})=>({index,samples,spanArea})),'Formal per-region coverage differs');}
 }
 return {formalCurrentSupportCoordinatesConfirmed:true,measuredChangedInterfacesPerEncoding:changes.size,sourceAndRuntime:true,...verifyFormalAdditionalNacelleSupportEvidence(report,wing,c)};
}
