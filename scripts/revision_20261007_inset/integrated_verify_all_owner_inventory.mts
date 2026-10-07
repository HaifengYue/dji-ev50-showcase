/** V27 exhaustive physical-owner inventory; coatings and defects are reported without exemptions. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createOwnerWorldTriangles} from './integrated_semantic_geometry.mts';
import {STAGE,sha,identityContext,verifyBakedOutput,verifyRawInventory} from './integrated_identity_context.mjs';
const mod='../../qa/lib/solid-contact.mjs';
const {solidTopology}=await import(mod);
fs.writeFileSync(path.join(STAGE,'ALL_OWNER_TOPOLOGY_INVENTORY.json'),JSON.stringify({inventoryComplete:false,revision:27,status:'running-or-interrupted',integrationApproved:false})+'\n');
const context=identityContext(),files:any[]=[];
const area=(triangle:any)=>{const[a,b,c]=triangle.vertices.map((point:number[])=>new THREE.Vector3(...point as [number,number,number]));return b.sub(a).cross(c.sub(a)).length()/2;};
for(const name of ['xp4-source.glb','xp4.glb']){
 const bytes=fs.readFileSync(path.join(STAGE,name)),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 verifyRawInventory(context,json,name);if(name==='xp4-source.glb')verifyBakedOutput(context,name,bytes);
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const rows:any[]=[];
 for(const node of json.nodes.filter((node:any)=>node.mesh!==undefined)){
  const owner=gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(node.name));assert.ok(owner,'Missing full owner '+node.name);
  const out=createOwnerWorldTriangles(owner),raw=solidTopology({triangles:out.rawTriangles}),collision=solidTopology(out.snapshot),areas=out.rawLocalTriangles.map(area);
  assert.equal(out.primitiveNames.length,json.meshes[node.mesh].primitives.length,'Incomplete material-owner primitives '+node.name);
  rows.push({node:node.name,loaderType:owner.type,primitiveNames:out.primitiveNames,sourceTriangleCount:out.triangleCount,rawTopology:{closed:raw.closed,components:raw.componentCount,boundaryEdges:raw.boundaryEdgeCount,nonmanifoldEdges:raw.nonmanifoldEdgeCount},ownerLocalMinimumArea:Math.min(...areas),ownerLocalZeroAreaTriangles:areas.filter(value=>value===0).length,ownerLocalAtOrBelow1e18:areas.filter(value=>value<=1e-18).length,originalSatSkippedDegenerate:out.snapshot.skippedDegenerate,originalSatClosed:collision.closed});
 }
 assert.deepEqual(rows.map(row=>row.node).sort(),context.meshNames,'Full physical-owner inventory mismatch');
 files.push({file:name,sha256:sha(bytes),logicalOwners:rows.length,renderedMeshPrimitives:rows.reduce((sum,row)=>sum+row.primitiveNames.length,0),renderedTriangles:rows.reduce((sum,row)=>sum+row.sourceTriangleCount,0),rawClosedOwners:rows.filter(row=>row.rawTopology.closed).length,allOwnersRawClosed:rows.every(row=>row.rawTopology.closed),openOrNonmanifoldOwnerNames:rows.filter(row=>!row.rawTopology.closed).map(row=>row.node),ownersWithSatDegenerateFiltering:rows.filter(row=>row.originalSatSkippedDegenerate>0).map(row=>({node:row.node,count:row.originalSatSkippedDegenerate})),rows});
}
const report={revision:27,inventoryComplete:true,sourceCandidateSha256:context.sourceCandidateSha256,actualSourceReferenceOwnerCount:context.meshNames.length,newMeshOwnersComparedToFrozenM:context.newMeshOwnersComparedToFrozenM,files,globalClosureAcceptanceClaimed:false,jointMaterialAcceptanceImplied:false,appearanceAccepted:false,integrationApproved:false,scope:'Exhaustive physical-owner inventory includes every material primitive and both Group-owned Composite wings. Open coatings, nonmanifold surfaces and original SAT filtering are visible evidence, not silently granted exemptions. Strict lower-skin/new-owner topology is separately recorded in SEMANTIC_OWNER_TOPOLOGY_CHECK.json. No global closure, wall, clearance, appearance or material acceptance is claimed.'};
fs.writeFileSync(path.join(STAGE,'ALL_OWNER_TOPOLOGY_INVENTORY.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,files:files.map(file=>({...file,rows:undefined}))},null,2));
