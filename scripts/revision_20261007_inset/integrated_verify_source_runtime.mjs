/** V27 complete source/runtime identity. Does not grant material, appearance, budget or integration acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {STAGE,sha,aliases,readJson,identityContext,verifyBakedOutput,verifyRawInventory} from './integrated_identity_context.mjs';

fs.writeFileSync(path.join(STAGE,'SOURCE_RUNTIME_IDENTITY.json'),JSON.stringify({passed:false,revision:27,status:'running-or-interrupted',integrationApproved:false})+'\n');
const context=identityContext();
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function load(name){
 const bytes=fs.readFileSync(path.join(STAGE,name));
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 const g=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 g.scene.updateMatrixWorld(true);
 return {g,json,bytes,hash:sha(bytes),raw:verifyRawInventory(context,json,name)};
}
function loadedNodes(g){const map=new Map();g.scene.traverse(object=>{assert.ok(!map.has(object.name),'Duplicate loader node '+object.name);map.set(object.name,object);});return map;}
function primitiveParts(owner){const parts=owner.isMesh?[owner]:owner.children;assert.ok(parts.length>0&&parts.every(part=>part.isMesh),'Expected all actual material primitives for '+owner.name);return parts;}
function geometryHash(object){
 const p=object.geometry.attributes.position,index=object.geometry.index;
 assert.ok(p.array instanceof Float32Array,object.name+' must retain Float32 positions');
 assert.equal(p.normalized,false,object.name+' critical positions must remain unnormalized Float32');
 const vertices=Array.from({length:p.count},(_,i)=>{const b=Buffer.allocUnsafe(12);b.writeFloatLE(p.getX(i),0);b.writeFloatLE(p.getY(i),4);b.writeFloatLE(p.getZ(i),8);return b.toString('hex');});
 const triangles=[];assert.equal((index?.count??p.count)%3,0);
 for(let i=0;i<(index?.count??p.count);i+=3){const q=[0,1,2].map(j=>vertices[index?index.getX(i+j):i+j]);triangles.push([q.join(''),[q[1],q[2],q[0]].join(''),[q[2],q[0],q[1]].join('')].sort()[0]);}
 return {triangles:triangles.length,sha256:sha(triangles.sort().join('\n'))};
}
function materialSignature(material){return(Array.isArray(material)?material:[material]).map(m=>({name:m.name,type:m.type,color:m.color?.toArray(),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,side:m.side,transparent:m.transparent,alphaTest:m.alphaTest,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity,normalScale:m.normalScale?.toArray(),flatShading:m.flatShading,vertexColors:m.vertexColors}));}
function canonicalMaterial(material){
 const result=structuredClone(material),p=result.pbrMetallicRoughness??{};
 result.pbrMetallicRoughness={baseColorFactor:[1,1,1,1],metallicFactor:1,roughnessFactor:1,...p};
 return {alphaMode:'OPAQUE',alphaCutoff:0.5,doubleSided:false,emissiveFactor:[0,0,0],...result};
}
function serializedTrs(a,b,name){for(const field of ['matrix','translation','rotation','scale']){assert.equal(field in b,field in a,name+' serialized '+field+' presence changed');assert.deepEqual(b[field],a[field],name+' serialized '+field+' changed');}}
function maxMatrixDifference(a,b){return Math.max(...a.matrix.elements.map((v,i)=>Math.abs(v-b.matrix.elements[i])));}
const source=await load('xp4-source.glb'),runtime=await load('xp4.glb');
verifyBakedOutput(context,'xp4-source.glb',source.bytes);
const validationFile=['model-validation.json','COMPRESSION_REJECTED.json'].find(name=>fs.existsSync(path.join(STAGE,name)));
assert.ok(validationFile,'Compression report is required');
const validation=readJson(validationFile),compression=validation.report??validation;
assert.equal(compression.modelVersion,27,'V27 requires a freshly generated compression report');
assert.equal(compression.inputBytes,source.bytes.length);assert.equal(compression.runtimeBytes,runtime.bytes.length);
assert.equal(compression.meshInstances,context.meshNames.length);assert.equal(compression.nodes,context.nodeNames.length);
const reportedCritical=compression.quantization.float32PositionExceptions.slice().sort();
assert.equal(new Set(reportedCritical).size,reportedCritical.length);
for(const name of context.requiredCritical)assert.ok(reportedCritical.includes(name),'Missing strict Float32 owner '+name);
for(const name of reportedCritical)assert.ok(context.meshNames.includes(name),'Invalid Float32 mesh exception '+name);
// Additional compressor-declared exceptions are also fully verified, never skipped.
const strictNames=[...new Set([...context.requiredCritical,...reportedCritical])].sort();
const sm=loadedNodes(source.g),rm=loadedNodes(runtime.g);
assert.deepEqual([...sm.keys()].sort(),[...rm.keys()].sort(),'Loader full hierarchy changed');
for(const [name,a] of sm){const b=rm.get(name);assert.equal(a.parent?.name??null,b.parent?.name??null,'Hierarchy changed '+name);assert.equal(a.type,b.type,'Node type changed '+name);assert.deepEqual(a.children.map(o=>o.name).sort(),b.children.map(o=>o.name).sort(),'Child inventory changed '+name);}
const sourceMaterials=new Map((source.json.materials??[]).map(m=>[m.name,canonicalMaterial(m)])),runtimeMaterials=new Map((runtime.json.materials??[]).map(m=>[m.name,canonicalMaterial(m)]));
assert.equal(sourceMaterials.size,(source.json.materials??[]).length,'Duplicate source material name');assert.equal(runtimeMaterials.size,(runtime.json.materials??[]).length,'Duplicate runtime material name');
assert.deepEqual([...sourceMaterials.keys()].sort(),[...runtimeMaterials.keys()].sort(),'Material inventory changed');
for(const [name,material] of sourceMaterials)assert.deepEqual(runtimeMaterials.get(name),material,'Serialized material changed '+name);
// Texture resources are unexpected in this pinned untextured source; fail closed if introduced.
assert.equal((source.json.textures??[]).length,0);assert.equal((runtime.json.textures??[]).length,0);
const allOwnerMaterials=[];
for(const name of context.meshNames){
 const a=sm.get(THREE.PropertyBinding.sanitizeNodeName(name)),b=rm.get(THREE.PropertyBinding.sanitizeNodeName(name));assert.ok(a&&b,'Missing loaded owner '+name);
 const ap=primitiveParts(a),bp=primitiveParts(b),rawA=source.json.meshes[source.raw.map.get(name).mesh].primitives,rawB=runtime.json.meshes[runtime.raw.map.get(name).mesh].primitives;
 assert.equal(ap.length,bp.length,'Primitive inventory changed '+name);assert.equal(ap.length,rawA.length);assert.equal(bp.length,rawB.length);
 for(let i=0;i<ap.length;i++){
  assert.deepEqual(materialSignature(bp[i].material),materialSignature(ap[i].material),'Primitive material changed '+name+' '+i);
  assert.equal(source.json.materials?.[rawA[i].material]?.name??null,runtime.json.materials?.[rawB[i].material]?.name??null,'Serialized primitive material binding changed '+name+' '+i);
  assert.equal(rawB[i].mode??4,rawA[i].mode??4,'Primitive mode changed '+name+' '+i);
 }
 allOwnerMaterials.push({node:name,loaderType:a.type,primitiveNames:ap.map(p=>p.name),allPrimitiveMaterialBindingsPreserved:true});
}
let maxMatrixError=0,criticalPrimitives=0;const rows=[];
for(const name of strictNames){
 const a=sm.get(THREE.PropertyBinding.sanitizeNodeName(name)),b=rm.get(THREE.PropertyBinding.sanitizeNodeName(name));assert.ok(a&&b);
 serializedTrs(source.raw.map.get(name),runtime.raw.map.get(name),name);
 const error=maxMatrixDifference(a,b);maxMatrixError=Math.max(maxMatrixError,error);assert.ok(error<=1e-12,'Critical owner local matrix changed '+name);
 const ap=primitiveParts(a),bp=primitiveParts(b),primitives=[];
 for(let i=0;i<ap.length;i++){
  const ga=geometryHash(ap[i]),gb=geometryHash(bp[i]);assert.deepEqual(gb,ga,'Critical oriented primitive geometry changed '+name+' '+i);
  const primitiveMatrixError=maxMatrixDifference(ap[i],bp[i]);assert.ok(primitiveMatrixError<=1e-12,'Critical primitive local matrix changed '+name+' '+i);
  criticalPrimitives++;primitives.push({name:ap[i].name,triangles:ga.triangles,geometrySha256:ga.sha256,matrixError:primitiveMatrixError,materials:materialSignature(ap[i].material)});
 }
 rows.push({name,matrixError:error,serializedTrsExactlyPreserved:true,primitives});
}
const aliasRows=[];
for(const name of aliases){const a=source.raw.map.get(name),b=runtime.raw.map.get(name);assert.ok(a.mesh===undefined&&b.mesh===undefined);serializedTrs(a,b,name);const owner='Composite_wing_'+name.slice(-1);assert.ok(context.meshNames.includes(owner));aliasRows.push({node:name,type:'EMPTY',materialOwner:owner,parent:runtime.raw.parents.get(name),serializedTrsExactlyPreserved:true});}
const driveRestNames=['Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2'];
for(const name of driveRestNames){const a=source.raw.map.get(name),b=runtime.raw.map.get(name);assert.ok(a&&b&&a.mesh===undefined&&b.mesh===undefined);serializedTrs(a,b,name);}
const clips=[];assert.equal(source.g.animations.length,2);assert.equal(runtime.g.animations.length,2);
assert.deepEqual(source.g.animations.map(a=>a.name).sort(),['TRANSWING_Hover_Cruise_Hover','TRANSWING_Motors_Start_Stop'].sort());
for(const a of source.g.animations){
 const b=runtime.g.animations.find(c=>c.name===a.name);assert.ok(b);assert.equal(b.duration,a.duration);assert.equal(b.blendMode,a.blendMode);
 assert.equal(a.tracks.length,a.name==='TRANSWING_Hover_Cruise_Hover'?18:26);assert.equal(b.tracks.length,a.tracks.length);
 assert.equal(new Set(a.tracks.map(t=>t.name)).size,a.tracks.length);assert.equal(new Set(b.tracks.map(t=>t.name)).size,b.tracks.length);
 assert.deepEqual(a.tracks.map(t=>t.name).sort(),b.tracks.map(t=>t.name).sort());
 for(const t of a.tracks){const u=b.tracks.find(u=>u.name===t.name);assert.equal(u.ValueTypeName,t.ValueTypeName);assert.equal(u.getInterpolation(),t.getInterpolation(),'Animation interpolation changed '+t.name);for(const field of ['times','values']){assert.equal(u[field].constructor,t[field].constructor);const x=Buffer.from(t[field].buffer,t[field].byteOffset,t[field].byteLength),y=Buffer.from(u[field].buffer,u[field].byteOffset,u[field].byteLength);assert.ok(x.equals(y),'Animation array changed '+t.name+' '+field);}}
 clips.push({name:a.name,tracks:a.tracks.length,duration:a.duration,trackNames:a.tracks.map(t=>t.name),allDecodedTimesAndValuesByteEqual:true,interpolationAndTypesIdentical:true});
}
const renderedMeshes=[...rm.values()].filter(o=>o.isMesh).length;
assert.equal([...sm.values()].filter(o=>o.isMesh).length,renderedMeshes);
const report={passed:true,revision:27,sourceCandidateSha256:context.sourceCandidateSha256,sourceSha256:source.hash,runtimeSha256:runtime.hash,sourceBytes:source.bytes.length,runtimeBytes:runtime.bytes.length,runtimeBudgetDecision:'pending-root-decision',priorV26BudgetBytesReferenceOnly:3800000,withinPriorV26ReferenceBudget:runtime.bytes.length<=3800000,budgetAcceptanceImplied:false,integrationApproved:false,appearanceAccepted:false,jointMaterialAcceptanceImplied:false,meshInstances:context.meshNames.length,renderedMeshPrimitives:renderedMeshes,rawNodes:context.nodeNames.length,countsVerifiedAgainstCurrentReferenceAndBakeReceipt:true,inheritedCriticalOwnersAndAliases:context.inheritedCritical.length,requiredCriticalGeometryOwners:context.requiredCritical.length,completeCriticalGeometryMeshes:rows.length,criticalPrimitiveCount:criticalPrimitives,newRequiredCriticalOwners:context.requiredCritical.filter(name=>!context.inheritedCritical.includes(name)),additionalCompressorDeclaredOwners:strictNames.filter(name=>!context.requiredCritical.includes(name)),rows,allOwnerMaterials,semanticAliases:aliasRows,allHierarchyNamesAndParentsPreserved:true,allMaterialDefinitionsAndBindingsPreserved:true,maxCriticalLocalMatrixError:maxMatrixError,driveRestTransformsExactlyPreserved:driveRestNames,animations:clips,claimBoundary:'Current baked source/runtime identity only: all inherited and current critical owners, every material primitive, Float32 oriented positions, exact serialized local TRS, complete hierarchy/material assignments, and animation arrays. Full current-candidate material, wall/clearance, appearance, playback and production-rig gates remain separate. Frozen parent metadata grants no new material acceptance.'};
fs.writeFileSync(path.join(STAGE,'SOURCE_RUNTIME_IDENTITY.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined,allOwnerMaterials:undefined},null,2));
