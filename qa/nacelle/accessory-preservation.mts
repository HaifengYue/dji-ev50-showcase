/** Complete cruise-only original surface evidence for every non-target WingPivot descendant.
 * A cyclic, oriented triangle bijection proves the whole triangle by equal barycentric
 * coordinates and convexity of the Euclidean error ball. No face/area filter exists.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createModelRig,applyModelPose,applySurfacePose} from '../../src/rig.ts';
import {hingeInventory} from '../current/hinge-identity.mts';
import {POWERTRAIN_IDS,powertrainInventory} from './powertrain-identity.mts';
import {sha256} from '../current/reference-records.mjs';
import {createWorldTriangles} from '../lib/triangle-contact.mjs';
import {verifyCompleteSurfacePreservation} from './fixed-wing-surface-translation.mts';

export const ACCESSORY_TOLERANCE=Object.freeze({source:1e-6,runtime:6e-5});
export const ACCESSORY_SURFACE_REFERENCE_SHA='cbdc724658c3a92976bd42eab8b82eb21c86361c92488464f5914243a88b42d7';
export const ACCESSORY_PREVIOUS_REFERENCE_SHA='417f7e24af6d8d523dafd90de5c824d5feaa9165b4506b111cc0d06419045d54';
export const ACCESSORY_ACCEPTED_MODEL_SHA=Object.freeze({source:'82ca7f6f9e98cb11737da6f1cb8b1507f71baf0ffcb57734b9beb7bb23e70126',runtime:'846185616204841c9939ea29b88827c9928c32232504571a5f7ab352fb455f6d'});
export type Encoding=keyof typeof ACCESSORY_TOLERANCE;
type Point=number[];
export type RawSurface={name:string;positions:Point[];indices:number[];positionCount:number;indexCount:number;triangleCount:number};
export function accessoryInventory(nodes:any[]){
 const byName=new Map(nodes.map(n=>[n.name,n]));assert.equal(byName.size,nodes.length,'Duplicate scene-node names');
 const hinge=hingeInventory(nodes.map(n=>n.name)).rows.map(n=>n.name).sort(),powertrains=POWERTRAIN_IDS.map(id=>powertrainInventory(nodes,id));
 const explicit=['Composite_wing_L','Composite_wing_R','BraceWingSeat_L','BraceWingSeat_R'];for(const name of explicit)assert(byName.has(name),'Required separate-gate member missing: '+name);
 const excluded=new Set([...hinge,...powertrains.flatMap(p=>p.all),...explicit]);
 const descendants=nodes.filter(n=>{const seen=new Set<string>();for(let p=byName.get(n.parent);p;p=byName.get(p.parent)){assert(!seen.has(p.name),'Parent cycle');seen.add(p.name);if(/^WingPivot_[LR]$/.test(p.name))return true;}return false;});
 const accessories=descendants.filter(n=>!excluded.has(n.name)).map(n=>n.name).sort();
 return {accessories,meshNames:accessories.filter(name=>byName.get(name).isMesh),markerNames:accessories.filter(name=>!byName.get(name).isMesh),wingDescendants:descendants.map(n=>n.name).sort(),excludedWingDescendants:descendants.filter(n=>excluded.has(n.name)).map(n=>n.name).sort(),exclusions:{powertrains,hinge,explicit},scope:'Every WingPivot_L/R descendant after only the four complete powertrains, Composite_wing, BraceWingSeat and independently inventoried main-hinge hardware exclusions'};
}
export async function loadAccessoryScene(file:string){
 const bytes=fs.readFileSync(file),digest=sha256(bytes),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 // The exported rest geometry is cruise. Apply the same public pose path explicitly,
 // including zero deflection of every actual control surface before reading geometry.
 const rig=createModelRig(g.scene);applyModelPose(rig,1);applySurfacePose(rig,Object.fromEntries(['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R'].map(n=>[n,0])),0);g.scene.updateMatrixWorld(true);
 assert.equal(sha256(fs.readFileSync(file)),digest,'GLB changed during direct decode');
 return {scene:g.scene,sha256:digest};
}
export function accessorySceneNodes(scene:T.Object3D){const nodes:any[]=[];scene.traverse((o:any)=>nodes.push({name:o.name,parent:o.parent?.name??null,isMesh:!!o.isMesh,type:o.type}));return nodes;}
function materialRecord(mesh:any){assert(!Array.isArray(mesh.material),'Unexpected accessory multi-material mesh');const m=mesh.material;return {name:m.name,color:m.color.toArray(),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,side:m.side};}
export function captureAccessoryNode(o:any){
 const node:any={name:o.name,parent:o.parent?.name??null,isMesh:!!o.isMesh,type:o.type,visible:o.visible,userData:structuredClone(o.userData),worldMatrix:o.matrixWorld.toArray()};
 assert(node.worldMatrix.every(Number.isFinite),'Nonfinite actual node transform');
 if(!o.isMesh)return node;
 assert(!o.isSkinnedMesh&&!o.isInstancedMesh,'Accessory may not change physical mesh type');assert(!Object.keys(o.geometry.morphAttributes??{}).length,'Morph geometry unsupported');assert(!o.morphTargetInfluences?.some((v:number)=>v!==0),'Active morph unsupported');
 const p=o.geometry.getAttribute('position'),index=o.geometry.getIndex();assert(p&&p.itemSize===3&&p.count>0,'Missing actual positions');assert(index&&index.itemSize===1&&!index.normalized,'Complete actual indexed geometry required');assert(Number.isSafeInteger(index.count)&&index.count>0&&index.count%3===0,'Incomplete raw triangle indices');
 const range=o.geometry.drawRange;assert(range.start===0&&(range.count===Infinity||range.count===index.count),'Partial draw range may not hide actual geometry');
 const positions=Array.from({length:p.count},(_,i)=>new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(o.matrixWorld).toArray()),indices=Array.from({length:index.count},(_,i)=>index.getX(i));
 const surface={name:o.name,positions,indices,positionCount:p.count,indexCount:index.count,triangleCount:index.count/3};
 validateRawSurface(surface);
 return {...node,material:materialRecord(o),surface,decode:{positionArrayType:p.array.constructor.name,positionNormalized:p.normalized,indexArrayType:index.array.constructor.name,drawRange:{start:range.start,count:range.count===Infinity?'Infinity':range.count},triangleFilter:'none; every raw index retained',geometryTransform:'decoded getX/getY/getZ -> matrixWorld; quantized storage never mutated'}};
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function triangleNormal(ps:Point[]){const[a,b,c]=ps,u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];}
export function validateRawSurface(s:RawSurface){
 assert.equal(s.positions.length,s.positionCount,'Every raw decoded position must remain');assert.equal(s.indices.length,s.indexCount,'Every raw actual index must remain');assert.equal(s.indexCount,s.triangleCount*3,'Raw index count must be exactly three times triangle count');assert(Number.isSafeInteger(s.triangleCount)&&s.triangleCount>0,'Positive finite triangle count required');assert(s.positions.every(p=>p.length===3&&p.every(Number.isFinite)),'Nonfinite actual raw geometry');assert(s.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<s.positionCount),'Invalid raw triangle index');
 for(let i=0;i<s.triangleCount;i++){const p=s.indices.slice(3*i,3*i+3).map(j=>s.positions[j]),n=triangleNormal(p);assert(n.every(Number.isFinite)&&Math.hypot(...n)>0,'True zero-area/nonfinite raw accessory triangle: '+s.name+' #'+i);}
}
const triangles=(s:RawSurface)=>Array.from({length:s.triangleCount},(_,i)=>s.indices.slice(3*i,3*i+3).map(j=>s.positions[j]));
/** Strict actual triangle correspondence. No nearest center, point sample, deletion,
 * reversed winding, coincident-face deduplication, or relative degeneracy exemption.
 */
