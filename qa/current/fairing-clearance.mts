/** Actual finite-axis radial lower bound plus full-object SAT/containment. No support edges or contact exemptions. */
import assert from 'node:assert/strict';
import * as T from 'three';
import {triangleDistance} from '../lib/rotor-envelope-geometry.mjs';
import {intersectMeshTriangles} from '../lib/triangle-contact.mjs';
import {solidTopology,containedComponents,pointInSolid} from '../lib/solid-contact.mjs';

export const FAIRING_CLEARANCE_LIMITS=Object.freeze({outerRadius:.044,boreRadius:.045,boreSides:64,
 encodingTolerance:Object.freeze({source:1e-6,runtime:6e-5}),sat:1e-9,solid:1e-8,weld:1e-12,area:1e-18});
export type ClearanceEncoding='source'|'runtime';
const vector=(p:number[])=>{assert(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Finite actual 3D coordinates required');return new T.Vector3(...p);};

export function snapshotTriangleCoverage(snapshot:any){
 const sourceTriangleCount=snapshot.sourceTriangleCount,retainedTriangleCount=snapshot.triangles.length,skippedDegenerate=snapshot.skippedDegenerate,indices=snapshot.triangles.map((t:any)=>t.triangleIndex),uniqueTriangleIndices=new Set(indices).size;
 const indexCoverage=indices.every((i:any)=>Number.isInteger(i)&&i>=0&&i<sourceTriangleCount)&&uniqueTriangleIndices===retainedTriangleCount;
 const passed=Number.isInteger(sourceTriangleCount)&&sourceTriangleCount>0&&Number.isInteger(skippedDegenerate)&&skippedDegenerate===0&&sourceTriangleCount===retainedTriangleCount&&indexCoverage;
 return {passed,sourceTriangleCount,retainedTriangleCount,skippedDegenerate,uniqueTriangleIndices,indexCoverage};
}

/** Exact halfspace clipping; it never selects vertices alone or dilates the required clearance. */
export function clipAxialPolygon(polygon:T.Vector3[],origin:T.Vector3,axis:T.Vector3,limit:number,side:1|-1){
 const out:T.Vector3[]=[];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],da=side*(a.clone().sub(origin).dot(axis)-limit),db=side*(b.clone().sub(origin).dot(axis)-limit);
  if(da<=0)out.push(a.clone());
  if((da<=0)!==(db<=0)){const t=da/(da-db);assert(Number.isFinite(t)&&t>=0&&t<=1);out.push(a.clone().lerp(b,t));}
 }
 return out;
}

/** Convex projected polygon distance includes all edges and the polygon interior. */
export function projectedPolygonRadius(polygon:T.Vector3[],origin:T.Vector3,axis:T.Vector3){
 assert(polygon.length>0);
 const flat=polygon.map(p=>p.clone().addScaledVector(axis,-p.clone().sub(origin).dot(axis)));
 let minimum=Math.min(...flat.map(p=>p.distanceTo(origin)));
 if(flat.length===2){const edge=new T.Line3(flat[0],flat[1]);if(edge.distanceSq()>0)minimum=Math.min(minimum,edge.closestPointToPoint(origin,true,new T.Vector3()).distanceTo(origin));}
 for(let i=1;i<flat.length-1;i++)minimum=Math.min(minimum,triangleDistance([flat[0],flat[i],flat[i+1]],origin));
 assert(Number.isFinite(minimum)&&minimum>=0);
 return {minimum,projectedVertices:flat.map(p=>p.toArray())};
}

