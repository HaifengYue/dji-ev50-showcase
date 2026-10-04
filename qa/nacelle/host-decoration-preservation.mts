/** Four expressly approved fixed-host decoration dependencies. No other accessory is authorized here. */
import assert from 'node:assert/strict';
import * as T from 'three';
import {sha256,verifiedReference}from'../current/reference-records.mjs';
import {loadAccessoryScene,captureAccessoryNode,proveAccessoryTriangleBijection,validateRawSurface,ACCESSORY_ACCEPTED_MODEL_SHA,ACCESSORY_PREVIOUS_REFERENCE_SHA,type RawSurface,type Encoding}from'./accessory-preservation.mts';
import {verifyExactIndexedHostMaterial}from'./host-indexed-exactness.mjs';
import {HOST_SUBDIVISION_REFERENCE_SHA,HOST_SUBDIVISION_RULE,subdivideOriginalSeam,proveSubdivisionOriginalSurface}from'./host-decoration-subdivision.mts';
import {saddleLiftAtWorld,CENTRAL_LIFT,inDomainWorld}from'./wing-shape-logic.mts';
export const HOST_DECORATION_NAMES=Object.freeze(['Lower_fuselage_join','Lower_fuselage_join002','Root_access_cover_L','Root_access_cover_R']);
export const HOST_DECORATION_REFERENCE_SHA='152134fbdd0b276b43cdaf6a38e5bce094e1e4dd09612a173712c23c4b7c6184';
export const HOST_FUSELAGE_REFERENCE_SHA='85535d86587aed302ff6892175c4b430c2db55ee85a8023d2eb76fad2ba6ad48';
export const HOST_DECORATION_DOMAIN=Object.freeze({minimumAbsX:.3954,maximumAbsX:.4609,longitudinalY:[-1.3403,-.5670],verticalZ:[-.0965,-.0450]});
export const HOST_DECORATION_RULE=Object.freeze({names:HOST_DECORATION_NAMES,referenceSha256:HOST_DECORATION_REFERENCE_SHA,fuselageReferenceSha256:HOST_FUSELAGE_REFERENCE_SHA,coverTranslationGltf:[0,.029,0],joinMapping:'each original vertex retains its world offset from the nearest original host triangle point, carried by that point barycentrically under the reviewed host C1 vertex displacement',originalVertexHostOffsetsPreserved:true,seamSubdivision:HOST_SUBDIVISION_RULE,seamAffectedTriangleSupportBlender:HOST_DECORATION_DOMAIN,sourceOutsideHostDeformationExact:true,encodingTolerance:{source:1e-6,runtime:6e-5},supportDistanceLimitsUnchanged:true});
type Host={positions:number[][];indices:number[][];sourceTriangleCount:number;skippedDegenerate:number};
/** Evaluates the old host first. This is not projection of a candidate back onto a favorable host. */
export function mapHostDecorationPoint(name:string,p:number[],host:Host){
 assert(HOST_DECORATION_NAMES.includes(name),'Unexpected decoration may not enter this bounded permission');assert(p.length===3&&p.every(Number.isFinite));
 if(name.startsWith('Root_access_cover_'))return {point:[p[0],p[1]+CENTRAL_LIFT,p[2]],delta:CENTRAL_LIFT,hostTriangle:null,barycentric:null,originalOffset:null};
 assert(host.positions.length&&host.indices.length===host.sourceTriangleCount&&host.skippedDegenerate===0,'Complete original host triangles required');
 const point=new T.Vector3(...p as [number,number,number]),closest=new T.Vector3(),triangle=new T.Triangle();let best=Infinity,row:any=null;
 for(let i=0;i<host.indices.length;i++){
  const ids=host.indices[i];assert(ids.length===3&&ids.every(j=>Number.isSafeInteger(j)&&j>=0&&j<host.positions.length));
  const ps=ids.map(j=>host.positions[j]);assert(ps.every(v=>v.length===3&&v.every(Number.isFinite)));
  triangle.set(new T.Vector3(...ps[0] as [number,number,number]),new T.Vector3(...ps[1] as [number,number,number]),new T.Vector3(...ps[2] as [number,number,number]));
  triangle.closestPointToPoint(point,closest);const d=point.distanceToSquared(closest);if(d>=best)continue;
  const bary=triangle.getBarycoord(closest,new T.Vector3());assert(bary&&bary.toArray().every(Number.isFinite),'Original host triangle must be nondegenerate');
  const weights=bary.toArray(),delta=weights.reduce((sum,w,k)=>sum+w*saddleLiftAtWorld(ps[k]),0);
  assert(delta>=-1e-12&&delta<=CENTRAL_LIFT+1e-12);best=d;row={point:[p[0],p[1]+delta,p[2]],delta,hostTriangle:i,barycentric:weights,hostPoint:closest.toArray(),originalOffset:point.clone().sub(closest).toArray(),originalHostDistance:Math.sqrt(d)};
 }
 assert(row);return row;
}
export function expectedHostDecorationSurface(before:RawSurface,host:Host){
 validateRawSurface(before);const mappings=before.positions.map(p=>mapHostDecorationPoint(before.name,p,host));
 return {surface:{...before,positions:mappings.map(r=>r.point)},mappings};
}
export async function verifyHostDecorationPreservation(file:string,encoding:Encoding){
 const baseline=verifiedReference('nacelle-previous-host-decorations.json'),fuselage=verifiedReference('nacelle-previous-fuselage.json');assert.equal(baseline.sha256,HOST_DECORATION_REFERENCE_SHA);assert.equal(fuselage.sha256,HOST_FUSELAGE_REFERENCE_SHA);assert.equal(baseline.data.referenceSha256,ACCESSORY_PREVIOUS_REFERENCE_SHA);assert.equal(fuselage.data.referenceSha256,ACCESSORY_PREVIOUS_REFERENCE_SHA);assert.deepEqual(baseline.data.names,HOST_DECORATION_NAMES);
 const before=baseline.data.models.find((m:any)=>m.encoding===encoding),host=fuselage.data.models.find((m:any)=>m.encoding===encoding);assert.equal(before.acceptedModelSha256,ACCESSORY_ACCEPTED_MODEL_SHA[encoding]);assert.equal(host.modelSha256,ACCESSORY_ACCEPTED_MODEL_SHA[encoding]);assert.deepEqual(before.nodes.map((n:any)=>n.name),HOST_DECORATION_NAMES);
 const native=verifiedReference('nacelle-host-decoration-subdivision-reference.json');assert.equal(native.sha256,HOST_SUBDIVISION_REFERENCE_SHA);assert.equal(native.data.hostDecorationReferenceSha256,baseline.sha256);assert.equal(native.data.acceptedSourceSha256,ACCESSORY_ACCEPTED_MODEL_SHA.source);const sourceHost=fuselage.data.models.find((m:any)=>m.encoding==='source');
 const actual=await loadAccessoryScene(file),epsilon=encoding==='source'?1e-6:6e-5,rows=[],failures=[];
 for(const node of before.nodes){
  const o=actual.scene.getObjectByName(node.name);assert(o);const current=captureAccessoryNode(o);let construction:any=null,baseSurface=node.surface,baseHost=host;
  if(node.name.startsWith('Lower_')){const original=native.data.meshes.find((m:any)=>m.name===node.name);assert(original&&original.nativeToSourceExactOrientedTriangles);const originalMapping=expectedHostDecorationSurface(original.surface,sourceHost),allowed=Array.from({length:original.surface.triangleCount},(_,i)=>i).filter(i=>original.surface.indices.slice(3*i,3*i+3).some(j=>originalMapping.mappings[j].delta!==0));assert.deepEqual(allowed,Array.from({length:16},(_,i)=>i));const subdivision=subdivideOriginalSeam(original.surface,allowed),coverage=proveSubdivisionOriginalSurface(original.surface,subdivision.surface);assert(coverage.passed);construction={referenceSha256:native.sha256,originalSurface:original.surface,originalMappings:originalMapping.mappings,...subdivision,coverage};baseSurface=subdivision.surface;baseHost=sourceHost;}
  const expected=expectedHostDecorationSurface(baseSurface,baseHost),geometry=proveAccessoryTriangleBijection(expected.surface,current.surface,epsilon),structural:any={};
  for(const key of ['name','parent','type','isMesh','visible','userData','material'])structural[key]=JSON.stringify(node[key])===JSON.stringify(current[key]);
  const affectedTriangles=[];if(node.name.startsWith('Lower_'))for(let i=0;i<baseSurface.indices.length;i+=3){const ids=baseSurface.indices.slice(i,i+3);if(ids.some(j=>expected.mappings[j].delta!==0)){const points=ids.flatMap(j=>[baseSurface.positions[j],expected.surface.positions[j]]);assert(points.every(p=>inDomainWorld(p,HOST_DECORATION_DOMAIN)),'Entire original/mapped affected material must fit the independently fixed narrow seam domain');affectedTriangles.push(i/3);}}
  const originalForPreservation=construction?.originalSurface??node.surface,originalMaps=construction?.originalMappings??expected.mappings;const unchanged=originalMaps.map((m,i)=>({m,i})).filter(r=>r.m.delta===0),currentKeys=new Set(current.surface.indices.map((i:number)=>current.surface.positions[i].join(','))),lostExactOutside=unchanged.filter(r=>!currentKeys.has(originalForPreservation.positions[r.i].join(',')));
  let indexedMaterialProtection:any=null;
  if(encoding==='source'&&construction&&geometry.passed){
   assert(['Lower_fuselage_join','Lower_fuselage_join002'].includes(node.name));assert.equal(construction.originalSurface.positionCount,56);assert.equal(construction.originalSurface.triangleCount,104);assert.deepEqual(construction.allowedOriginalFaces,Array.from({length:16},(_,i)=>i));assert.equal(construction.surface.positionCount,1344);assert.equal(construction.surface.triangleCount,2680);
   indexedMaterialProtection=verifyExactIndexedHostMaterial({originalSurface:construction.originalSurface,expectedSurface:expected.surface,currentSurface:current.surface,protectedOriginalFaces:Array.from({length:88},(_,i)=>i+16),unmovedExpectedVertexIds:expected.mappings.flatMap((m,i)=>m.delta===0?[i]:[]),correspondence:geometry.correspondence});
  }
  // Runtime quantization is a separate original encoding bound; source outside material must remain exact.
  const passed=geometry.passed&&Object.values(structural).every(Boolean)&&(encoding!=='source'||lostExactOutside.length===0)&&(!construction||encoding!=='source'||indexedMaterialProtection?.passed===true),row={name:node.name,passed,structural,geometry,indexedMaterialProtection,construction,vertexCount:baseSurface.positionCount,affectedOutputTriangles:affectedTriangles,affectedOriginalTriangles:construction?.allowedOriginalFaces??[],exactOriginalPhysicalVertexCount:new Set(originalForPreservation.positions.map(p=>p.join(','))).size,exactOriginalOutsidePhysicalVertices:new Set(unchanged.map(r=>originalForPreservation.positions[r.i].join(','))).size,referenceRawTriangleCount:node.surface.triangleCount,rawTriangleCount:baseSurface.triangleCount,changedOriginalVertices:originalMaps.filter(m=>m.delta!==0).length,originalOutsideVertices:unchanged.length,sourceOutsideExactRequired:encoding==='source',lostExactOutside:lostExactOutside.map(r=>r.i),minimumHostMappedLift:Math.min(...expected.mappings.map(m=>m.delta)),maximumHostMappedLift:Math.max(...expected.mappings.map(m=>m.delta)),mappingSha256:sha256(JSON.stringify(expected.mappings)),mappings:expected.mappings};rows.push(row);if(!passed)failures.push({name:node.name,structural,geometryFailures:geometry.failures,lostExactOutside:row.lostExactOutside});
 }
 return {passed:!failures.length,encoding,file,sha256:actual.sha256,referenceSha256:baseline.sha256,hostReferenceSha256:fuselage.sha256,rule:HOST_DECORATION_RULE,epsilon,nodeCount:rows.length,referenceRawTriangleCount:rows.reduce((s,r)=>s+r.referenceRawTriangleCount,0),rawTriangleCount:rows.reduce((s,r)=>s+r.rawTriangleCount,0),rows,failures,limitations:['Only four explicitly enumerated fixed host decorations, with original vertex-wise host offsets, independently reconstructed permitted original-face subdivision, and full cyclic raw triangle correspondence. No other node or geometry permission is created.','Complete physical host-distance, finite support, graph, topology, source/runtime parity and all prescribed motion stages remain mandatory. The unchanged host distance limits are not replaced by this correspondence proof.']};
}
