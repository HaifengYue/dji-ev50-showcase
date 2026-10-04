/** Independent deterministic subdivision of the sixteen approved ORIGINAL seam faces. */
import assert from'node:assert/strict';
import * as T from'three';
import {createWorldTriangles}from'../lib/triangle-contact.mjs';
import {verifyCompleteSurfacePreservation}from'./fixed-wing-surface-translation.mts';
import {validateRawSurface,type RawSurface}from'./accessory-preservation.mts';
export const HOST_SUBDIVISION_REFERENCE_SHA='7c9b35fba54bf7abb80867e4f2955cb2959a6b12fc5e2c5e8fa03e24baa5a88d';
export const HOST_SUBDIVISION_RULE=Object.freeze({referenceSha256:HOST_SUBDIVISION_REFERENCE_SHA,maximumOriginalEdgeLength:.025,originalVerticesPerSeam:56,originalTrianglesPerSeam:104,allowedOriginalFaceCount:16,edgeChoice:'greatest (squared length in Blender X/Y/Z summation order, minIndex, maxIndex), among edges of permitted original-face descendants',midpointRule:'double component-wise means through all shared-edge bisections, then one final Float32 storage before host mapping',splitRule:'each incident cyclic (x,y,z) becomes (x,m,z),(m,y,z); provenance retained; protected-face incident edges reject',protectedOriginalFacesExact:true});
export function subdivideOriginalSeam(original:RawSurface,allowedOriginalFaces:number[],maximumEdge=.025){
 assert.equal(maximumEdge,.025,'Subdivision length is an explicit construction value, not adjustable acceptance');validateRawSurface(original);assert(allowedOriginalFaces.length&&new Set(allowedOriginalFaces).size===allowedOriginalFaces.length&&allowedOriginalFaces.every(i=>Number.isSafeInteger(i)&&i>=0&&i<original.triangleCount));
 const allowed=new Set(allowedOriginalFaces),points=original.positions.map(p=>[...p]);let faces=Array.from({length:original.triangleCount},(_,i)=>original.indices.slice(3*i,3*i+3)),parents=faces.map((_,i)=>i);const steps:any[]=[];
 const squared=(u:number,v:number)=>{const dx=points[u][0]-points[v][0],dy=points[u][2]-points[v][2],dz=points[u][1]-points[v][1];return (dx*dx+dy*dy)+dz*dz;};
 while(true){
  const edges=new Map<string,[number,number]>();for(let i=0;i<faces.length;i++)if(allowed.has(parents[i]))for(let j=0;j<3;j++){const a=faces[i][j],b=faces[i][(j+1)%3],edge:[number,number]=a<b?[a,b]:[b,a];edges.set(edge.join(','),edge);}
  const long=[...edges.values()].map(e=>({e,l:squared(...e)})).filter(r=>r.l>maximumEdge*maximumEdge).sort((a,b)=>b.l-a.l||b.e[0]-a.e[0]||b.e[1]-a.e[1]);if(!long.length)break;
  const {e:[u,v],l}=long[0];assert(!faces.some((f,i)=>!allowed.has(parents[i])&&f.includes(u)&&f.includes(v)),'Subdivision attempted to split an original protected face boundary');
  const m=points.length;points.push(points[u].map((x,k)=>(x+points[v][k])/2));const next:number[][]=[],nextParents:number[]=[];
  for(let i=0;i<faces.length;i++){const f=faces[i],parent=parents[i];if(f.includes(u)&&f.includes(v)){const j=f.findIndex((x,j)=>(x===u&&f[(j+1)%3]===v)||(x===v&&f[(j+1)%3]===u));assert(j>=0);const x=f[j],y=f[(j+1)%3],z=f[(j+2)%3];next.push([x,m,z],[m,y,z]);nextParents.push(parent,parent);}else{next.push(f);nextParents.push(parent);}}
  steps.push({edge:[u,v],newVertex:m,squaredLength:l,point:points[m]});assert(steps.length<10000,'Bounded original seam refinement exceeded finite safety budget');faces=next;parents=nextParents;
 }
 const surface:RawSurface={...original,positions:points.map(p=>p.map(Math.fround)),indices:faces.flat(),positionCount:points.length,indexCount:faces.length*3,triangleCount:faces.length};validateRawSurface(surface);
 for(let i=0;i<original.positionCount;i++)assert.deepEqual(surface.positions[i],original.positions[i],'An original stored Float32 vertex may not be rewritten');
 const protectedIds=parents.map((p,i)=>allowed.has(p)?null:i).filter(i=>i!==null);for(const i of protectedIds)assert.deepEqual(faces[i!],original.indices.slice(3*parents[i!],3*parents[i!]+3));
 return {surface,parents,steps,allowedOriginalFaces:[...allowedOriginalFaces],protectedOriginalFaces:original.triangleCount-allowed.size,originalVertexCount:original.positionCount,addedVertices:surface.positionCount-original.positionCount};
}
export function proveSubdivisionOriginalSurface(original:RawSurface,refined:RawSurface){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float64Array(refined.positions.flat()),3));g.setIndex(refined.indices);const mesh=new T.Mesh(g);mesh.updateMatrixWorld(true);const snapshot=createWorldTriangles(mesh,{degenerateEpsilon:0});
 const before={positions:original.positions,indices:Array.from({length:original.triangleCount},(_,i)=>original.indices.slice(3*i,3*i+3)),sourceTriangleCount:original.triangleCount,skippedDegenerate:0},proof=verifyCompleteSurfacePreservation(before,snapshot,refined.triangleCount);g.dispose();return proof;
}
