/** Complete fixed-wing translation including the actual bore: no geometric exemptions. */
import * as T from 'three';import assert from 'node:assert/strict';
import {createWorldTriangles} from '../lib/triangle-contact.mjs';
import {clipOutsideDomain,proveOutsidePatchCoverage} from '../current/patch-coverage.mts';
import {verifyAdaptiveOutsidePatchCoverage,certifyConvexPatches} from './adaptive-patch-coverage.mts';
import {CENTRAL_LIFT,SHAFT_LIFT} from './wing-shape-logic.mts';
import {assertCorrectionContext} from './oriented-microfold-corrections.mts';
const bounds=(t:any)=>t.bounds??{min:[0,1,2].map(k=>Math.min(...t.vertices.map((p:number[])=>p[k]))),max:[0,1,2].map(k=>Math.max(...t.vertices.map((p:number[])=>p[k])))};
const overlap=(a:any,b:any)=>[0,1,2].every(k=>a.min[k]<=b.max[k]+1e-6&&b.min[k]<=a.max[k]+1e-6);
function geometricNormal(t:any){const[a,b,c]=t.vertices,u=b.map((v:number,i:number)=>v-a[i]),v=c.map((v:number,i:number)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);assert(Number.isFinite(l)&&l>0,'Actual oriented coverage requires a finite nondegenerate geometric triangle');return n.map(x=>x/l);}
/** Same-hemisphere winding coverage is additional to the unchanged distance certificate. */
export function verifyOrientedFullSurfaceCoverage(before:any,after:any,sentinel:any,correctionContext?:any){
 if(correctionContext)assertCorrectionContext(correctionContext);
 const authorization=correctionContext?correctionContext.validateBeforeSnapshot(before):null,directions:any[]=[];
 const certify=(triangle:any,near:any[])=>{
  const first=proveOutsidePatchCoverage([triangle],{triangles:near},sentinel,{epsilon:1e-6,maximumFailures:1,includeResidualPolygons:true});
  assert.equal(first.failures.length,first.stats.failedPatches,'Every unproved oriented source patch must survive');
  const residuals=first.failures.flatMap((f:any)=>{assert(Array.isArray(f.unprovenPolygons)&&f.unprovenPolygons.length===f.residualPatches);return f.unprovenPolygons;}),supplement=certifyConvexPatches(residuals,{triangles:near});return {passed:supplement.passed,first,supplement,residualCount:residuals.length};
 };
 for(const [direction,source,target]of [['beforeToAfter',before,after],['afterToBefore',after,before]] as const){
  const normals=new Map(target.triangles.map((t:any)=>[t,geometricNormal(t)])),failures:any[]=[],originalDirectionCorrections:any[]=[],stats={sourceTriangles:source.triangles.length,checkedTriangles:0,compatibleActualTargetTriangles:0,firstPassCertifiedTriangles:0,adaptiveCertifiedTriangles:0,approvedOriginalDirectionCorrections:0};
  for(const triangle of source.triangles){
   const n=geometricNormal(triangle),b=bounds(triangle),allNear:any[]=[],near:any[]=[];
   const accept=(t:any)=>{if(!overlap(b,bounds(t)))return;allNear.push(t);const m=normals.get(t) as number[];if(n.reduce((s,v,k)=>s+v*m[k],0)>0)near.push(t);};
   if(target.bvh){const stack=[target.bvh];while(stack.length){const node=stack.pop();if(!overlap(b,node.bounds))continue;if(node.indices)for(const i of node.indices)accept(target.triangles[i]);else stack.push(node.left,node.right);}}
   else for(const t of target.triangles)accept(t);
   stats.checkedTriangles++;stats.compatibleActualTargetTriangles+=near.length;const strict=certify(triangle,near);
   if(!strict.passed){
    const permission=correctionContext?.permissionFor(direction,triangle)??null;
    if(permission){assert.equal(direction,'beforeToAfter','New/current faces can never inherit old-direction permission');const completeDistance=certify(triangle,allNear);if(completeDistance.passed){stats.approvedOriginalDirectionCorrections++;originalDirectionCorrections.push({sourceTriangle:triangle.triangleIndex,...permission,strictSameHemisphereFailed:true,completeTriangleDistanceCertified:true,epsilon:1e-6,completeDistanceCertificate:{firstPass:completeDistance.first,supplement:completeDistance.supplement}});continue;}}
    failures.push({sourceTriangle:triangle.triangleIndex,sourceNormal:n,compatibleTargetCount:near.length,firstPass:strict.first,supplement:strict.supplement,originalCorrectionPermission:permission});break;
   }
   if(strict.residualCount)stats.adaptiveCertifiedTriangles++;else stats.firstPassCertifiedTriangles++;
  }
  directions.push({direction,passed:!failures.length&&stats.checkedTriangles===stats.sourceTriangles,stats,failures,originalDirectionCorrections});
 }
 return {passed:directions.every(d=>d.passed),epsilon:1e-6,directions,originalDirectionCorrectionAuthorization:authorization,orientationRule:'Same-hemisphere actual geometric normals for every ordinary face. Only explicitly identified frozen ORIGINAL microfold source faces may use a fully revalidated old-to-current correction after strict failure, while retaining complete1e-6 distance coverage. Current-to-original always stays strictly same-hemisphere. This is not a5-degree normal-angle certificate;5 degrees applies only to new interior join profiles.',shaderNormalsUsed:false};
}
export function verifyCompleteSurfacePreservation(old:any,after:any,afterRawTriangleCount:number,translation:number[]=[0,0,0],correctionContext?:any){
 assert(Array.isArray(translation)&&translation.length===3&&translation.every(Number.isFinite),'Explicit finite whole-surface translation required');if(correctionContext){assertCorrectionContext(correctionContext);assert.deepEqual(translation,correctionContext.expectedTranslation,'A correction context cannot cross reference coordinate frames');}
 const points=old.positions.map((p:number[])=>p.map((v,i)=>v+translation[i])),g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float64Array(points.flat()),3));g.setIndex(old.indices.flat());const mesh=new T.Mesh(g);mesh.updateMatrixWorld(true);const translated=createWorldTriangles(mesh,{degenerateEpsilon:0});
 assert.equal(old.skippedDegenerate,0,'Frozen compact reference must retain every raw source triangle');assert.equal(old.sourceTriangleCount,old.indices.length,'Frozen compact reference omitted raw indexed faces');
 assert(Number.isInteger(afterRawTriangleCount)&&afterRawTriangleCount>0,'Raw candidate index/vertex count must independently define a positive triangle count');
 for(const [name,snapshot,rawCount]of [['before',translated,old.indices.length],['after',after,afterRawTriangleCount]] as const){
  assert.equal(snapshot.skippedDegenerate,0,'Complete '+name+' surface may not omit even one truly zero-area/filtered triangle');assert.equal(snapshot.sourceTriangleCount,rawCount,'Snapshot '+name+' raw-count metadata must equal independent actual index count');assert.equal(snapshot.triangles.length,rawCount,'Every raw '+name+' triangle must enter the complete surface proof');
  const ids=snapshot.triangles.map((t:any)=>t.triangleIndex);assert.equal(new Set(ids).size,rawCount,'No raw triangle identity may be duplicated');assert(ids.every((i:number)=>Number.isInteger(i)&&i>=0&&i<rawCount),'All raw indexed triangle identities must be retained');
 }
 const completeTriangleAccounting={before:{rawTriangleCount:old.indices.length,snapshotSourceTriangleCount:translated.sourceTriangleCount,certifiedTriangleCount:translated.triangles.length,skippedDegenerate:translated.skippedDegenerate},after:{rawTriangleCount:afterRawTriangleCount,snapshotSourceTriangleCount:after.sourceTriangleCount,certifiedTriangleCount:after.triangles.length,skippedDegenerate:after.skippedDegenerate},relativeDegenerateFilterDisabled:true,trueZeroAreaPolicy:'Reject if any raw actual triangle has zero area; no omitted face can inherit full-surface certification'};
 // The original coverage API requires a nonempty domain. Keep that algorithm
 // unchanged, using a disjoint sentinel and prove it excludes NO surface point.
 const all=[...translated.triangles,...after.triangles],maximumAbsX=Math.max(...all.flatMap((t:any)=>t.vertices.map((p:number[])=>Math.abs(p[0]))));assert(Number.isFinite(maximumAbsX));
 const sentinel={minimumAbsX:maximumAbsX+1,maximumAbsX:maximumAbsX+2,longitudinalY:[0,1],verticalZ:[0,1]};
 for(const triangle of all){const retained=clipOutsideDomain(triangle,sentinel);assert.equal(retained.length,1,'No fixed-wing surface patch may be exempted');assert.deepEqual(retained[0],triangle.vertices,'Every full actual triangle, including all bore walls, must remain protected');}
 const coverage=verifyAdaptiveOutsidePatchCoverage(translated,after,sentinel),orientedFullSurfaceCoverage=verifyOrientedFullSurfaceCoverage(translated,after,sentinel,correctionContext);
 return {passed:coverage.passed&&orientedFullSurfaceCoverage.passed,translation,completeTriangleAccounting,beforeTriangleCount:old.indices.length,afterTriangleCount:after.triangles.length,trianglesWithProtectedArea:translated.triangles.length,fullyExcludedBoreTriangles:0,excludedSurfacePoints:0,boundedBoreRecutNeighborhoodBlender:null,fullSurfaceCoverage:coverage,orientedFullSurfaceCoverage,claim:'Every point of both complete actual surfaces, including all walls and edges, is covered bidirectionally within the original1e-6 bound after the explicit translation. Directed coverage is strict except for any explicitly reported evidence-bound ORIGINAL microfold corrections. Current-to-original remains strictly same-hemisphere. No surface patch is excluded from distance coverage; this does not certify absence of self-intersections.',limitations:['Actual material sections separately retain every closed interval and empty ray; support, bore hardware and full motion remain mandatory independent gates.','Full-surface proof remains at 1e-6 for both source and decoded runtime; separate encoding endpoint tests retain source1e-6/runtime6e-5.']};
}

export function verifyFixedSurfaceTranslation(old:any,after:any,afterRawTriangleCount:number,correctionContext?:any){
 assert.equal(SHAFT_LIFT,CENTRAL_LIFT,'Complete original fixed-wing/bore translation requires equal reviewed shaft and wing lifts');
 return {...verifyCompleteSurfacePreservation(old,after,afterRawTriangleCount,[0,CENTRAL_LIFT,0],correctionContext),centralLift:CENTRAL_LIFT,shaftLift:SHAFT_LIFT,baselineRole:'Previously accepted fixed wing including the complete true bore; both surfaces and all material must translate together'};
}
