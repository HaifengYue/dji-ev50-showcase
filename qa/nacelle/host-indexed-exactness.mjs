/** Proposed source-only supplementary gate. Pure data function; no filesystem access.
 * Keep the existing whole-surface source 1e-6/runtime 6e-5 proof unchanged.
 * Production integration must supply the immutable original seam, protected IDs 16..103,
 * independently reconstructed expected surface/mappings and its current full correspondence.
 */
import assert from 'node:assert/strict';
const pointKey=p=>JSON.stringify(p);
const triangleKey=ps=>[0,1,2].map(r=>JSON.stringify([ps[r],ps[(r+1)%3],ps[(r+2)%3]])).sort()[0];
function validate(s){
 assert(Array.isArray(s.positions)&&s.positions.length===s.positionCount);
 assert(Array.isArray(s.indices)&&s.indices.length===s.indexCount&&s.indexCount===3*s.triangleCount&&Number.isSafeInteger(s.triangleCount)&&s.triangleCount>0);
 assert(s.positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)));
 assert(s.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<s.positionCount));
 for(let i=0;i<s.triangleCount;i++){const[a,b,c]=s.indices.slice(3*i,3*i+3).map(j=>s.positions[j]),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert(n.every(Number.isFinite)&&Math.hypot(...n)>0,'Every raw triangle must be finite and nondegenerate; fake zero-area index usage is not material');}
}
const vertices=(s,id)=>s.indices.slice(3*id,3*id+3).map(i=>s.positions[i]);
const equalPoint=(a,b)=>a.every((x,k)=>x===b[k]);
const bag=(s,ids)=>{const out=new Map();for(const id of ids){const key=triangleKey(vertices(s,id)),a=out.get(key)??[];a.push(id);out.set(key,a);}return out;};
const allIds=s=>Array.from({length:s.triangleCount},(_,i)=>i);
export function verifyExactIndexedHostMaterial({originalSurface,expectedSurface,currentSurface,protectedOriginalFaces,unmovedExpectedVertexIds,correspondence}){
 for(const s of [originalSurface,expectedSurface,currentSurface])validate(s);
 assert.equal(expectedSurface.triangleCount,currentSurface.triangleCount);
 assert(protectedOriginalFaces.length>0&&new Set(protectedOriginalFaces).size===protectedOriginalFaces.length);
 assert(protectedOriginalFaces.every(i=>Number.isSafeInteger(i)&&i>=0&&i<originalSurface.triangleCount));
 assert(new Set(unmovedExpectedVertexIds).size===unmovedExpectedVertexIds.length);
 assert(unmovedExpectedVertexIds.every(i=>Number.isSafeInteger(i)&&i>=0&&i<expectedSurface.positionCount));
 const currentUsed=new Set(currentSurface.indices),currentKeys=new Set([...currentUsed].map(i=>pointKey(currentSurface.positions[i])));
 assert.equal(currentUsed.size,currentSurface.positionCount,'Every current raw position must participate in actual indexed material; orphan buffer points cannot establish exact preservation');
 const originalBag=bag(originalSurface,protectedOriginalFaces),allOriginalBag=bag(originalSurface,allIds(originalSurface)),currentBag=bag(currentSurface,allIds(currentSurface)),protectedCorrespondence=[];
 for(const [key,oldIds]of originalBag){
  assert.equal(allOriginalBag.get(key).length,oldIds.length,'Protected and allowed original face keys must not overlap ambiguously');
  const actualIds=currentBag.get(key)??[];
  assert.equal(actualIds.length,oldIds.length,'Protected source oriented triangle coordinates and multiplicity must be exactly unchanged');
  for(let k=0;k<oldIds.length;k++){
   const a=vertices(originalSurface,oldIds[k]),b=vertices(currentSurface,actualIds[k]);
   const rotation=[0,1,2].find(r=>a.every((p,i)=>equalPoint(p,b[(i+r)%3])));assert.notEqual(rotation,undefined);
   protectedCorrespondence.push({originalTriangle:oldIds[k],currentTriangle:actualIds[k],cyclicCornerRotation:rotation,maximumEndpointError:0});
  }
 }
 const originalProtectedPoints=new Set(protectedOriginalFaces.flatMap(id=>vertices(originalSurface,id).map(pointKey)));
 assert([...originalProtectedPoints].every(p=>currentKeys.has(p)),'Original protected points must be on indexed material');
 // Check each zero-displacement corner on its actual whole-surface correspondence,
 // not merely a coincident old point that might appear on another face.
 assert(Array.isArray(correspondence)&&correspondence.length===expectedSurface.triangleCount);
 const sourceIds=new Set(),targetIds=new Set(),zero=new Set(unmovedExpectedVertexIds),seenZero=new Set(),exactCornerRows=[];
 for(const c of correspondence){
  assert(Number.isSafeInteger(c.rawSourceTriangle)&&c.rawSourceTriangle>=0&&c.rawSourceTriangle<expectedSurface.triangleCount&&!sourceIds.has(c.rawSourceTriangle));
  assert(Number.isSafeInteger(c.rawTargetTriangle)&&c.rawTargetTriangle>=0&&c.rawTargetTriangle<currentSurface.triangleCount&&!targetIds.has(c.rawTargetTriangle));
  assert(Number.isInteger(c.cyclicCornerRotation)&&c.cyclicCornerRotation>=0&&c.cyclicCornerRotation<3);
  sourceIds.add(c.rawSourceTriangle);targetIds.add(c.rawTargetTriangle);
  const sourceIndices=expectedSurface.indices.slice(3*c.rawSourceTriangle,3*c.rawSourceTriangle+3),targetIndices=currentSurface.indices.slice(3*c.rawTargetTriangle,3*c.rawTargetTriangle+3);
  for(let k=0;k<3;k++){
   const i=sourceIndices[k],j=targetIndices[(k+c.cyclicCornerRotation)%3],a=expectedSurface.positions[i],b=currentSurface.positions[j];
   assert(Math.hypot(...a.map((v,n)=>v-b[n]))<=1e-6,'Correspondence must retain the original source bound');
   if(zero.has(i)){assert(equalPoint(a,b),'Every unmoved expected corner must remain exact on its actual paired indexed triangle');seenZero.add(i);exactCornerRows.push({expectedVertex:i,sourceTriangle:c.rawSourceTriangle,currentTriangle:c.rawTargetTriangle,currentRawPosition:j});}
  }
 }
 assert.equal(seenZero.size,zero.size,'Every prescribed unchanged construction point must be actually indexed');
 return {passed:true,sourceExactProtection:true,rawUnusedPositions:0,referencedCurrentRawPositions:currentUsed.size,protectedOriginalTriangleCount:protectedOriginalFaces.length,protectedOriginalPhysicalPoints:originalProtectedPoints.size,exactUnmovedExpectedPoints:seenZero.size,exactUnmovedCornerCount:exactCornerRows.length,protectedCorrespondence,exactCornerRows};
}