export function proveAccessoryTriangleBijection(before:RawSurface,after:RawSurface,epsilon:number){
 assert(epsilon===1e-6||epsilon===6e-5,'Only original source/runtime encoding bounds permitted');validateRawSurface(before);validateRawSurface(after);
 const completeTriangleAccounting={before:{rawIndexCount:before.indexCount,rawTriangleCount:before.triangleCount,checkedTriangles:before.triangleCount},after:{rawIndexCount:after.indexCount,rawTriangleCount:after.triangleCount,checkedTriangles:after.triangleCount},skippedTriangles:0,relativeDegenerateFilterDisabled:true};
 if(before.triangleCount!==after.triangleCount)return {passed:false,epsilon,completeTriangleAccounting,failures:[{reason:'Full original/current raw triangle multiplicity changed'}]};
 const a=triangles(before),b=triangles(after),bn=b.map(triangleNormal),center=(p:Point[])=>[0,1,2].map(k=>(p[0][k]+p[1][k]+p[2][k])/3),bucket=(p:Point)=>p.map(v=>Math.floor(v/epsilon)),grid=new Map<string,number[]>();
 for(let i=0;i<b.length;i++){const key=bucket(center(b[i])).join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key)!.push(i);}
 const choices:{target:number;rotation:number;maximumEndpointError:number;normalDot:number}[][]=[];
 for(let i=0;i<a.length;i++){
  const c=bucket(center(a[i])),n=triangleNormal(a[i]),options=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(const j of grid.get([c[0]+dx,c[1]+dy,c[2]+dz].join(','))??[]){
   const normalDot=n.reduce((s,v,k)=>s+v*bn[j][k],0);if(!(normalDot>0))continue;
   for(let r=0;r<3;r++){const maximumEndpointError=Math.max(...a[i].map((p,k)=>distance(p,b[j][(k+r)%3])));if(maximumEndpointError<=epsilon){options.push({target:j,rotation:r,maximumEndpointError,normalDot});break;}}
  }
  options.sort((x,y)=>x.maximumEndpointError-y.maximumEndpointError||x.target-y.target);choices.push(options);
 }
 const unmatched=choices.map((x,i)=>x.length?null:i).filter(x=>x!==null);if(unmatched.length)return {passed:false,epsilon,completeTriangleAccounting,failures:[{reason:'No complete cyclic orientation-preserving endpoint certificate',rawSourceTriangleIds:unmatched,witness:unmatched.slice(0,8).map(i=>({rawSourceTriangle:i,vertices:a[i!]}))}]};
 // True bipartite matching retains multiplicity even when epsilon neighborhoods
 // overlap. Greedy matches alone are not a completeness/uniqueness certificate.
 const targetOwner=new Int32Array(b.length).fill(-1),sourceTarget=new Int32Array(a.length).fill(-1),seen=new Int32Array(b.length).fill(-1);let generation=0;
 const assign=(source:number):boolean=>{for(const edge of choices[source]){const target=edge.target;if(seen[target]===generation)continue;seen[target]=generation;const previous=targetOwner[target];if(previous<0||assign(previous)){targetOwner[target]=source;sourceTarget[source]=target;return true;}}return false;};
 const order=choices.map((edges,i)=>({i,n:edges.length})).sort((x,y)=>x.n-y.n||x.i-y.i);for(const {i}of order){generation++;if(!assign(i))return {passed:false,epsilon,completeTriangleAccounting,failures:[{reason:'Actual raw triangles have no complete one-to-one oriented correspondence',rawSourceTriangle:i}]};}
 assert(sourceTarget.every(i=>i>=0)&&targetOwner.every(i=>i>=0));assert.equal(new Set(sourceTarget).size,b.length);
 const correspondence=Array.from(sourceTarget,(j,i)=>{const edge=choices[i].find(e=>e.target===j)!;return {rawSourceTriangle:i,rawTargetTriangle:j,cyclicCornerRotation:edge.rotation,maximumEndpointError:edge.maximumEndpointError,normalDot:edge.normalDot};});
 return {passed:true,epsilon,completeTriangleAccounting,pairedRawTriangleCount:correspondence.length,maximumEndpointError:Math.max(...correspondence.map(e=>e.maximumEndpointError)),minimumGeometricNormalDot:Math.min(...correspondence.map(e=>e.normalDot)),correspondenceSha256:sha256(JSON.stringify(correspondence)),correspondence,failures:[],proof:'For every actual indexed triangle exactly one current triangle is paired bijectively with cyclic corner order and strictly positive actual geometric-normal dot. All three endpoint errors are within epsilon. Equal barycentric coordinates and convexity bound every point of BOTH whole triangles within epsilon. Every raw index participates; no relative-area or zero-area filtering.'};
}

