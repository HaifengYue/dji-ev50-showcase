/** V26 exact source/runtime identity. A pass here does not admit failed material or budget gates. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stage=path.resolve(root,process.env.TRANSWING_DETAIL_STAGE??'qa/revision-20261007-detail/baked-candidate');
assert.ok(stage.startsWith(path.join(root,'qa/revision-20261007-detail')+path.sep));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function load(name){const b=fs.readFileSync(path.join(stage,name)),json=JSON.parse(b.subarray(20,20+b.readUInt32LE(12))),g=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');g.scene.updateMatrixWorld(true);return {g,json,bytes:b.length,hash:sha(b)};}
const source=await load('xp4-source.glb'),runtime=await load('xp4.glb');
const budgetPassed=runtime.bytes<=3800000;
const validation=JSON.parse(fs.readFileSync(path.join(stage,budgetPassed?'model-validation.json':'COMPRESSION_REJECTED.json'),'utf8'));
const compression=budgetPassed?validation:validation.report;
function nodes(g){const m=new Map();g.scene.traverse(o=>{assert.equal(m.has(o.name),false,'Duplicate scene node '+o.name);m.set(o.name,o);});return m;}
const sm=nodes(source.g),rm=nodes(runtime.g);
assert.deepEqual([...sm.keys()].sort(),[...rm.keys()].sort());
assert.equal(source.json.nodes.length,352);assert.equal(runtime.json.nodes.length,352);
assert.equal(source.json.nodes.filter(n=>n.mesh!==undefined).length,285);assert.equal(runtime.json.nodes.filter(n=>n.mesh!==undefined).length,285);
const renderedMeshes=[...rm.values()].filter(o=>o.isMesh).length;assert.equal([...sm.values()].filter(o=>o.isMesh).length,renderedMeshes);
const aliases=['WingLowerClosure_L','WingLowerClosure_R'];
const parentValidation=JSON.parse(fs.readFileSync(path.join(stage,'v25-parent-validation.json'),'utf8'));
assert.equal(parentValidation.modelVersion,25);
const parentCritical=parentValidation.quantization.float32PositionExceptions;
const expected=parentCritical.filter(name=>!aliases.includes(name));
assert.equal(parentCritical.length,179);assert.equal(expected.length,177);
assert.deepEqual(compression.quantization.float32PositionExceptions.slice().sort(),expected.slice().sort(),'All V25 critical meshes except the two now-EMPTY aliases must remain exact');
const exact=new Set(expected.map(n=>THREE.PropertyBinding.sanitizeNodeName(n)));
function geometryHash(o){const p=o.geometry.attributes.position,idx=o.geometry.index;assert.ok(p.array instanceof Float32Array,o.name+' must retain Float32 positions');const vertices=Array.from({length:p.count},(_,i)=>{const b=Buffer.allocUnsafe(12);b.writeFloatLE(p.getX(i),0);b.writeFloatLE(p.getY(i),4);b.writeFloatLE(p.getZ(i),8);return b.toString('hex');}),tris=[];for(let i=0;i<(idx?.count??p.count);i+=3){const q=[0,1,2].map(j=>vertices[idx?idx.getX(i+j):i+j]);tris.push([q.join(''),[q[1],q[2],q[0]].join(''),[q[2],q[0],q[1]].join('')].sort()[0]);}return{triangles:tris.length,sha256:sha(tris.sort().join('\n'))};}
function materialSignature(material){return(Array.isArray(material)?material:[material]).map(m=>({name:m.name,color:m.color?.toArray(),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,side:m.side,transparent:m.transparent}));}
let maxMatrixError=0;const rows=[];let criticalPrimitives=0;
for(const[name,a]of sm){const b=rm.get(name);assert.equal(a.parent?.name??null,b.parent?.name??null,'Hierarchy changed '+name);assert.equal(Boolean(a.isMesh),Boolean(b.isMesh),'Node type changed '+name);}
// A glTF mesh with multiple material primitives becomes a THREE.Group. Check
// every primitive beneath its named owner; never skip Composite_wing groups.
for(const name of exact){const a=sm.get(name),b=rm.get(name);assert.ok(a&&b);const error=Math.max(...a.matrix.elements.map((v,i)=>Math.abs(v-b.matrix.elements[i])));maxMatrixError=Math.max(maxMatrixError,error);assert.ok(error<=1e-12,'Critical owner local matrix changed '+name);const ap=a.isMesh?[a]:a.children,bp=b.isMesh?[b]:b.children;assert.equal(ap.length,bp.length);assert.ok(ap.length>0&&ap.every(x=>x.isMesh)&&bp.every(x=>x.isMesh),'Missing actual material primitive '+name);const primitiveRows=[];for(let i=0;i<ap.length;i++){const ga=geometryHash(ap[i]),gb=geometryHash(bp[i]);assert.deepEqual(gb,ga,'Critical primitive geometry changed '+name+' '+i);assert.deepEqual(materialSignature(bp[i].material),materialSignature(ap[i].material),'Critical primitive material changed '+name+' '+i);const pe=Math.max(...ap[i].matrix.elements.map((v,j)=>Math.abs(v-bp[i].matrix.elements[j])));assert.ok(pe<=1e-12,'Critical primitive local matrix changed '+name+' '+i);criticalPrimitives++;primitiveRows.push({name:ap[i].name,triangles:ga.triangles,geometrySha256:ga.sha256,matrixError:pe,materials:materialSignature(ap[i].material)});}rows.push({name,matrixError:error,primitives:primitiveRows});}
assert.equal(rows.length,expected.length);
const aliasRows=[];
for(const name of aliases){const a=source.json.nodes.find(n=>n.name===name),b=runtime.json.nodes.find(n=>n.name===name);assert.ok(a&&b&&a.mesh===undefined&&b.mesh===undefined);for(const key of['matrix','translation','rotation','scale'])assert.deepEqual(b[key],a[key],name+' serialized alias TRS changed');assert.equal(rm.get(name).parent.name,'WingPivot_'+name.slice(-1));aliasRows.push({node:name,type:'EMPTY',materialOwner:'Composite_wing_'+name.slice(-1),parent:rm.get(name).parent.name,serializedTrsExactlyPreserved:true});}
const clips=[];assert.equal(source.g.animations.length,2);assert.equal(runtime.g.animations.length,2);
for(const a of source.g.animations){const b=runtime.g.animations.find(b=>b.name===a.name);assert.ok(b);assert.equal(b.tracks.length,a.tracks.length);assert.equal(a.tracks.length,a.name==='TRANSWING_Hover_Cruise_Hover'?18:26);for(const t of a.tracks){const u=b.tracks.find(u=>u.name===t.name);assert.ok(u);for(const field of['times','values']){const x=Buffer.from(t[field].buffer,t[field].byteOffset,t[field].byteLength),y=Buffer.from(u[field].buffer,u[field].byteOffset,u[field].byteLength);assert.ok(x.equals(y),'Animation array changed '+t.name+' '+field);}}clips.push({name:a.name,tracks:a.tracks.length,allDecodedTimesAndValuesByteEqual:true});}
const report={passed:true,revision:26,sourceSha256:source.hash,runtimeSha256:runtime.hash,sourceBytes:source.bytes,runtimeBytes:runtime.bytes,runtimeBudgetBytes:3800000,runtimeBudgetPassed:budgetPassed,integrationApproved:false,jointMaterialAcceptanceImplied:false,meshInstances:285,renderedMeshPrimitives:renderedMeshes,rawNodes:352,completeCriticalGeometryMeshes:rows.length,criticalPrimitiveCount:criticalPrimitives,rows,semanticAliases:aliasRows,allHierarchyNamesPreserved:true,maxCriticalLocalMatrixError:maxMatrixError,animations:clips,claimBoundary:'Exact current critical mesh-owner nodes and every material primitive, Float32 oriented positions/local matrices/materials, complete hierarchy and animation arrays, and two EMPTY alias serialized transforms. Other baseline quantization/normals and joint material gates are separate.'};
fs.writeFileSync(path.join(stage,'SOURCE_RUNTIME_IDENTITY.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
