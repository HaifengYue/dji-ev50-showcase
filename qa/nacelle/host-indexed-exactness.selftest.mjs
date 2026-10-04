import assert from 'node:assert/strict';
import {verifyExactIndexedHostMaterial} from './host-indexed-exactness.mjs';
const surface=(positions,indices)=>({positions,indices,positionCount:positions.length,indexCount:indices.length,triangleCount:indices.length/3});
const identity=s=>Array.from({length:s.triangleCount},(_,i)=>({rawSourceTriangle:i,rawTargetTriangle:i,cyclicCornerRotation:0}));
function fixture(){
 const original=surface([[0,0,0],[1,0,0],[0,1,0],[10,0,0],[11,0,0],[10,1,0]],[0,1,2,3,4,5]);
 const expected=surface([...original.positions.map(p=>[...p]),[10.5,0,0]],[0,1,2,3,6,5,6,4,5]);
 return {originalSurface:original,expectedSurface:expected,currentSurface:structuredClone(expected),protectedOriginalFaces:[0],unmovedExpectedVertexIds:[0,1,2,6],correspondence:identity(expected)};
}
export function runHostIndexedExactnessRegressions(){
 const results=[];const test=(name,fn)=>{fn();results.push({name,passed:true});};const reject=(name,mutate)=>test(name,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyExactIndexedHostMaterial(f));});
 test('exact indexed source material and construction boundary points pass',()=>{const r=verifyExactIndexedHostMaterial(fixture());assert(r.passed&&r.protectedOriginalTriangleCount===1&&r.exactUnmovedExpectedPoints===4);});
 test('cyclic raw corner order remains a valid exact oriented face',()=>{const f=fixture();f.currentSurface.indices.splice(0,3,1,2,0);f.correspondence[0].cyclicCornerRotation=2;assert(verifyExactIndexedHostMaterial(f).passed);});
 test('source encoding tolerance for approved changed corners remains unchanged',()=>{const f=fixture();f.currentSurface.positions[3][2]+=5e-7;assert(verifyExactIndexedHostMaterial(f).passed);});
 reject('orphan copies of old coordinates cannot hide sub-epsilon protected material drift',f=>{for(const p of f.currentSurface.positions)p[0]+=5e-7;f.currentSurface.positions.push(...f.originalSurface.positions.slice(0,3).map(p=>[...p]));f.currentSurface.positionCount+=3;});
 test('referenced exact old points on other faces cannot hide protected-face drift',()=>{
  const base=[[0,0,0],[1,0,0],[0,1,0]],p=[];for(let i=0;i<4;i++)p.push(...base.map(v=>[v[0],v[1]+i*2e-7,v[2]]));
  const expected=surface(p,Array.from({length:12},(_,i)=>i)),current=structuredClone(expected);for(let i=0;i<3;i++)current.positions[i][0]+=5e-7;current.positions[3]=[...base[0]];current.positions[7]=[...base[1]];current.positions[11]=[...base[2]];
  const actualIndexed=new Set(current.indices.map(i=>JSON.stringify(current.positions[i])));assert(base.every(p=>actualIndexed.has(JSON.stringify(p))));
  assert.throws(()=>verifyExactIndexedHostMaterial({originalSurface:expected,expectedSurface:expected,currentSurface:current,protectedOriginalFaces:[0],unmovedExpectedVertexIds:[0,1,2],correspondence:identity(expected)}),/multiplicity/);
 });
 reject('protected face displacement below 1e-6 is still rejected',f=>{for(let i=0;i<3;i++)f.currentSurface.positions[i][0]+=5e-7;});
 reject('reversed protected winding is rejected',f=>{f.currentSurface.indices.splice(0,3,0,2,1);});
 reject('deleted protected face cannot be replaced by a different face',f=>{f.currentSurface.indices.splice(0,3,3,6,5);});
 test('duplicate protected-face multiplicity is rejected even with every raw position still used',()=>{const expected=surface([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],[0,1,2,0,1,3,0,2,3,1,2,3]),current=structuredClone(expected);current.indices.splice(3,3,0,1,2);assert.equal(new Set(current.indices).size,4);assert.throws(()=>verifyExactIndexedHostMaterial({originalSurface:expected,expectedSurface:expected,currentSurface:current,protectedOriginalFaces:[0],unmovedExpectedVertexIds:[0,1,2],correspondence:identity(expected)}),/multiplicity/);});
 test('unmoved subdivision midpoint cannot drift even when its old coordinate is indexed on another nondegenerate face',()=>{const original=surface([[0,0,0],[1,0,0],[0,1,0],[10,0,0],[11,0,0],[10,1,0],[10.5,0,2e-7],[11,1,0],[10.5,1,1]],[0,1,2,3,4,5,6,7,8]),expected=surface([...original.positions.map(p=>[...p]),[10.5,0,0]],[0,1,2,3,9,5,9,4,5,6,7,8]),current=structuredClone(expected);current.positions[9][1]+=5e-7;current.positions[6]=[10.5,0,0];assert(current.indices.some(i=>JSON.stringify(current.positions[i])===JSON.stringify(expected.positions[9])));assert.throws(()=>verifyExactIndexedHostMaterial({originalSurface:original,expectedSurface:expected,currentSurface:current,protectedOriginalFaces:[0],unmovedExpectedVertexIds:[0,1,2,9],correspondence:identity(expected)}),/unmoved expected corner/);});
 reject('unused extra position is rejected even when all original faces are intact',f=>{f.currentSurface.positions.push([0,0,0]);f.currentSurface.positionCount++;});
 reject('nonfinite current position is rejected',f=>{f.currentSurface.positions[0][0]=NaN;});
 reject('incomplete raw indices are rejected',f=>{f.currentSurface.indices.pop();});
 reject('invalid raw index is rejected',f=>{f.currentSurface.indices[0]=99;});
 reject('zero-area fake index usage cannot establish physical preservation',f=>{f.currentSurface.indices.splice(3,3,3,3,3);});
 reject('protected and allowed original coordinate keys may not ambiguously overlap',f=>{f.originalSurface.indices.splice(3,3,0,1,2);});
 reject('empty protected face permission is rejected',f=>{f.protectedOriginalFaces=[];});
 reject('duplicated protected face permission is rejected',f=>{f.protectedOriginalFaces=[0,0];});
 reject('incomplete full correspondence is rejected',f=>{f.correspondence.pop();});
 reject('duplicate correspondence target is rejected',f=>{f.correspondence[1].rawTargetTriangle=0;});
 reject('unmapped or duplicate zero-point declaration is rejected',f=>{f.unmovedExpectedVertexIds.push(6);});
 return {passed:true,caseCount:results.length,results};
}
if(import.meta.url===new URL(process.argv[1],'file:').href)console.log(JSON.stringify(runHostIndexedExactnessRegressions(),null,2));
