/** 独立功能模块无损Meshopt：保持全部Float32位置/法线，不做量化或重排。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const req=createRequire(process.env.ASSET_TOOL_ROOT?path.join(process.env.ASSET_TOOL_ROOT,'package.json'):import.meta.url);
const {NodeIO}=await import(pathToFileURL(req.resolve('@gltf-transform/core')));
const {ALL_EXTENSIONS,EXTMeshoptCompression}=await import(pathToFileURL(req.resolve('@gltf-transform/extensions')));
const {MeshoptEncoder,MeshoptDecoder}=await import(pathToFileURL(req.resolve('meshoptimizer')));
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=root+'/assets/blender/nacelle-system-concept-source.glb',out=root+'/public/models/nacelle-system-concept.glb';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const a=await io.read(source),doc=await io.read(source);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
await io.write(out,doc);
const b=await io.read(out);
const compare={nodes:0,primitives:0,attributes:0,indices:0,materials:0};
assert.equal(a.getRoot().listNodes().length,b.getRoot().listNodes().length);
const targets=new Map(b.getRoot().listNodes().map(n=>[n.getName(),n]));
for(const n of a.getRoot().listNodes()){
 const m=targets.get(n.getName());assert(m);assert.deepEqual(n.getMatrix(),m.getMatrix());assert.deepEqual(n.getExtras(),m.getExtras());compare.nodes++;
 if(!n.getMesh())continue;
 const pa=n.getMesh().listPrimitives(),pb=m.getMesh().listPrimitives();assert.equal(pa.length,pb.length);
 for(let i=0;i<pa.length;i++){
  const x=pa[i],y=pb[i];assert.deepEqual(x.listSemantics(),y.listSemantics());compare.primitives++;
  for(const sem of x.listSemantics()){
   const aa=x.getAttribute(sem),ab=y.getAttribute(sem);assert.equal(aa.getType(),ab.getType());assert.equal(aa.getComponentType(),ab.getComponentType());assert.deepEqual(Array.from(aa.getArray()),Array.from(ab.getArray()));compare.attributes++;
  }
  const canonical=arr=>{const out=[];for(let k=0;k<arr.length;k+=3){const q=[arr[k],arr[k+1],arr[k+2]];out.push([q.join(','),[q[1],q[2],q[0]].join(','),[q[2],q[0],q[1]].join(',')].sort()[0]);}return out};
  assert.deepEqual(canonical(x.getIndices().getArray()),canonical(y.getIndices().getArray()));compare.indices++;
  const ma=x.getMaterial(),mb=y.getMaterial();assert.equal(ma.getName(),mb.getName());assert.deepEqual(ma.getBaseColorFactor(),mb.getBaseColorFactor());assert.equal(ma.getMetallicFactor(),mb.getMetallicFactor());assert.equal(ma.getRoughnessFactor(),mb.getRoughnessFactor());assert.equal(ma.getDoubleSided(),mb.getDoubleSided());compare.materials++;
 }
}
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report={passed:true,sourceSha256:hash(source),runtimeSha256:hash(out),sourceBytes:fs.statSync(source).size,runtimeBytes:fs.statSync(out).size,compression:'EXT_meshopt_compression',quantization:false,float32PositionsUnchanged:true,decodedAllAttributesExact:true,orientedTriangleTopologyExact:true,cyclicTriangleIndexStartsMayChange:true,transformsExtrasMaterialsExact:true,compared:compare,mainRuntimeSha256:hash(root+'/public/models/xp4.glb'),limitations:'只更改独立资源封装；没有量化、法线滤波、顶点重排、几何更改或材质更改。Meshopt可循环调整单个三角的起始索引，三角朝向和拓扑逐项完全相同。'};
fs.writeFileSync(root+'/assets/concept-compression-v10.json',JSON.stringify(report,null,2));
const mp=root+'/public/models/manifest.json',manifest=JSON.parse(fs.readFileSync(mp,'utf8'));
Object.assign(manifest.airframeDetails.conceptModule,{runtimeBytes:report.runtimeBytes,sha256:report.runtimeSha256,sourceBytes:report.sourceBytes,sourceSha256:report.sourceSha256,compression:report.compression,quantization:false});
fs.writeFileSync(mp,JSON.stringify(manifest,null,2));console.log(report);
