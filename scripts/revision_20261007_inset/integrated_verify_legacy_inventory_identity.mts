/** Read-only frozen V25 runtime comparison. Historical identity never grants a geometry exemption. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {ROOT,STAGE,sha,readJson,identityContext,verifyRawInventory} from './integrated_identity_context.mjs';
fs.writeFileSync(path.join(STAGE,'LEGACY_QUANTIZATION_INVENTORY_IDENTITY.json'),JSON.stringify({passed:false,revision:27,status:'running-or-interrupted',integrationApproved:false})+'\n');
const context=identityContext(),parentManifest=readJson('v25-parent-manifest.json');
assert.equal(parentManifest.version,25);
const baseline=path.resolve(ROOT,process.env.TRANSWING_V25_COMPARE_MODEL??'assets/baseline-v25-20261007/xp4-runtime.glb');
async function load(file:string){const bytes=fs.readFileSync(file),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');gltf.scene.updateMatrixWorld(true);return {bytes,json,scene:gltf.scene};}
// Validate protected bytes before parsing or using them as comparison evidence.
const baselineBytes=fs.readFileSync(baseline),expectedBaselineSha=parentManifest.assets['xp4.glb'].sha256;
assert.equal(sha(baselineBytes),expectedBaselineSha,'Read-only comparison must use exact frozen V25 runtime bytes');
const baselineLockPath=path.join(ROOT,'V27_BASELINE_VERIFICATION_INPUTS.json');
const baselineLockBytes=fs.readFileSync(baselineLockPath),baselineLock=JSON.parse(baselineLockBytes);
assert.equal(baselineLock.schema,'transwing.v27-frozen-baseline-verification-inputs.v1');
const baselineInput=baselineLock.files.find((row:any)=>row.path==='assets/baseline-v25-20261007/xp4-runtime.glb');
assert.ok(baselineInput,'Frozen V25 runtime input missing from lock');
const frozenBytes=fs.readFileSync(path.join(ROOT,baselineInput.path));
assert.equal(frozenBytes.length,baselineInput.bytes);assert.equal(sha(frozenBytes),baselineInput.sha256);
assert.equal(baselineInput.sha256,expectedBaselineSha);assert.equal(sha(baselineBytes),baselineInput.sha256);
const protectionPath=path.join(STAGE,'V25_PROTECTED_IDENTITIES.json');
const protectedIdentities=fs.existsSync(protectionPath)?JSON.parse(fs.readFileSync(protectionPath,'utf8')):{};
const optionalMainOutputObservation=protectedIdentities['public/models/xp4.glb']??null;
// Main outputs can be absent in a new construction tree or contain B in a
// delivered development package. They are optional audit observations only.
const previous=await load(baseline),current=await load(path.join(STAGE,'xp4.glb'));
verifyRawInventory(context,current.json,'xp4.glb');
const inventory=readJson('ALL_OWNER_TOPOLOGY_INVENTORY.json');assert.equal(inventory.inventoryComplete,true);
const currentInventory=inventory.files.find((file:any)=>file.file==='xp4.glb');assert.equal(currentInventory.sha256,sha(current.bytes));
const names=currentInventory.ownersWithSatDegenerateFiltering.map((row:any)=>row.node);
function parts(owner:THREE.Object3D){const out=owner instanceof THREE.Mesh?[owner]:owner.children;assert.ok(out.length>0&&out.every(part=>part instanceof THREE.Mesh),'Physical owner primitive inventory incomplete');return out as THREE.Mesh[];}
function materialSignature(material:THREE.Material|THREE.Material[]){return(Array.isArray(material)?material:[material]).map(material=>{const m=material as THREE.MeshStandardMaterial;return {name:m.name,type:m.type,color:m.color?.toArray(),metalness:m.metalness,roughness:m.roughness,side:m.side,opacity:m.opacity,transparent:m.transparent,alphaTest:m.alphaTest,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity};});}
function primitiveSignature(mesh:THREE.Mesh){
 const geometry=mesh.geometry,p=geometry.getAttribute('position'),index=geometry.index;
 const vertices=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Object.is(value,-0)?'-0':value.toString()).join(','));
 const triangles=[];assert.equal((index?.count??p.count)%3,0);
 for(let i=0;i<(index?.count??p.count);i+=3){const points=[0,1,2].map(j=>vertices[index?index.getX(i+j):i+j]);triangles.push([points.join('/'),[points[1],points[2],points[0]].join('/'),[points[2],points[0],points[1]].join('/')].sort()[0]);}
 return {allDecodedPositions:vertices.slice().sort(),orientedTriangles:triangles.sort(),matrix:mesh.matrix.elements.slice(),material:materialSignature(mesh.material)};
}
function signature(owner:THREE.Object3D){return {type:owner.type,parent:owner.parent?.name??null,matrix:owner.matrix.elements.slice(),primitives:parts(owner).map(primitiveSignature)};}
function ancestorFrames(owner:THREE.Object3D){const rows=[];for(let parent=owner.parent;parent;parent=parent.parent)rows.push({node:parent.name,matrix:parent.matrix.elements.slice()});return rows;}
const rows=names.map((name:string)=>{
 const cleanName=THREE.PropertyBinding.sanitizeNodeName(name),a=previous.scene.getObjectByName(cleanName),b=current.scene.getObjectByName(cleanName);assert.ok(a&&b,'Comparison owner absent '+name);
 const before=signature(a),after=signature(b),differences=[];
 for(const field of ['type','parent','matrix','primitives'] as const){try{assert.deepEqual(after[field],before[field]);}catch{differences.push(field);}}
 const beforeAncestors=ancestorFrames(a),afterAncestors=ancestorFrames(b),ancestorDifferences=[];
 for(const ancestor of beforeAncestors){const next=afterAncestors.find(row=>row.node===ancestor.node);if(!next||JSON.stringify(next.matrix)!==JSON.stringify(ancestor.matrix))ancestorDifferences.push({node:ancestor.node,baselineMatrix:ancestor.matrix,currentMatrix:next?.matrix??null});}
 for(const ancestor of afterAncestors)if(!beforeAncestors.some(row=>row.node===ancestor.node))ancestorDifferences.push({node:ancestor.node,baselineMatrix:null,currentMatrix:ancestor.matrix});
 return {node:name,passed:differences.length===0,completeDecodedPositionOrientedTriangleMaterialAndLocalFrameIdentity:differences.length===0,geometrySignatureSha256:sha(JSON.stringify(after)),baselineGeometrySignatureSha256:sha(JSON.stringify(before)),differences,primitiveCount:after.primitives.length,currentSatFilteredTriangles:currentInventory.ownersWithSatDegenerateFiltering.find((row:any)=>row.node===name).count,ancestorRestFramesIdentical:ancestorDifferences.length===0,ancestorRestFrameDifferences:ancestorDifferences};
});
const protectedAfter=sha(fs.readFileSync(baseline));assert.equal(protectedAfter,expectedBaselineSha,'Frozen V25 runtime unexpectedly changed during read-only verification');
const report={passed:rows.every((row:any)=>row.passed),revision:27,baselineRuntimePath:path.relative(ROOT,baseline),baselineRuntimeSha256:sha(previous.bytes),currentRuntimeSha256:sha(current.bytes),sourceCandidateSha256:context.sourceCandidateSha256,frozenBaselineHashVerifiedBeforeAndAfter:true,baselineVerificationInputLockSha256:sha(baselineLockBytes),currentMainOutputUsedAsBaseline:baseline===path.join(ROOT,'public/models/xp4.glb'),optionalMainOutputObservation,baselineIsVerificationOnly:true,baselineNotRequiredByBakeOrCompression:true,checkedOwnerCount:rows.length,rows,anyAncestorRestFramesChanged:rows.some((row:any)=>!row.ancestorRestFramesIdentical),globalGeometryAcceptanceImplied:false,jointMaterialAcceptanceImplied:false,appearanceAccepted:false,integrationApproved:false,scope:'Exact local decoded coordinates (including full position inventory), oriented triangles, material definitions, own local matrices and parent identities for every current runtime SAT-filtering inventory owner, compared with separately locked frozen V25 runtime bytes. Ancestor frame differences are recorded separately and are not silently accepted as world-space identity. This provides historical local-defect provenance only, grants no exemption and changes no area, topology or SAT threshold.'};
fs.writeFileSync(path.join(STAGE,'LEGACY_QUANTIZATION_INVENTORY_IDENTITY.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
