/** Explicit immutable-reference microfold permission. Never an area or spatial mask. */
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {verifiedReference} from '../current/reference-records.mjs';
export const MICROFOLD_RULES=Object.freeze({maximumAltitude:1e-7,maximumAbsCruiseX:1.8,maximumNeighborPlaneDistance:1e-7});
export const DIRECTION_REFERENCE_SHA256={acceptedFixed:'0b6ec3fc16f62eddce73ccae9ce4df65a15ef503a534ad74c68786dde857fe14',preRepair:'2f2750782f9384c39ab83c76799b062a33c88b7130897669f135034251da8b9d'};
export const DIRECTION_MESHES=['Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R'];
const branded=new WeakSet<object>();
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]),dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],pointKey=(p:number[])=>p.join(',');
export function orientedFaceKey(v:number[][]){assert(v.length===3&&v.every(p=>p.length===3&&p.every(Number.isFinite)));const p=v.map(pointKey);return [p.join('|'),[p[1],p[2],p[0]].join('|'),[p[2],p[0],p[1]].join('|')].sort()[0];}
export const faceSha256=(v:number[][])=>crypto.createHash('sha256').update(orientedFaceKey(v)).digest('hex');
export function faceMetrics(v:number[][]){const n=cross(sub(v[1],v[0]),sub(v[2],v[0])),twiceArea=Math.hypot(...n),longestEdge=Math.max(...[0,1,2].map(i=>Math.hypot(...sub(v[(i+1)%3],v[i]))));assert(Number.isFinite(twiceArea)&&twiceArea>0&&longestEdge>0,'True zero-area faces are never microfold corrections');return {area:twiceArea/2,minimumAltitude:twiceArea/longestEdge,normal:n.map(x=>x/twiceArea)};}
export function proveOriginalMicrofold(vertices:number[][],neighbor:number[][]){
 const a=faceMetrics(vertices),b=faceMetrics(neighbor),sharedVertices=vertices.filter(p=>neighbor.some(q=>pointKey(p)===pointKey(q))).length,normalDot=dot(a.normal,b.normal),maximumNeighborPlaneDistance=Math.max(...vertices.map(p=>Math.abs(dot(sub(p,neighbor[0]),b.normal)))),maximumAbsCruiseX=Math.max(...vertices.map(p=>Math.abs(p[0]))),failures=[];
 if(sharedVertices!==2)failures.push('An actual complete shared edge is required');
 if(!(normalDot<0))failures.push('Original geometric neighboring normals must oppose');
 if(a.minimumAltitude>MICROFOLD_RULES.maximumAltitude)failures.push('Original face exceeds the fixed microfold height');
 if(maximumNeighborPlaneDistance>MICROFOLD_RULES.maximumNeighborPlaneDistance)failures.push('All original face vertices must lie near the same adjacent face plane');
 if(!(maximumAbsCruiseX<MICROFOLD_RULES.maximumAbsCruiseX))failures.push('Original complete face lies outside the fixed root repair region');
 return {passed:!failures.length,failures,...a,sharedVertices,normalDot,maximumNeighborPlaneDistance,maximumAbsCruiseX};
}
export function assertCorrectionContext(context:any){assert(branded.has(context),'Directional correction requires a validated explicit reference-bound context');}
/** Main shape caller supplies a registered immutable evidence record and separate reviewed permission. */
export function createMicrofoldCorrectionContext(record:any,authorization:any,meshName:string,referenceSha256:string){
 assert(DIRECTION_MESHES.includes(meshName),'Only the four named wings can receive original-face direction corrections');
 assert(Object.values(DIRECTION_REFERENCE_SHA256).includes(referenceSha256),'Wrong immutable direction reference');
 assert(authorization&&(authorization.reviewed===true||process.env.QA_PREFLIGHT==='1'),'Original direction correction is not formally reviewed');
 assert.equal(authorization.evidenceSha256,record.sha256,'Correction permission must bind exact evidence bytes');
 assert.equal(authorization.direction,'beforeToAfter');assert.deepEqual(authorization.meshNames,DIRECTION_MESHES);assert.deepEqual(authorization.rules,MICROFOLD_RULES);
 const bytes=fs.readFileSync(record.path);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256);const ledger=JSON.parse(bytes.toString());
 assert.equal(ledger.formatVersion,1);assert.deepEqual(ledger.rules,MICROFOLD_RULES);assert.equal(ledger.preRepairDesignSourceSha256,'1b53025c0498d45ff505ea9e5990b836f14a714b56710609cd123dab14da860f');
 const requiredCounts:any={[DIRECTION_REFERENCE_SHA256.acceptedFixed]:{Fixed_root_L:2,Fixed_root_R:1},[DIRECTION_REFERENCE_SHA256.preRepair]:{Fixed_root_L:2,Fixed_root_R:1,Composite_wing_L:47,Composite_wing_R:35}};
 assert.equal(ledger.entries.length,88,'Only85 original design faces plus3 corresponding accepted-fixed records are authorized');
 for(const [ref,counts]of Object.entries(requiredCounts))for(const [name,count]of Object.entries(counts as any))assert.equal(ledger.entries.filter((e:any)=>e.referenceSha256===ref&&e.meshName===name).length,count);
 assert(ledger.entries.every((e:any)=>requiredCounts[e.referenceSha256]?.[e.meshName]),'Unknown reference or mesh entry cannot expand correction scope');
 const entries=ledger.entries.filter((e:any)=>e.referenceSha256===referenceSha256&&e.meshName===meshName);assert(entries.length,'No permission exists for this mesh/reference combination');
 const pre=verifiedReference('nacelle-pre-repair-wing-reference.json');assert.equal(pre.sha256,DIRECTION_REFERENCE_SHA256.preRepair);const preMesh=pre.data.meshes.find((m:any)=>m.name===meshName),preFaces=new Map(preMesh.indices.map((ids:number[])=>{const v=ids.map(i=>preMesh.positions[i]);return [faceSha256(v),v];})),prePoints=new Set(preMesh.positions.map(pointKey)),preEdges=new Set(preMesh.indices.flatMap((ids:number[])=>[0,1,2].map(i=>[pointKey(preMesh.positions[ids[i]]),pointKey(preMesh.positions[ids[(i+1)%3]])].sort().join('|'))));
 const approved=new Map<string,any>();let validated=false;
 const context={meshName,referenceSha256,evidenceSha256:record.sha256,authorizationReviewed:authorization.reviewed===true,expectedTranslation:referenceSha256===DIRECTION_REFERENCE_SHA256.acceptedFixed?[0,.029,0]:[0,0,0],
  validateBeforeSnapshot(snapshot:any){
   const faces=new Map<string,any[]>();for(const t of snapshot.triangles){const k=faceSha256(t.vertices),v=faces.get(k)??[];v.push(t);faces.set(k,v);}approved.clear();
   for(const e of entries){assert.equal(faceSha256(e.vertices),e.faceSha256);assert.equal(faceSha256(e.neighborVertices),e.neighborFaceSha256);const t=faces.get(e.faceSha256),n=faces.get(e.neighborFaceSha256);assert.equal(t?.length,1,'Each permitted original face must have one exact oriented identity');assert.equal(n?.length,1,'Actual original shared-edge neighbor must have one exact oriented identity');
    const proof=proveOriginalMicrofold(t![0].vertices,n![0].vertices);assert(proof.passed,proof.failures.join('; '));assert.equal(proof.area,e.area,'Original face area must remain exactly evidence-bound');
    const counterpart=preFaces.get(e.preRepairFaceSha256) as number[][];assert(counterpart,'Missing actual pre-repair source face');assert.equal(orientedFaceKey(counterpart),orientedFaceKey(e.preRepairVertices));
    assert(Math.max(...e.vertices.map((p:number[],i:number)=>Math.hypot(...sub(p,e.preRepairVertices[i]))))<=1e-6,'Accepted fixed and pre-repair corresponding faces must retain original source equivalence');
    const p=e.provenance;assert(p&&['link-collapse','near-vertex-merge'].includes(p.kind)&&/^[0-9a-f]{64}$/.test(p.traceSha256),'Missing exact construction provenance');
    if(p.kind==='link-collapse'){
     assert.equal(faceSha256(p.beforeTriangle),e.preRepairFaceSha256,'Link trace must contain this exact original directed face');assert(prePoints.has(pointKey(p.removed))&&prePoints.has(pointKey(p.retained)),'Link endpoints must be real original vertices');assert(counterpart.some(q=>pointKey(q)===pointKey(p.removed)),'This original face must participate in the traced link collapse');assert(preEdges.has([pointKey(p.removed),pointKey(p.retained)].sort().join('|')),'The removed-retained pair must be an actual frozen original mesh edge; an invented later triangle cannot establish it');assert(p.linkEdgeBeforeTriangle.some((q:number[])=>pointKey(q)===pointKey(p.removed))&&p.linkEdgeBeforeTriangle.some((q:number[])=>pointKey(q)===pointKey(p.retained)),'Trace must preserve the actual collapsed link edge');
    }else{
     assert(Array.isArray(p.steps)&&p.steps.length,'Near-point provenance cannot be empty');let affected=false;for(const step of p.steps){assert(prePoints.has(pointKey(step.removed))&&prePoints.has(pointKey(step.retained)),'Near merge must use original exact vertices');assert(Math.hypot(...sub(step.removed,step.retained))<=1e-7,'Near-merge displacement may not expand');if(counterpart.some(q=>pointKey(q)===pointKey(step.removed)))affected=true;}assert(affected,'Original face is unrelated to recorded near merge');
    }
    assert(!approved.has(e.faceSha256),'Duplicate direction permission');approved.set(e.faceSha256,{faceSha256:e.faceSha256,referenceSha256,meshName,area:proof.area,proof,provenanceKind:p.kind,traceSha256:p.traceSha256});
   }
   validated=true;return {permittedOriginalFaces:approved.size,permittedOriginalArea:[...approved.values()].reduce((s,e)=>s+e.area,0),referenceSha256,meshName,evidenceSha256:record.sha256,authorizationReviewed:authorization.reviewed===true};
  },
  permissionFor(direction:string,triangle:any){assert(validated,'All original-face predicates must be checked before any direction correction');if(direction!=='beforeToAfter')return null;return approved.get(faceSha256(triangle.vertices))??null;}
 };
 Object.freeze(context.expectedTranslation);Object.freeze(context);branded.add(context);return context;
}
