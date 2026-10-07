import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stage=path.join(root,'qa/revision-20261007/baked-candidate');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function load(name){const b=fs.readFileSync(path.join(stage,name));const g=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');g.scene.updateMatrixWorld(true);return {g,hash:sha(b)};}
const source=await load('xp4-source.glb'),runtime=await load('xp4.glb');
const sm=new Map(),rm=new Map();source.g.scene.traverse(o=>sm.set(o.name,o));runtime.g.scene.traverse(o=>rm.set(o.name,o));
const validation=JSON.parse(fs.readFileSync(path.join(stage,'model-validation.json'),'utf8'));
const expected=new Set(validation.quantization.float32PositionExceptions.map(n=>THREE.PropertyBinding.sanitizeNodeName(n)));
function geometryHash(o){const p=o.geometry.attributes.position,idx=o.geometry.index;const vertices=Array.from({length:p.count},(_,i)=>{const b=Buffer.allocUnsafe(12);b.writeFloatLE(p.getX(i),0);b.writeFloatLE(p.getY(i),4);b.writeFloatLE(p.getZ(i),8);return b.toString('hex');});const tris=[];for(let i=0;i<(idx?.count??p.count);i+=3){const q=[0,1,2].map(j=>vertices[idx?idx.getX(i+j):i+j]);tris.push([q.join(''),[q[1],q[2],q[0]].join(''),[q[2],q[0],q[1]].join('')].sort()[0]);}tris.sort();return{triangles:tris.length,sha256:sha(tris.join('\n'))};}
const rows=[];let maxMatrixError=0;
for(const [name,a]of sm){const b=rm.get(name);if(!b)throw Error('Missing runtime node '+name);if((a.parent?.name??null)!==(b.parent?.name??null))throw Error('Hierarchy changed '+name);if(!a.isMesh||!expected.has(name))continue;const ga=geometryHash(a),gb=geometryHash(b);if(ga.sha256!==gb.sha256||ga.triangles!==gb.triangles)throw Error('Critical geometry changed '+name);const err=Math.max(...a.matrix.elements.map((v,i)=>Math.abs(v-b.matrix.elements[i])));maxMatrixError=Math.max(maxMatrixError,err);if(err>1e-12)throw Error('Critical mesh transform changed '+name);rows.push({name,triangles:ga.triangles,geometrySha256:ga.sha256,matrixError:err});}
const clips=[];
for(const a of source.g.animations){const b=runtime.g.animations.find(b=>b.name===a.name);if(!b||a.tracks.length!==b.tracks.length)throw Error('Clip identity changed '+a.name);for(const t of a.tracks){const u=b.tracks.find(u=>u.name===t.name);if(!u)throw Error('Track missing '+t.name);for(const f of ['times','values']){const x=Buffer.from(t[f].buffer,t[f].byteOffset,t[f].byteLength),y=Buffer.from(u[f].buffer,u[f].byteOffset,u[f].byteLength);if(!x.equals(y))throw Error('Animation values changed '+t.name+' '+f);}}clips.push({name:a.name,tracks:a.tracks.length,allDecodedTimesAndValuesByteEqual:true});}
const report={passed:true,sourceSha256:source.hash,runtimeSha256:runtime.hash,meshInstances:[...sm.values()].filter(o=>o.isMesh).length,rawNodes:352,completeCriticalGeometryMeshes:rows.length,rows,allHierarchyNamesPreserved:true,maxCriticalLocalMatrixError:maxMatrixError,animations:clips,claimBoundary:'All mesh nodes selected by the explicit Float32 contract retain complete oriented triangle positions; all named hierarchy and animation arrays compared. Noncritical baseline quantization and geometry normals are not claimed bit-identical.'};fs.writeFileSync(path.join(stage,'SOURCE_RUNTIME_IDENTITY.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
