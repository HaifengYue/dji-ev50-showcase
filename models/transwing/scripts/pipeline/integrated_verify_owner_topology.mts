/** V27 full material-owner topology with original area and SAT thresholds. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from '../../../../threejs/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../../../threejs/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../../../../threejs/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import {createOwnerWorldTriangles} from './integrated_semantic_geometry.mts';
import {ROOT,STAGE,sha,identityContext,verifyBakedOutput,verifyRawInventory} from './integrated_identity_context.mjs';
const mod='../../qa/lib/solid-contact.mjs';
const {solidTopology}=await import(mod);
fs.writeFileSync(path.join(STAGE,'SEMANTIC_OWNER_TOPOLOGY_CHECK.json'),JSON.stringify({passed:false,revision:27,status:'running-or-interrupted',integrationApproved:false})+'\n');
const context=identityContext();
const strictNames=[...new Set([...context.receipt.lowerSkinMaterialOwners,...context.newMeshOwnersComparedToFrozenM])].sort();
assert.ok(strictNames.includes('Composite_wing_L')&&strictNames.includes('Composite_wing_R'));
const area=(triangle:any)=>{const[a,b,c]=triangle.vertices.map((point:number[])=>new THREE.Vector3(...point as [number,number,number]));return b.sub(a).cross(c.sub(a)).length()/2;};
const rows:any[]=[];
for(const file of ['xp4-source.glb','xp4.glb']){
 const bytes=fs.readFileSync(path.join(STAGE,file)),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const {map}=verifyRawInventory(context,json,file);
 if(file==='xp4-source.glb')verifyBakedOutput(context,file,bytes);
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 for(const name of strictNames){
  const owner=gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  assert.ok(owner,'Missing physical owner '+name);assert.ok(map.get(name)?.mesh!==undefined,'Strict owner is not mesh-owning '+name);
  const out=createOwnerWorldTriangles(owner),topology=solidTopology(out.snapshot),rawTopology=solidTopology({triangles:out.rawTriangles});
  assert.equal(out.primitiveNames.length,json.meshes[map.get(name).mesh].primitives.length,'A material primitive was omitted from '+name);
  const zeroAreaTriangles=out.rawTriangles.filter(triangle=>area(triangle)===0).map(triangle=>triangle.triangleIndex);
  const localAreas=out.rawLocalTriangles.map(area),minimumOwnerLocalTriangleArea=Math.min(...localAreas);
  const ownerLocalBelowOrEqual1e18=localAreas.flatMap((value,index)=>value<=1e-18?[index]:[]);
  rows.push({file,sha256:sha(bytes),node:name,loaderType:owner.type,primitives:out.primitiveNames,sourceTriangleCount:out.triangleCount,rawTopology,zeroAreaTriangles,minimumOwnerLocalTriangleArea,ownerLocalBelowOrEqual1e18,unchangedCollisionSnapshotTopology:topology,skippedDegenerate:out.snapshot.skippedDegenerate,skippedTriangles:out.skippedTriangles.map(triangle=>({...triangle,worldArea:area(triangle),ownerLocalVertices:triangle.vertices.map(vertex=>owner.worldToLocal(new THREE.Vector3(...vertex as [number,number,number])).toArray())}))});
 }
}
const passed=rows.every(row=>row.rawTopology.closed&&row.rawTopology.componentCount===1&&row.zeroAreaTriangles.length===0&&row.ownerLocalBelowOrEqual1e18.length===0&&row.skippedDegenerate===0&&row.unchangedCollisionSnapshotTopology.closed);
const report={passed,revision:27,sourceCandidateSha256:context.sourceCandidateSha256,strictGateOwnerNames:strictNames,jointMaterialAcceptanceImplied:false,appearanceAccepted:false,integrationApproved:false,rows,unchangedThresholds:{ownerLocalMinimumAreaExclusive:1e-18,triangleContactModuleSha256:sha(fs.readFileSync(path.join(ROOT,'qa/lib/triangle-contact.mjs'))),solidContactModuleSha256:sha(fs.readFileSync(path.join(ROOT,'qa/lib/solid-contact.mjs')))},scope:'Aggregate all material primitives of each current lower-skin physical owner and any newly added owner; preserve V26 area and original SAT filtering gates exactly. Raw topology and the unchanged collision snapshot must both pass. No appearance, material-thickness, clearance, collision or global aircraft acceptance is implied.'};
fs.writeFileSync(path.join(STAGE,'SEMANTIC_OWNER_TOPOLOGY_CHECK.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,rows:rows.map(row=>({...row,skippedTriangles:row.skippedTriangles,rawTopology:{closed:row.rawTopology.closed,components:row.rawTopology.componentCount,boundaryEdges:row.rawTopology.boundaryEdgeCount,nonmanifoldEdges:row.rawTopology.nonmanifoldEdgeCount},unchangedCollisionSnapshotTopology:{closed:row.unchangedCollisionSnapshotTopology.closed,components:row.unchangedCollisionSnapshotTopology.componentCount,boundaryEdges:row.unchangedCollisionSnapshotTopology.boundaryEdgeCount}}))},null,2));
if(!passed)process.exitCode=1;
