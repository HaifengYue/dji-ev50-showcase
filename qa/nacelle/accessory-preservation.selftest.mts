/** Adversarial shape/coverage checks; all run on raw actual triangle arrays. */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {proveAccessoryTriangleBijection,proveAccessorySurfacePreservation,validateRawSurface,type RawSurface} from './accessory-preservation.mts';
const raw=(positions:number[][],indices:number[],name='synthetic-accessory'):RawSurface=>({name,positions,indices,positionCount:positions.length,indexCount:indices.length,triangleCount:indices.length/3});
const square=()=>raw([[0,0,0],[1,0,0],[1,1,0],[0,1,0]],[0,1,2,0,2,3]);
const fan=()=>raw([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[.5,.5,0]],[0,1,4,1,2,4,2,3,4,3,0,4]);
const clone=(s:RawSurface)=>structuredClone(s);
export function runAccessoryPreservationRegressions(){
 const results:{name:string;passed:boolean}[]=[];
 const test=(name:string,fn:()=>void)=>{fn();results.push({name,passed:true});};
 for(const encoding of ['source','runtime'] as const){
  test(encoding+': unchanged complete raw actual surface',()=>assert(proveAccessorySurfacePreservation(square(),square(),encoding).passed));
  test(encoding+': cyclic corner and arbitrary triangle ordering accepted',()=>{const a=square(),b=square();b.indices=[2,3,0,1,2,0];const r=proveAccessoryTriangleBijection(a,b,1e-6);assert(r.passed);assert.equal(r.pairedRawTriangleCount,2);});
  test(encoding+': exact inverse .029 local rebase keeps cruise material',()=>{const a=square(),b=square();b.positions=b.positions.map(p=>[p[0],(p[1]-.029)+.029,p[2]]);assert(proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': same oriented whole face with opposite diagonal accepted only by full coverage',()=>{const a=square(),b=square();b.indices=[0,1,3,1,2,3];assert(!proveAccessoryTriangleBijection(a,b,1e-6).passed);const r=proveAccessorySurfacePreservation(a,b,encoding);assert(r.passed);assert.equal(r.method,'complete-bidirectional-oriented-actual-surface-coverage');assert.equal(r.certificate?.completeTriangleAccounting.after.skippedDegenerate,0);assert.equal(r.certificate?.excludedSurfacePoints,0);});
  test(encoding+': non-rigid interior bulge beyond encoding ceiling rejected',()=>{const a=fan(),b=fan();b.positions[4][2]=encoding==='source'?.00002:.0002;assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': missing raw triangle rejected before coverage',()=>{const a=square(),b=raw(a.positions,[0,1,2]);assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': lost face replaced by duplicate triangle rejected',()=>{const a=square(),b=square();b.indices=[0,1,2,0,1,2];assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': wrong-axis .029 rigid displacement rejected',()=>{const a=square(),b=square();b.positions=b.positions.map(p=>[p[0]+.029,p[1],p[2]]);assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': unrebased vertical .029 world displacement rejected',()=>{const a=square(),b=square();b.positions=b.positions.map(p=>[p[0],p[1]+.029,p[2]]);assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': equal point set with reversed material winding rejected',()=>{const a=square(),b=square();b.indices=[0,2,1,0,3,2];assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': mirror with unchanged surface locus and mirrored normals rejected',()=>{const a=square(),b=square();b.positions=b.positions.map(p=>[1-p[0],p[1],p[2]]);assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
  test(encoding+': re-triangulated same-boundary interior hole rejected',()=>{const a=raw([[0,0,0],[.5,0,0],[1,0,0],[1,.5,0],[1,1,0],[.5,1,0],[0,1,0],[0,.5,0],[.5,.5,0]],Array.from({length:8},(_,i)=>[i,(i+1)%8,8]).flat()),b=raw([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[.4,.4,0],[.6,.4,0],[.6,.6,0],[.4,.6,0]],Array.from({length:4},(_,i)=>[i,(i+1)%4,4+(i+1)%4,i,4+(i+1)%4,4+i]).flat());assert(!proveAccessorySurfacePreservation(a,b,encoding).passed);});
 }
 test('positive tiny nonzero triangle retained, never relatively filtered',()=>{const a=raw([[0,0,0],[1,0,0],[.5,1e-12,0]],[0,1,2]);const r=proveAccessoryTriangleBijection(a,a,1e-6);assert(r.passed);assert.equal(r.completeTriangleAccounting.before.checkedTriangles,1);assert.equal(r.completeTriangleAccounting.skippedTriangles,0);});
 test('positive coincident raw multiplicity retained by full bijection',()=>{const a=raw([[0,0,0],[1,0,0],[0,1,0]],[0,1,2,0,1,2]);const r=proveAccessoryTriangleBijection(a,a,1e-6);assert(r.passed);assert.equal(r.pairedRawTriangleCount,2);assert.equal(new Set(r.correspondence?.map(p=>p.rawTargetTriangle)).size,2);});
 test('true zero-area indexed triangle rejected explicitly',()=>assert.throws(()=>validateRawSurface(raw([[0,0,0],[1,0,0],[2,0,0]],[0,1,2])),/True zero-area/));
 test('truncated raw metadata cannot hide triangle deletion',()=>{const a=square();a.indices.splice(3,3);assert.throws(()=>validateRawSurface(a),/raw actual index/);});
 test('out-of-range raw index rejected explicitly',()=>{const a=square();a.indices[0]=42;assert.throws(()=>validateRawSurface(a),/Invalid raw triangle index/);});
 test('nonfinite raw position rejected explicitly',()=>{const a=square();a.positions[0][0]=NaN;assert.throws(()=>validateRawSurface(a),/Nonfinite actual raw geometry/);});
 test('no widened geometry bound is accepted',()=>assert.throws(()=>proveAccessoryTriangleBijection(square(),square(),1e-4),/Only original source\/runtime/));
 return {passed:results.every(r=>r.passed),caseCount:results.length,results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=runAccessoryPreservationRegressions();console.log(JSON.stringify(report));}
