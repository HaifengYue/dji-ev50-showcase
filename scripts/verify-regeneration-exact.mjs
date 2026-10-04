/** 独立重建的真实解码值检查：不舍入位置、法线、变换或动作值。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(x);
function meshSignature(o){
 if(!o.isMesh)return null;
 const attributes=Object.entries(o.geometry.attributes).sort(([a],[b])=>a.localeCompare(b));
 const count=o.geometry.attributes.position.count;
 const values=Array.from({length:count},(_,i)=>attributes.flatMap(([name,a])=>[name,...Array.from({length:a.itemSize},(_,j)=>a.getComponent(i,j))]));
 const vertices=values.map(stable),ix=o.geometry.index?.array??Array.from({length:count},(_,i)=>i),triangles=[];
 for(let i=0;i<ix.length;i+=3){const [a,b,c]=[vertices[ix[i]],vertices[ix[i+1]],vertices[ix[i+2]]];triangles.push([a+'|'+b+'|'+c,b+'|'+c+'|'+a,c+'|'+a+'|'+b].sort()[0]);}
 const m=o.material;
 return {vertices:hash(vertices.sort().join('\n')),orientedTriangles:hash(triangles.sort().join('\n')),vertexCount:count,triangleCount:triangles.length,material:{name:m.name,color:m.color.toArray(),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,side:m.side}};
}
const animations=g=>g.animations.map(a=>({name:a.name,duration:a.duration,tracks:a.tracks.map(t=>({name:t.name,type:t.ValueTypeName,times:Array.from(t.times),values:Array.from(t.values)})).sort((a,b)=>a.name.localeCompare(b.name))}));
const rows=[],failures=[];
for(const[encoding,file]of[['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']]){
 const paths=[file,'qa/regenerated/'+file],bytes=paths.map(p=>fs.readFileSync(p));
 const models=await Promise.all(bytes.map(b=>new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')));
 const maps=models.map(g=>{const m=new Map();g.scene.traverse(o=>m.set(o.name,o));return m;});
 assert.deepEqual([...maps[0].keys()].sort(),[...maps[1].keys()].sort());const mismatches=[];let meshes=0;
 for(const[name,a]of maps[0]){const b=maps[1].get(name);a.updateMatrix();b.updateMatrix();
  if(stable(a.matrix.elements)!==stable(b.matrix.elements)||a.parent?.name!==b.parent?.name)mismatches.push({name,kind:'原始变换或父级'});
  if(a.isMesh){meshes++;const before=meshSignature(a),after=meshSignature(b);if(stable(before)!==stable(after))mismatches.push({name,kind:'原始属性、有向三角多重集或材质',before,after});}
 }
 if(stable(animations(models[0]))!==stable(animations(models[1])))mismatches.push({kind:'原始动作轨道'});
 rows.push({encoding,paths,sourceSha256:hash(bytes[0]),regeneratedSha256:hash(bytes[1]),byteIdentical:bytes[0].equals(bytes[1]),meshes,rawAttributeAndOrientedTriangleMultisetsExactlyEqual:mismatches.length===0,roundingApplied:false,mismatches});
 failures.push(...mismatches.map(m=>({encoding,...m})));
}
const result={passed:failures.length===0,rows,failures,limitations:'按命名网格比较完整真实解码属性值、有向三角多重集、PBR材质、局部矩阵、父级及动作轨道，不舍入。不替代完整碰撞检查。'};
fs.writeFileSync('qa/current/author/regeneration-exact.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,rows:rows.map(({mismatches,...r})=>({...r,mismatchCount:mismatches.length})),failures:failures.slice(0,5)}));
if(!result.passed)process.exitCode=1;