export function measureFairingRadialWindow(fairingVertices:number[][],host:any,axisStart:number[],axisEnd:number[],encoding:ClearanceEncoding){
 assert(Object.hasOwn(FAIRING_CLEARANCE_LIMITS.encodingTolerance,encoding),'Unknown exact encoding');
 assert(Array.isArray(fairingVertices)&&fairingVertices.length>0,'All actual decoded fairing vertices are required');
 assert(Array.isArray(host.triangles),'Actual host triangle snapshot is required');
 const hostTriangleCoverage=snapshotTriangleCoverage(host),origin=vector(axisStart),axis=vector(axisEnd).sub(origin),axisLength=axis.length();assert(Number.isFinite(axisLength)&&axisLength>1e-9,'Actual axis markers are degenerate');axis.divideScalar(axisLength);
 const points=fairingVertices.map(vector),axial=points.map(p=>p.clone().sub(origin).dot(axis)),radial=points.map(p=>{const q=p.clone().sub(origin);return q.addScaledVector(axis,-q.dot(axis)).length();});
 assert([...axial,...radial].every(Number.isFinite),'Nonfinite actual fairing coordinates');
 const minimumAxial=Math.min(...axial),maximumAxial=Math.max(...axial),maximumFairingRadius=Math.max(...radial);assert(maximumAxial>minimumAxial,'Fairing has no finite axial extent');
 let minimumHostRadius=Infinity,clippedPolygonCount=0,finiteHostFaceCount=0;const worst:any[]=[];
 for(const triangle of host.triangles){
  assert(Array.isArray(triangle.vertices)&&triangle.vertices.length===3,'Actual complete triangle required');
  let polygon=triangle.vertices.map(vector);polygon=clipAxialPolygon(polygon,origin,axis,minimumAxial,-1);polygon=clipAxialPolygon(polygon,origin,axis,maximumAxial,1);
  if(!polygon.length)continue;clippedPolygonCount++;
  let area=0;for(let i=1;i<polygon.length-1;i++)area+=new T.Triangle(polygon[0],polygon[i],polygon[i+1]).getArea();
  if(area>FAIRING_CLEARANCE_LIMITS.area)finiteHostFaceCount++;
  const measured=projectedPolygonRadius(polygon,origin,axis);minimumHostRadius=Math.min(minimumHostRadius,measured.minimum);
  worst.push({triangleIndex:triangle.triangleIndex,minimumRadius:measured.minimum,clippedFaceArea:area,clippedVertices:polygon.map(p=>p.toArray()),projectedVertices:measured.projectedVertices});
  worst.sort((a,b)=>a.minimumRadius-b.minimumRadius);if(worst.length>8)worst.pop();
 }
 const tolerance=FAIRING_CLEARANCE_LIMITS.encodingTolerance[encoding],maximumAllowedFairingRadius=FAIRING_CLEARANCE_LIMITS.outerRadius+tolerance,
  minimumRequiredHostRadius=FAIRING_CLEARANCE_LIMITS.boreRadius*Math.cos(Math.PI/FAIRING_CLEARANCE_LIMITS.boreSides)-tolerance,
  actualRadialGap=Number.isFinite(minimumHostRadius)?minimumHostRadius-maximumFairingRadius:null,failures:string[]=[];
 if(!hostTriangleCoverage.passed)failures.push('actual host source triangles were omitted, skipped or lack exact full index coverage');
 if(maximumFairingRadius>maximumAllowedFairingRadius)failures.push('actual fairing maximum radius exceeds reviewed .044 plus original encoding tolerance');
 if(!finiteHostFaceCount||!Number.isFinite(minimumHostRadius))failures.push('finite axial window contains no nondegenerate actual host face');
 else if(minimumHostRadius<minimumRequiredHostRadius)failures.push('actual clipped host material enters the reviewed bore radial bound');
 if(actualRadialGap===null||!(actualRadialGap>0))failures.push('no positive actual finite-window radial separation');
 return {passed:!failures.length,failures,encoding,encodingTolerance:tolerance,axisStart,axisEnd,axisLength,axisDirection:axis.toArray(),actualFairingAxialRange:[minimumAxial,maximumAxial],actualFairingVertexCount:points.length,actualHostTriangleCount:host.triangles.length,hostTriangleCoverage,allHostSourceFacesConsidered:hostTriangleCoverage.passed,clippedPolygonCount,finiteHostFaceCount,maximumFairingRadius,minimumHostRadius:Number.isFinite(minimumHostRadius)?minimumHostRadius:null,maximumAllowedFairingRadius,minimumRequiredHostRadius,actualRadialGap,guaranteedDesignRadialLowerBound:minimumRequiredHostRadius-maximumAllowedFairingRadius,worstHostFaces:worst,
  claim:'Conservative continuous-angle radial lower bound only within the actual finite fairing axial window; not a whole-object or whole-aircraft minimum Euclidean clearance',fullObjectCollisionEstablished:false};
}

