/** Exact compact evidence only: no archived meshes or rounded replacement geometry. */
import fs from 'node:fs';import crypto from 'node:crypto';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {geometryFingerprint} from './motion-reference.mts';
import {createWorldTriangles} from '../lib/triangle-contact.mjs';
import {decorationTopology} from './decoration-topology.mts';
export const digest=(v:any)=>crypto.createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export async function captureModelReference(file:string){
 const bytes=fs.readFileSync(file),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 g.scene.updateMatrixWorld(true);const nodes:any[]=[];
 g.scene.traverse((o:any)=>{o.updateMatrix();const n:any={name:o.name,parent:o.parent?.name??null,type:o.type,isMesh:!!o.isMesh,visible:o.visible,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),localMatrix:o.matrix.elements,userData:o.userData};
  if(o.isMesh){n.geometry=geometryFingerprint(o);n.topology=decorationTopology(createWorldTriangles(o));const m=o.material;n.material={name:m.name,color:m.color.toArray(),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,side:m.side};}nodes.push(n);});
 nodes.sort((a,b)=>a.name.localeCompare(b.name));
 const animations=g.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.map(t=>({name:t.name,valueSize:t.getValueSize(),interpolation:t.getInterpolation(),timesLength:t.times.length,timesSha256:digest(Array.from(t.times)),valuesLength:t.values.length,valuesSha256:digest(Array.from(t.values))})).sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.name.localeCompare(b.name));
 return {modelSha256:digest(bytes),nodeCount:nodes.length,meshCount:nodes.filter(n=>n.isMesh).length,nodes,animations};
}
export function compareModelReference(before:any,after:any){
 const a=new Map<string,any>(before.nodes.map((n:any)=>[n.name,n])),b=new Map<string,any>(after.nodes.map((n:any)=>[n.name,n]));
 const geometryChanges:string[]=[],normalOnlyChanges:string[]=[],transformChanges:string[]=[],parentChanges:string[]=[],materialChanges:string[]=[],visibilityChanges:string[]=[],typeChanges:string[]=[],extrasChanges:any[]=[];
 for(const[name,x]of a){const y=b.get(name);if(!y)continue;
  if(x.type!==y.type)typeChanges.push(name);if(x.visible!==y.visible)visibilityChanges.push(name);if(x.parent!==y.parent)parentChanges.push(name);
  if(['position','quaternion','scale','localMatrix'].some(k=>JSON.stringify(x[k])!==JSON.stringify(y[k])))transformChanges.push(name);
  if(JSON.stringify(x.material)!==JSON.stringify(y.material))materialChanges.push(name);
  if(x.isMesh&&y.isMesh){if(['uniquePositionsSha256','orientedPositionTrianglesSha256','triangleCount'].some(k=>x.geometry[k]!==y.geometry[k]))geometryChanges.push(name);else if(JSON.stringify(x.geometry)!==JSON.stringify(y.geometry))normalOnlyChanges.push(name);}
  const keys=[...new Set([...Object.keys(x.userData),...Object.keys(y.userData)])].sort(),properties=keys.filter(k=>Object.hasOwn(x.userData,k)!==Object.hasOwn(y.userData,k)||JSON.stringify(x.userData[k])!==JSON.stringify(y.userData[k])).map(key=>({key,beforePresent:Object.hasOwn(x.userData,key),before:x.userData[key]??null,afterPresent:Object.hasOwn(y.userData,key),after:y.userData[key]??null}));if(properties.length)extrasChanges.push({name,properties});
 }
 const animationChanges:any[]=[],animationTimelineChanges:any[]=[],animationStructureChanges:any[]=[];
 for(const old of before.animations){const next=after.animations.find((c:any)=>c.name===old.name);if(!next||old.duration!==next.duration||JSON.stringify(old.tracks.map((t:any)=>[t.name,t.valueSize,t.interpolation]))!==JSON.stringify(next.tracks.map((t:any)=>[t.name,t.valueSize,t.interpolation]))){animationStructureChanges.push(old.name);continue;}
  for(const t of old.tracks){const n=next.tracks.find((v:any)=>v.name===t.name);if(t.timesLength!==n.timesLength||t.timesSha256!==n.timesSha256)animationTimelineChanges.push({clip:old.name,track:t.name});if(t.valuesLength!==n.valuesLength||t.valuesSha256!==n.valuesSha256)animationChanges.push({clip:old.name,track:t.name});}
 }
 for(const n of after.animations)if(!before.animations.some((o:any)=>o.name===n.name))animationStructureChanges.push(n.name);
 return {geometryChanges,normalOnlyChanges,transformChanges,parentChanges,materialChanges,visibilityChanges,typeChanges,extrasChanges,addedNodes:[...b.keys()].filter(n=>!a.has(n)),removedNodes:[...a.keys()].filter(n=>!b.has(n)),animationChanges,animationTimelineChanges,animationStructureChanges};
}
