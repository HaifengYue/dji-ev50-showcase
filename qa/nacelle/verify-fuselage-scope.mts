/** Immediate-baseline bounded saddle deformation, actual vertices and complete protected triangle area. */
import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';
import {loadAudit} from '../current/audit-scene.mts';import {verifiedReference} from '../current/reference-records.mjs';
import {createWorldTriangles} from '../lib/triangle-contact.mjs';
import {verifyOutsidePatchCoverage,normalizeDeformationDomains} from '../current/patch-coverage.mts';
import {saddleLiftAtWorld,inDomainWorld,canonicalOrientedTriangle,ENCODING_TOLERANCE,CENTRAL_LIFT} from './wing-shape-logic.mts';
const contract=JSON.parse(fs.readFileSync('qa/contracts/nacelle-wing-refinement.json','utf8')),preflight=process.env.QA_PREFLIGHT==='1';assert(preflight||contract.reviewed);if(!preflight)assert.equal(contract.wingShape.centralLift,CENTRAL_LIFT);const domain=contract.wingShape.centralAttachmentDomainBlender;assert(domain,'Reviewed finite actual-triangle support domain required');normalizeDeformationDomains(domain);
const independentlyReviewedDomain={minimumAbsX:.2234,maximumAbsX:.6201,longitudinalY:[-2.0023,-.7299],verticalZ:[-.2700,.1322]};assert.deepEqual(Object.fromEntries(Object.keys(independentlyReviewedDomain).map(k=>[k,domain[k]])),independentlyReviewedDomain,'Do not dynamically enlarge saddle scope from a candidate');
const reference=verifiedReference('nacelle-previous-fuselage.json'),base=verifiedReference('nacelle-previous-reference.json');assert.equal(reference.data.referenceSha256,base.sha256);assert.equal(base.sha256,contract.previousAcceptedReferenceSha256);
const reports:any[]=[];
for(const[encoding,file]of [['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']] as const){
 const a=await loadAudit(file),old=reference.data.models.find((m:any)=>m.encoding===encoding),tolerance=ENCODING_TOLERANCE[encoding];assert(old);if(!preflight)assert.equal(a.sha256,contract[encoding+'Sha256']);assert.equal(old.modelSha256,base.data.models.find((m:any)=>m.encoding===encoding).modelSha256);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float64Array(old.positions.flat()),3));g.setIndex(old.indices.flat());const mesh=new T.Mesh(g);mesh.updateMatrixWorld();const before=createWorldTriangles(mesh),after=a.snap(a.scene.getObjectByName('Fuselage'));
 const beforeVertices:number[][]=old.positions,afterVertices:number[][]=Array.from(new Map<string,number[]>(after.triangles.flatMap((t:any)=>t.vertices.map((p:number[])=>[p.join(','),p]as[string,number[]]))).values()),afterVertexKeys=new Set(afterVertices.map(p=>p.join(','))),failures:any[]=[];
 const outside=beforeVertices.filter(p=>!inDomainWorld(p,domain)),lostOutside=outside.filter(p=>!afterVertexKeys.has(p.join(',')));
 if(lostOutside.length)failures.push({reason:'Original outside-domain vertex lost or moved',count:lostOutside.length,witnesses:lostOutside.slice(0,10)});
 const afterOutside=afterVertices.filter(p=>!inDomainWorld(p,domain)),beforeKeys=new Set(beforeVertices.map(p=>p.join(','))),addedOutside=afterOutside.filter(p=>!beforeKeys.has(p.join(',')));
 const outsideTri=(s:any)=>s.triangles.filter((t:any)=>t.vertices.every((p:number[])=>!inDomainWorld(p,domain))).map((t:any)=>canonicalOrientedTriangle(t.vertices)).sort();
 const beforeOutside=outsideTri(before),afterOutsideTriangles=outsideTri(after),unchangedOutsideOrientedTriangles=JSON.stringify(beforeOutside)===JSON.stringify(afterOutsideTriangles);
 const fullOutsidePatchCoverage=verifyOutsidePatchCoverage(before,after,domain,{epsilon:1e-6});if(!fullOutsidePatchCoverage.passed)failures.push({reason:'Some protected triangle area is displaced/removed/added',fullOutsidePatchCoverage});
 // Bind every old vertex to its reviewed expected deformation, then every oriented triangle to old vertex IDs.
 // Finite spatial buckets merely find candidates; the final Euclidean bound remains the exact encoding tolerance.
 const buckets=new Map<string,{p:number[],id:number}[]>(),scale=tolerance;
 const cell=(p:number[])=>p.map(v=>Math.floor(v/scale));
 afterVertices.forEach((p,id)=>{const key=cell(p).join(','),q=buckets.get(key)??[];q.push({p,id});buckets.set(key,q);});
 const afterToBefore=new Map<string,number>(),used=new Set<number>(),residuals:number[]=[],unmatched:any[]=[],actualChanged:any[]=[],supportPoints:number[][]=[];
 beforeVertices.forEach((p,i)=>{const delta=saddleLiftAtWorld(p),expected=[p[0],p[1]+delta,p[2]],c=cell(expected),candidates:any[]=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const r of buckets.get([c[0]+x,c[1]+y,c[2]+z].join(','))??[])if(!used.has(r.id)){const distance=Math.hypot(...r.p.map((v,k)=>v-expected[k]));if(distance<=tolerance)candidates.push({...r,distance});}
  candidates.sort((a,b)=>a.distance-b.distance);const found=candidates[0];if(!found){unmatched.push({vertex:i,before:p,expected,delta});return;}used.add(found.id);afterToBefore.set(found.p.join(','),i);residuals.push(found.distance);
  if(found.p.some((v:number,k:number)=>v!==p[k]))actualChanged.push({index:i,before:p,after:found.p,expectedDelta:delta,residual:found.distance});
 });
 if(unmatched.length||used.size!==afterVertices.length)failures.push({reason:'Fuselage is not the reviewed same-topology C1 vertical-only deformation',unmatchedOriginalVertices:unmatched.length,unmatchedNewVertices:afterVertices.length-used.size,witnesses:unmatched.slice(0,8)});
 const expectedTriangles=old.indices.map(canonicalOrientedTriangle).sort(),actualTriangles=after.triangles.map((t:any)=>canonicalOrientedTriangle(t.vertices.map((p:number[])=>afterToBefore.get(p.join(','))??'unmapped'))).sort(),sameOrientedTopology=JSON.stringify(expectedTriangles)===JSON.stringify(actualTriangles);
 if(!sameOrientedTopology)failures.push({reason:'Same original oriented triangle topology was not retained'});
 const changedKeys=new Set(actualChanged.map(r=>r.before.join(',')));let affectedTriangleCount=0;
 for(const t of before.triangles)if(t.vertices.some(p=>changedKeys.has(p.join(',')))){affectedTriangleCount++;supportPoints.push(...t.vertices);}
 const b=(values:number[])=>[Math.min(...values),Math.max(...values)],actualTriangleSupportBlender={absX:b(supportPoints.map(p=>Math.abs(p[0]))),y:b(supportPoints.map(p=>-p[2])),z:b(supportPoints.map(p=>p[1]))};
 if(supportPoints.some(p=>!inDomainWorld(p,domain)))failures.push({reason:'Actual affected entire triangles extend outside the reviewed finite saddle support',actualTriangleSupportBlender});
 if(actualChanged.length<1000||actualChanged.length>2000)failures.push({reason:'Unexpected deformation size',actualChangedVertices:actualChanged.length});
 if(beforeVertices.length!==afterVertices.length)failures.push({reason:'Unique physical vertex count changed'});
 reports.push({encoding,source:file,sha256:a.sha256,baselineModelSha256:old.modelSha256,encodingTolerance:tolerance,passed:!failures.length,originalVertexCount:beforeVertices.length,newVertexCount:afterVertices.length,outsideOriginalVertices:outside.length,exactPreservedOutsideVertices:outside.length-lostOutside.length,addedOutsideSubdivisionVertices:addedOutside.length,unchangedOutsideOrientedTriangles,beforeOutsideTriangles:beforeOutside.length,afterOutsideTriangles:afterOutsideTriangles.length,sameOrientedTopology,actualChangedVertices:actualChanged.length,affectedTriangleCount,actualTriangleSupportBlender,maximumReviewedDeformationResidual:residuals.length?Math.max(...residuals):null,fullOutsidePatchCoverage,failures});
}
const r={passed:reports.every(r=>r.passed),preflight,declaredContractCentralLift:contract.wingShape.centralLift,domain,reviewedC1VertexLaw:{centralLift:CENTRAL_LIFT,nonzeroVertexSupportBlender:{minimumAbsX:.25,longitudinalY:[-1.97,-.75],maximumZ:.02},fullLiftBlender:{minimumAbsX:.44,longitudinalY:[-1.83,-.89],maximumZ:-.10}},reference:{path:reference.path,sha256:reference.sha256},reports,claim:'Immediate-baseline actual outside vertices and protected full triangle area preserved; one bounded same-topology saddle deformation; no authorization of the gap to the historical rear belly slot'};
fs.writeFileSync(process.env.QA_OUT??'qa/current/fuselage-scope-report.json',JSON.stringify(r,null,2)+'\n');console.log(r);if(!r.passed)process.exitCode=1;