export function verifyFairingClearancePair(fairing:any,host:any,axisStart:number[],axisEnd:number[],encoding:ClearanceEncoding,fairingVertices?:number[][]){
 const vertices=fairingVertices??fairing.triangles.flatMap((t:any)=>t.vertices),radial=measureFairingRadialWindow(vertices,host,axisStart,axisEnd,encoding),fairingTriangleCoverage=snapshotTriangleCoverage(fairing),fairingTopology=solidTopology(fairing,FAIRING_CLEARANCE_LIMITS.weld),hostTopology=solidTopology(host,FAIRING_CLEARANCE_LIMITS.weld);
 const surface=intersectMeshTriangles(fairing,host,{maxWitnesses:1,epsilon:FAIRING_CLEARANCE_LIMITS.sat}),contained=containedComponents(fairing,host,fairingTopology,hostTopology),unresolved=[...(contained.unresolved??[])],representativeClassifications:any[]=[],failures=[...radial.failures];
 // The legacy containment utility intentionally does not report boundary representatives.
 // This new non-contact gate must instead fail conservatively on that unchanged 1e-8 band.
 for(const[inner,outer,ti,to]of [[fairing,host,fairingTopology,hostTopology],[host,fairing,hostTopology,fairingTopology]])for(const representative of ti.representatives){
  const tri=inner.triangles.find((t:any)=>t.triangleIndex===representative.triangleIndex);assert(tri,'Missing actual component representative triangle');
  const point=tri.vertices[representative.vertexIndex],classification=pointInSolid(point,outer,to,FAIRING_CLEARANCE_LIMITS.solid),row={contained:inner.name,container:outer.name,sourceTriangleIndex:tri.triangleIndex,point,...classification};representativeClassifications.push(row);
  if(classification.state==='boundary')unresolved.push({...row,reason:'boundary-representative-at-original-solid-epsilon'});
 }
 if(!fairingTriangleCoverage.passed)failures.push('actual fairing source triangles were omitted, skipped or lack exact full index coverage');
 if(!fairingTopology.closed||fairingTopology.componentCount!==1)failures.push('fairing must be one actual closed material component');
 if(!hostTopology.closed||hostTopology.componentCount!==1)failures.push('main wing host must be one actual closed material component');
 if(surface.intersects)failures.push('actual complete fairing and host triangle surfaces intersect');
 if(contained.length)failures.push('complete actual component containment defeats an apparent radial hole');
 if(unresolved.length)failures.push('complete actual solid containment is unresolved');
 const allObjectFacesChecked=fairingTriangleCoverage.passed&&radial.hostTriangleCoverage.passed;
 return {passed:!failures.length,failures,pair:[fairing.name,host.name],supporting:false,addsSupportGraphEdge:false,collisionExemption:false,radial,fairingTriangleCoverage,fairingTopology,hostTopology,surface,containedComponents:[...contained],representativeClassifications,containmentUnresolved:unresolved,
  allObjectFacesChecked,fullObjectCollisionEstablished:allObjectFacesChecked&&!surface.intersects&&!contained.length&&!unresolved.length&&fairingTopology.closed&&hostTopology.closed,
  limits:FAIRING_CLEARANCE_LIMITS,shellMeridianProofRequiredSeparately:true};
}
