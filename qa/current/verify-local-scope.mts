/** 所有变化必须限于两側机腹长槽的有界体积；中央底板、整机其余面及机构不得挪动。 */
import {loadReferenceAudit} from './reference-data.mts';
import {verifyOutsidePatchCoverage} from './patch-coverage.mts';
import {surfaceDistance} from '../lib/solid-contact.mjs';import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {loadAudit} from './audit-scene.mts';
const c=JSON.parse(fs.readFileSync('qa/contracts/fuselage-slot-refinement.json','utf8'));
const b=loadReferenceAudit(),a=await loadAudit(process.env.QA_MODEL??'assets/blender/xp4-source.glb');
const region=c.localDeformationDomainBlender;assert(region,'必须显式给出且独立复审机腹局部变形界限');
const inRegion=(p:number[])=>{const [x,z,negY]=p,y=-negY;return Math.abs(x)>=region.minimumAbsX&&Math.abs(x)<=region.maximumAbsX&&y>=region.longitudinalY[0]&&y<=region.longitudinalY[1]&&z>=region.verticalZ[0]&&z<=region.verticalZ[1];};
const sha=(v:any)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonical=(tri:any)=>{const v=tri.vertices.map((p:number[])=>p.join(','));return [v.join('|'),[v[1],v[2],v[0]].join('|'),[v[2],v[0],v[1]].join('|')].sort()[0];};
const rows:any[]=[],failures:any[]=[];
for(const name of c.localScopeMeshes??c.geometryChanges){
 const before=b.snap(b.scene.getObjectByName(name)!),after=a.snap(a.scene.getObjectByName(name)!);
 const outside=(s:any)=>s.triangles.filter(t=>t.vertices.every(p=>!inRegion(p))).map(canonical).sort();
 const av=outside(before),bv=outside(after);const exactOutsideTriangles=JSON.stringify(av)===JSON.stringify(bv);
 const triangleDistance=(p:number[],snap:any)=>surfaceDistance(p,snap).distance;
 const outsideSamples=(snap:any)=>snap.triangles.flatMap(t=>[...t.vertices,t.vertices[0].map((x:number,k:number)=>(x+t.vertices[1][k]+t.vertices[2][k])/3)]).filter(p=>!inRegion(p));
 const beforeKeys=new Set(before.triangles.map(canonical)),afterKeys=new Set(after.triangles.map(canonical));
 const changedBefore={triangles:before.triangles.filter(t=>!afterKeys.has(canonical(t)))},changedAfter={triangles:after.triangles.filter(t=>!beforeKeys.has(canonical(t)))};
 const witnesses=[...outsideSamples(changedBefore).map(p=>({point:p,direction:"before-to-after",distance:triangleDistance(p,after)})),...outsideSamples(changedAfter).map(p=>({point:p,direction:"after-to-before",distance:triangleDistance(p,before)}))];
 const distances=witnesses.map(r=>r.distance),worstOutsideSamples=witnesses.sort((a,b)=>b.distance-a.distance).slice(0,8);
 const maximumOutsideSurfaceDifference=distances.length?Math.max(...distances):0,fullPatchCoverage=verifyOutsidePatchCoverage(before,after,region,{epsilon:1e-6}),passed=maximumOutsideSurfaceDifference<=1e-6&&fullPatchCoverage.passed;
 if(!passed)failures.push({name,reason:'局部域外重新细分面偏离实际原表面',maximumOutsideSurfaceDifference,maximumAllowed:1e-6,worstOutsideSamples,fullPatchCoverage});
 const outsideVertices=(s:any)=>[...new Set(s.triangles.flatMap(t=>t.vertices.filter(p=>!inRegion(p)).map(p=>p.join(','))))].sort();
 const op=outsideVertices(before),np=outsideVertices(after),beforeSet=new Set(op),afterSet=new Set(np),lost=op.filter(p=>!afterSet.has(p)),added=np.filter(p=>!beforeSet.has(p));
 // 有界区域外不允许移动任何原顶点；局部细分可在跨界三角边生成共线点，另记录而不伪称精确同拓扑。
 if(lost.length)failures.push({name,reason:'局部范围外原顶点丢失或移动',lost:lost.slice(0,8)});
 rows.push({name,outsideOriginalVertices:op.length,preservedOutsideOriginalVertices:op.length-lost.length,newOutsideSubdivisionVertices:added.length,unchangedOutsideOrientedTriangles:exactOutsideTriangles,maximumOutsideSurfaceDifference,outsideSurfaceSamples:distances.length,worstOutsideSamples,fullPatchCoverage,beforeOutsideTriangles:av.length,afterOutsideTriangles:bv.length,beforeHash:sha(av),afterHash:sha(bv),passed:passed&&!lost.length});
}
const r={passed:!failures.length,source:a.source,sha256:a.sha256,baselineSha256:b.acceptedModelSha256,referenceArtifact:{path:b.source,sha256:b.sha256},domain:region,rows,failures};fs.writeFileSync(process.env.QA_OUT??'qa/current/local-scope-report.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;
