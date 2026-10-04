/** Direct GLB decode: enumerates every actual index, without audit snapshot filters. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {prepareMesh,exactWorldVertices,REQUIRED_MESHES} from './exact-self-geometry.mjs';
export const sha256=(b:any)=>crypto.createHash('sha256').update(b).digest('hex');
export async function loadExactMeshes(source:string,names:readonly string[]=REQUIRED_MESHES){
 const bytes=fs.readFileSync(source),digest=sha256(bytes),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),g=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');g.scene.updateMatrixWorld(true);
 const meshes:any[]=[];
 for(const name of names){const found:any[]=[];g.scene.traverse(o=>{if(o.name===name)found.push(o);});assert.equal(found.length,1,'Missing or ambiguous required physical mesh: '+name);const m:any=found[0];assert(m.isMesh&&!m.isSkinnedMesh&&!m.isInstancedMesh,'Unsupported physical mesh: '+name);assert(!m.morphTargetInfluences?.some((v:number)=>v!==0),'Active morph unsupported');assert(!Object.keys(m.geometry.morphAttributes??{}).length,'Morph geometry unsupported');const position=m.geometry.getAttribute('position'),index=m.geometry.getIndex();assert(position&&position.itemSize===3&&position.count>0,'Missing position');assert(index&&index.itemSize===1&&!index.normalized,'Missing actual triangle index');assert(Number.isSafeInteger(index.count)&&index.count>0&&index.count%3===0,'Truncated actual triangle index');assert(m.geometry.drawRange.start===0&&(m.geometry.drawRange.count===Infinity||m.geometry.drawRange.count===index.count),'Partial draw range cannot reduce QA triangle coverage');
  const positions=Array.from({length:position.count},(_,i)=>[position.getX(i),position.getY(i),position.getZ(i)]),indices=Array.from({length:index.count},(_,i)=>index.getX(i));
  const raw={name,positionCount:position.count,indexCount:index.count,triangleCount:index.count/3,positions,indices,localToWorld:m.matrixWorld.toArray(),decode:{positionArrayType:position.array.constructor.name,positionNormalized:position.normalized,indexArrayType:index.array.constructor.name,positionItemSize:position.itemSize,indexItemSize:index.itemSize,drawRange:{start:m.geometry.drawRange.start,count:m.geometry.drawRange.count===Infinity?'Infinity':m.geometry.drawRange.count},decoder:'Three GLTFLoader + MeshoptDecoder; getX/getY/getZ normalized attribute decoding; no transform written into quantized storage'}};
  const exact=prepareMesh(raw);exactWorldVertices(exact);meshes.push(exact);
 }
 assert.equal(sha256(fs.readFileSync(source)),digest,'GLB changed during decode');return {source,sha256:digest,meshes};
}
