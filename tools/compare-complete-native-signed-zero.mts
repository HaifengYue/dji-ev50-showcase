const exactJSON=(value:any,_replacer?:unknown,space?:number)=>JSON.stringify(value,(_key,item)=>typeof item==='number'&&Object.is(item,-0)?{__exact_negative_zero__:true}:item,space);
/** Exact decoded whole-mesh and animation identity; no decimal rounding. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const configFile=process.argv[2],config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const hash=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const digest=(v:any)=>createHash('sha256').update(exactJSON(v)).digest('hex');
assert(!fs.existsSync(config.output));
for(const a of [config.before,config.after])assert.equal(hash(a.path),a.sha256);
async function read(a:any){
 const bytes=fs.readFileSync(a.path),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const meshes:any={},nodes:any={};
 g.scene.traverse((o:any)=>{
  if(!o.name)return;assert(!nodes[o.name]);
  nodes[o.name]={parent:o.parent?.name??null,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),visible:o.visible,matrix:o.matrix.toArray(),extras:o.userData};
  if(!o.isMesh)return;
  assert(!o.isSkinnedMesh&&!o.isInstancedMesh&&!Object.keys(o.geometry.morphAttributes).length);
  const names=Object.keys(o.geometry.attributes).sort(),attributes=Object.fromEntries(names.map(name=>{
   const at=o.geometry.getAttribute(name);return[name,{itemSize:at.itemSize,count:at.count,normalized:at.normalized,arrayType:at.array.constructor.name,values:Array.from({length:at.count},(_,i)=>Array.from({length:at.itemSize},(_,j)=>at.getComponent(i,j)))}];
  }));
  const count=o.geometry.getAttribute('position').count,index=o.geometry.index;assert(index&&index.count%3===0);
  assert(names.every(name=>attributes[name].count===count));
  const vertexRows=Array.from({length:count},(_,i)=>exactJSON(names.map(name=>attributes[name].values[i])));
  const ids=Array.from({length:index.count},(_,i)=>index.getX(i));assert(ids.every(i=>Number.isInteger(i)&&i>=0&&i<count));
  const faces=[];
  for(let i=0;i<ids.length;i+=3){const r=ids.slice(i,i+3).map(j=>vertexRows[j]),rotations=[r,[r[1],r[2],r[0]],[r[2],r[0],r[1]]].map(v=>exactJSON(v));faces.push(rotations.sort()[0]);}
  const material=(Array.isArray(o.material)?o.material:[o.material]).map((m:any)=>({name:m.name,color:m.color?.toArray(),emissive:m.emissive?.toArray(),roughness:m.roughness,metalness:m.metalness,opacity:m.opacity,transparent:m.transparent,side:m.side}));
  meshes[o.name]={attributeNames:names,vertices:count,triangles:ids.length/3,rawAttributes:digest(attributes),rawIndices:digest(ids),allAttributeRowsIncludingUnused:digest(vertexRows.slice().sort()),completeOrientedCornerAttributes:digest(faces.sort()),material};
 });
 const animations=g.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.map(t=>({name:t.name,type:t.ValueTypeName,interpolation:t.getInterpolation(),times:Array.from(t.times),values:Array.from(t.values)})).sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.name.localeCompare(b.name));
 return{meshes,nodes,animations};
}
const [before,after]=await Promise.all([read(config.before),read(config.after)]);
assert.deepEqual(Object.keys(before.meshes).sort(),Object.keys(after.meshes).sort());
assert.deepEqual(Object.keys(before.nodes).sort(),Object.keys(after.nodes).sort());
const meshRows=Object.keys(before.meshes).sort().map(name=>{
 const a=before.meshes[name],b=after.meshes[name];return{name,completeOrientedCornerAttributesIdentical:a.completeOrientedCornerAttributes===b.completeOrientedCornerAttributes,allAttributeRowsIncludingUnusedIdentical:a.allAttributeRowsIncludingUnused===b.allAttributeRowsIncludingUnused,rawAttributesIdentical:a.rawAttributes===b.rawAttributes,rawIndicesIdentical:a.rawIndices===b.rawIndices,materialsIdentical:exactJSON(a.material)===exactJSON(b.material),before:a,after:b};
});
const nodeRows=Object.keys(before.nodes).sort().map(name=>{
 const a=before.nodes[name],b=after.nodes[name];const{extras:ae,...at}=a,{extras:be,...bt}=b;return{name,parentTRSMatrixVisibilityIdentical:exactJSON(at)===exactJSON(bt),extrasIdentical:exactJSON(ae)===exactJSON(be),...exactJSON(at)!==exactJSON(bt)?{before:a,after:b}:{}};
});
const result={before:config.before,after:config.after,meshCount:meshRows.length,nodeCount:nodeRows.length,
 changedGeometry:meshRows.filter(r=>!r.completeOrientedCornerAttributesIdentical||!r.allAttributeRowsIncludingUnusedIdentical).map(r=>r.name),
 accessorOnlyChanges:meshRows.filter(r=>r.completeOrientedCornerAttributesIdentical&&r.allAttributeRowsIncludingUnusedIdentical&&(!r.rawAttributesIdentical||!r.rawIndicesIdentical)).map(r=>r.name),
 changedNodeFrames:nodeRows.filter(r=>!r.parentTRSMatrixVisibilityIdentical).map(r=>r.name),
 changedNodeExtras:nodeRows.filter(r=>!r.extrasIdentical).map(r=>r.name),
 completeAnimationsExactlyIdentical:exactJSON(before.animations)===exactJSON(after.animations),
 animationEvidence:{before:before.animations,after:after.animations},meshRows,nodeRows,
 scope:'All actual decoded attributes at every oriented indexed triangle corner, including unused full vertex attribute rows; parent/TRS/local matrix/visibility, selected material properties and every complete animation track are compared without rounding. Geometry identity is not a physical pass. Changed named items require their own bounded review.',
 dependencies:Object.fromEntries([configFile,import.meta.filename,config.before.path,config.after.path,'package-lock.json'].map(f=>[f,hash(f)]))};
for(const a of[config.before,config.after])assert.equal(hash(a.path),a.sha256);
fs.writeFileSync(config.output,exactJSON(result,null,2)+'\n',{flag:'wx'});
console.log(exactJSON({meshes:result.meshCount,nodes:result.nodeCount,changedGeometry:result.changedGeometry,accessorOnlyChanges:result.accessorOnlyChanges,changedNodeFrames:result.changedNodeFrames,animationsIdentical:result.completeAnimationsExactlyIdentical}));
