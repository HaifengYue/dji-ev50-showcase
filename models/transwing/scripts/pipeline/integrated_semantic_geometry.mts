/** Material primitives form one physical owner; never test their open patches as separate solids. */
import assert from 'node:assert/strict';
import * as THREE from '../../../../threejs/node_modules/three/build/three.module.js';
const trianglesModule='../../qa/lib/triangle-contact.mjs';
const {createWorldTriangles}=await import(trianglesModule);
export function createOwnerWorldTriangles(owner:THREE.Object3D){
 owner.updateWorldMatrix(true,true);
 const vertices:number[]=[],localVertices:number[]=[],primitiveNames:string[]=[];
 const point=new THREE.Vector3();
 const parts=owner instanceof THREE.Mesh?[owner]:owner.children;
 assert.ok(parts.length>0&&parts.every(part=>part instanceof THREE.Mesh),'Expected one mesh owner or its direct material primitives, not an articulated subtree');
 for(const object of parts){
  const part=object as THREE.Mesh;
  assert.equal(Boolean((part as THREE.SkinnedMesh).isSkinnedMesh),false);
  assert.equal(Boolean((part as THREE.InstancedMesh).isInstancedMesh),false);
  assert.ok(!part.morphTargetInfluences?.some(v=>v!==0));
  primitiveNames.push(part.name);
  const p=part.geometry.getAttribute('position'),ix=part.geometry.index;
  const count=ix?.count??p.count;assert.equal(count%3,0);
  for(let i=0;i<count;i++){point.fromBufferAttribute(p,ix?ix.getX(i):i);if(part!==owner)point.applyMatrix4(part.matrix);localVertices.push(point.x,point.y,point.z);point.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(part.matrixWorld);vertices.push(point.x,point.y,point.z);}
 }
 assert.ok(primitiveNames.length>0,'No physical material for owner '+owner.name);
 const geometry=new THREE.BufferGeometry();
 // Float64 preserves the same world-coordinate arithmetic as the existing
 // triangle helper. No weld, simplification or material/precision relaxation.
 geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(vertices),3));
 const mesh=new THREE.Mesh(geometry);mesh.name=owner.name;mesh.updateMatrixWorld(true);
 const snapshot=createWorldTriangles(mesh);geometry.dispose();
 const retained=new Set(snapshot.triangles.map((t:any)=>t.triangleIndex));
 const rawTriangles=Array.from({length:vertices.length/9},(_,triangleIndex)=>({triangleIndex,vertices:[0,1,2].map(i=>vertices.slice(triangleIndex*9+i*3,triangleIndex*9+i*3+3))}));
 const rawLocalTriangles=Array.from({length:localVertices.length/9},(_,triangleIndex)=>({triangleIndex,vertices:[0,1,2].map(i=>localVertices.slice(triangleIndex*9+i*3,triangleIndex*9+i*3+3))}));
 return{snapshot,primitiveNames,triangleCount:vertices.length/9,rawTriangles,rawLocalTriangles,skippedTriangles:rawTriangles.filter(t=>!retained.has(t.triangleIndex))};
}