/** Re-triangulated coplanar original faces need complete surface coverage rather
 * than a false declaration of raw triangle identity. The fallback uses the
 * existing unchanged 1e-6 no-exemption directed proof for BOTH encodings.
 */
export function proveAccessorySurfacePreservation(before:RawSurface,after:RawSurface,encoding:Encoding){
 assert(encoding==='source'||encoding==='runtime');
 const bijection=proveAccessoryTriangleBijection(before,after,1e-6);
 if(bijection.passed)return {...bijection,method:'complete-oriented-raw-triangle-bijection',encodingTolerance:ACCESSORY_TOLERANCE[encoding],effectiveSurfaceEpsilon:1e-6};
 // A re-triangulation may change connectivity but must not lose or gain raw faces.
 if(before.triangleCount!==after.triangleCount)return {...bijection,method:'rejected-raw-triangle-count-change',encodingTolerance:ACCESSORY_TOLERANCE[encoding],effectiveSurfaceEpsilon:1e-6};
 const old={positions:before.positions,indices:Array.from({length:before.triangleCount},(_,i)=>before.indices.slice(3*i,3*i+3)),sourceTriangleCount:before.triangleCount,skippedDegenerate:0},g=new T.BufferGeometry();
 g.setAttribute('position',new T.BufferAttribute(new Float64Array(after.positions.flat()),3));g.setIndex(after.indices);const mesh=new T.Mesh(g);mesh.updateMatrixWorld(true);const snapshot=createWorldTriangles(mesh,{degenerateEpsilon:0});
 const certificate=verifyCompleteSurfacePreservation(old,snapshot,after.triangleCount,[0,0,0]);g.dispose();
 return {passed:certificate.passed,epsilon:1e-6,method:'complete-bidirectional-oriented-actual-surface-coverage',encodingTolerance:ACCESSORY_TOLERANCE[encoding],effectiveSurfaceEpsilon:1e-6,completeTriangleAccounting:bijection.completeTriangleAccounting,triangleBijectionEstablished:false,triangleBijectionDiagnostic:bijection.failures,certificate,failures:certificate.passed?[]:[{reason:'Complete original/current actual oriented surface is not preserved at 1e-6'}],proof:'Every complete actual raw triangle enters the unchanged bidirectional full-surface and same-hemisphere oriented convex-patch certificate, without any geometric domain exclusion. Re-triangulation is accepted only when BOTH entire original/current oriented surfaces remain within 1e-6, stronger than the runtime 6e-5 encoding ceiling.'};
}

