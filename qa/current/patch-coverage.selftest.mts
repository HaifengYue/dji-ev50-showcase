import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import { createWorldTriangles } from '../lib/triangle-contact.mjs';
import { solidTopology } from '../lib/solid-contact.mjs';
import { verifyOutsidePatchCoverage, proveOutsidePatchCoverage } from './patch-coverage.mts';
const domain={minimumAbsX:.074,maximumAbsX:.3,longitudinalY:[.76416,2.1],verticalZ:[-.2,.22]};
function snapshot(points:number[][],faces:number[][]){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float64Array(faces.flatMap(f=>f.flatMap(i=>points[i]))),3));const mesh=new T.Mesh(g);mesh.updateMatrixWorld();return createWorldTriangles(mesh);}
const tetraFaces=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]],tetra=[[0,0,-1],[.2,-.1,-.9],[.2,.1,-.9],[.2,0,-1.1]],moved=tetra.map(p=>p.slice());moved[1]=[.2,-.02,-.9];
const ta=snapshot(tetra,tetraFaces),tb=snapshot(moved,tetraFaces);assert(solidTopology(ta).closed&&solidTopology(tb).closed);
const escaped=verifyOutsidePatchCoverage(ta,tb,domain);assert(!escaped.passed,'Closed tetra counterexample must fail');
const square=[[-.05,0,-1],[.05,0,-1],[.05,0,-1.2],[-.05,0,-1.2]],a=snapshot(square,[[0,1,2],[0,2,3]]),b=snapshot(square,[[0,1,3],[1,2,3]]);
assert(verifyOutsidePatchCoverage(a,b,domain).passed,'Coplanar retriangulation must pass');
const center=[0,0,-1.1],subdivided=snapshot([...square,center],[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]);assert(verifyOutsidePatchCoverage(a,subdivided,domain).passed,'Coplanar subdivision must pass');
const offset=snapshot(square.map(p=>[p[0],p[1]+.9e-6,p[2]]),[[0,1,3],[1,2,3]]);assert(verifyOutsidePatchCoverage(a,offset,domain).passed,'Bounded normal storage error must pass');
const far=snapshot(square.map(p=>[p[0],p[1]+1.1e-6,p[2]]),[[0,1,3],[1,2,3]]);assert(!verifyOutsidePatchCoverage(a,far,domain).passed,'Error above 1e-6 must fail');
const hole=snapshot(square,[[0,1,2]]);assert(!verifyOutsidePatchCoverage(a,hole,domain).passed,'Missing protected area must fail');
const inside=snapshot([[.1,0,-1],[.2,0,-1],[.15,.1,-1.2]],[[0,1,2]]),empty={triangles:[]};assert(verifyOutsidePatchCoverage(inside,empty,domain).passed,'Entirely authorized-volume changes require no outside proof');
const boundary=snapshot([[.074,0,-1],[.074,.1,-1],[.074,0,-1.2]],[[0,1,2]]);assert(!proveOutsidePatchCoverage(boundary,empty,domain).passed,'Central boundary itself remains protected');
assert(!verifyOutsidePatchCoverage(empty,a,domain).passed,'Bidirectionality must reject added protected-area material');
assert.throws(()=>verifyOutsidePatchCoverage(a,b,domain,{epsilon:1.01e-6}));
// Differently centered coplanar fans used to leave near-collinear 1e-17-wide
// fragments when a late triangle cut a piece covered by an already visited one.
// No fragment is discarded on area: the new all-candidate rescan must certify it.
const count=5,z=-2.7200000286102295,ring=Array.from({length:count},(_,i)=>[.003*Math.cos(i*2*Math.PI/count+.17),.1+.006*Math.sin(i*2*Math.PI/count+.17),z]),fanFaces=ring.map((_,i)=>[i,(i+1)%count,count]);
const fanA=snapshot([...ring,[.000121,.10022,z]],fanFaces),fanB=snapshot([...ring,[-.00035,.09958,z]],fanFaces.slice().reverse());
let rescanCertificates=0,orderCases=0;
for(const reverse of [false,true])for(let rotation=0;rotation<count;rotation++){
  const ordered=reverse?fanB.triangles.slice().reverse():fanB.triangles.slice(),rotated=[...ordered.slice(rotation),...ordered.slice(0,rotation)];
  // Omit the BVH to exercise precisely the requested candidate ordering.
  const result=verifyOutsidePatchCoverage({triangles:fanA.triangles},{triangles:rotated},domain);
  assert(result.passed,`Full coplanar fan coverage failed at reverse=${reverse}, rotation=${rotation}`);
  rescanCertificates+=result.beforeToAfter.stats.wholeFragmentRescanCertificates+result.afterToBefore.stats.wholeFragmentRescanCertificates;orderCases++;
}
assert(rescanCertificates>0,'Regression must actually exercise residual recertification');
// Two separated authorizations must not silently authorize their bounding-box gap.
const saddleDomain={minimumAbsX:.074,maximumAbsX:.3,longitudinalY:[-3,-2],verticalZ:[-.2,.22]};
const separated=[domain,saddleDomain];
assert.deepEqual(verifyOutsidePatchCoverage(a,b,[domain]),verifyOutsidePatchCoverage(a,b,domain),'Single-domain array remains exactly backward-compatible');
const gap=snapshot([[.1,0,0],[.2,0,0],[.15,.1,.2]],[[0,1,2]]);
assert(!verifyOutsidePatchCoverage(gap,empty,separated).passed,'Protected space between domains must not be authorized');
const spanning=snapshot([[.1,0,-1],[.2,0,2.5],[.1,.1,2.5]],[[0,1,2]]);
assert(!verifyOutsidePatchCoverage(spanning,empty,separated).passed,'Triangle whose vertices lie in two domains still has a protected cross-domain interior');
const saddleInside=snapshot([[.1,0,2.2],[.2,0,2.2],[.15,.1,2.5]],[[0,1,2]]);
assert(verifyOutsidePatchCoverage({triangles:[...inside.triangles,...saddleInside.triangles]},empty,separated).passed,'Separated authorized-volume changes may both pass');
assert(!verifyOutsidePatchCoverage(empty,gap,separated).passed,'Added inter-domain bridge must fail bidirectionally');
assert(!verifyOutsidePatchCoverage(boundary,empty,separated).passed,'Second domain never relaxes first protected boundary');
assert.throws(()=>verifyOutsidePatchCoverage(a,b,[]));
assert.throws(()=>verifyOutsidePatchCoverage(a,b,[domain,{...saddleDomain,maximumAbsX:Infinity}]));
const report={passed:true,cases:['closed tetra protected-patch displacement rejected','coplanar retriangulation','coplanar subdivision','bounded 0.9e-6 encoding drift','1.1e-6 drift rejected','protected hole rejected','authorized-volume edit','central boundary protected','bidirectional added-area rejection','no tolerance relaxation','multi-triangle coplanar coverage independent of traversal order'],multipleDomainCases:8,coplanarFanOrderCases:orderCases,rescanCertificates,tetraFailure:escaped.beforeToAfter.failures[0],epsilon:1e-6};
if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