export async function verifyAccessoryPreservation(file:string,encoding:Encoding,baseline:{data:any;sha256:string}){
 const data=baseline.data;assert.equal(baseline.sha256,ACCESSORY_SURFACE_REFERENCE_SHA,'Only registered accepted accessory surface evidence permitted');assert.equal(sha256(JSON.stringify(data)+'\n'),ACCESSORY_SURFACE_REFERENCE_SHA,'Finite accepted accessory evidence was modified');assert.equal(data.formatVersion,1);assert.equal(data.referenceSha256,ACCESSORY_PREVIOUS_REFERENCE_SHA);const old=data.models.find((m:any)=>m.encoding===encoding);assert(old);assert.equal(old.acceptedModelSha256,ACCESSORY_ACCEPTED_MODEL_SHA[encoding]);
 const actual=await loadAccessoryScene(file),inventory=accessoryInventory(accessorySceneNodes(actual.scene));assert.deepEqual(inventory,old.inventory,'Complete non-target accessory scope changed');const epsilon=ACCESSORY_TOLERANCE[encoding],rows=[],failures=[];
 for(const a of old.nodes){const o=actual.scene.getObjectByName(a.name);assert(o,'Required actual accessory missing');const b=captureAccessoryNode(o),structural:any={};for(const key of ['name','parent','type','isMesh','visible','userData',...(a.isMesh?['material']:[])])structural[key]=JSON.stringify(a[key])===JSON.stringify(b[key]);
  const worldLinearError=Math.max(...[0,1,2,4,5,6,8,9,10].map(i=>Math.abs(a.worldMatrix[i]-b.worldMatrix[i]))),markerWorldPositionError=a.isMesh?null:distance(a.worldMatrix.slice(12,15),b.worldMatrix.slice(12,15));
  const geometry=a.isMesh?proveAccessorySurfacePreservation(a.surface,b.surface,encoding):null,passed=Object.values(structural).every(Boolean)&&worldLinearError<=epsilon&&(markerWorldPositionError===null||markerWorldPositionError<=epsilon)&&(!geometry||geometry.passed);
  const row={name:a.name,passed,structural,worldLinearError,markerWorldPositionError,geometry};rows.push(row);if(!passed)failures.push({name:a.name,structural,worldLinearError,markerWorldPositionError,geometryFailures:geometry?.failures??[]});
 }
 assert.equal(rows.length,inventory.accessories.length,'Reference node list may not omit or duplicate an accessory');assert.deepEqual(old.nodes.map((n:any)=>n.name).sort(),inventory.accessories);assert.equal(sha256(fs.readFileSync(file)),actual.sha256,'GLB changed during complete accessory verification');
 return {passed:failures.length===0,encoding,file,sha256:actual.sha256,referenceSha256:baseline.sha256,acceptedModelSha256:old.acceptedModelSha256,epsilon,effectiveSurfaceEpsilon:1e-6,inventory,nodeCount:rows.length,meshCount:inventory.meshNames.length,rawTriangleCount:rows.reduce((s,r)=>s+(r.geometry?.completeTriangleAccounting.before.rawTriangleCount??0),0),rows,failures,limitations:['This certifies complete original accessory material in cruise with zero control deflections. It does not assert identical world location throughout motion after the approved main-axis rebase.','Full motion/reference, collision, source-runtime equivalence, main hinge, powertrain, wing-shape and support gates remain independently mandatory. No existing physical gate or tolerance is replaced.']};
}
