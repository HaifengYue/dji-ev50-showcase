/** 原创模型后处理。V27独立stage；复用V25精度与动画守卫，禁止写主public/assets */
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';import path from 'node:path';
// Production dependencies resolve only from the installed scripts/package-lock.json.
const req=createRequire(import.meta.url);
const {NodeIO}=await import(pathToFileURL(req.resolve('@gltf-transform/core')));
const {ALL_EXTENSIONS,EXTMeshoptCompression}=await import(pathToFileURL(req.resolve('@gltf-transform/extensions')));
const {dedup,prune,reorder,quantize,weld,getBounds}=await import(pathToFileURL(req.resolve('@gltf-transform/functions')));
const {MeshoptEncoder,MeshoptDecoder}=await import(pathToFileURL(req.resolve('meshoptimizer')));
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stage=path.resolve(root,process.env.TRANSWING_INTEGRATED_STAGE??'qa/revision-20261007-inset/baked-integrated-a');
if(!stage.startsWith(path.join(root,'qa/revision-20261007-inset')+path.sep))throw Error('V27 stage must remain in its independent QA directory');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const input=path.join(stage,'xp4-source.glb'),out=path.join(stage,'xp4.glb');
if(fs.existsSync(out))throw new Error('Refuse to overwrite an existing independent V27 runtime');
const doc=await io.read(input);for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives())p.setAttribute('TEXCOORD_0',null);
await doc.transform(dedup(),weld(),reorder({encoder:MeshoptEncoder,target:'size'}));
// 保留未改外侧蓝边的 V12 解码坐标，新渐变则使用 Float32 防止薄面压塌。
const paintEncoding=JSON.parse(fs.readFileSync(path.join(root,'scripts/data/fixed-root-paint-encoding.json'),'utf8'));
if(paintEncoding.runtimeBaselineSha256!=='3947012c3504967fbd4e18983b2ca89c26311eb313d644af31836f021cd5680a')throw new Error('蓝边编码基线不匹配');
let paintRestoredVertices=0;
const seamPaintRetainedFloat32=[];
const layeredPaintFloat32=[];
for(const n of doc.getRoot().listNodes().filter(n=>/^Fixed_root_blue_[LR]$/.test(n.getName())))for(const primitive of n.getMesh().listPrimitives()){
 if(n.getExtras().layeredWingJoint===true){
  // 新层叠翼根的蓝边整片按当前源坐标编码，禁止套用旧翼根身份映射。
  layeredPaintFloat32.push({node:n.getName(),vertices:primitive.getAttribute('POSITION').getCount(),reason:'当前分层翼根完整源Float32表面'});continue;
 }
 const positions=primitive.getAttribute('POSITION');
 for(let i=0;i<positions.getCount();i++){
  const p=positions.getElement(i,[]);if(Math.abs(p[0])<=paintEncoding.minimumAbsX)continue;
  const key=p.map(x=>x.toFixed(8)).join(',');const target=paintEncoding.nodes[n.getName()][key];
  if(!target){
   if(Math.abs(p[0])<.62)continue;
   // V23真实切口改变局部蓝皮；仅该曲面距离0.15内的新顶点保留源Float32。
   // 其余外侧仍要求旧编码映射精确命中，不能用整体放行掩盖未知漂移。
   const sign=n.getName().endsWith('_L')?-1:1,q=p.map((x,i)=>x-[sign*1.35,-.22,1.30][i]);
   const t=(-sign*q[0]+q[1]+q[2])/Math.sqrt(3),r=Math.sqrt(q.reduce((s,x)=>s+x*x,0)-t*t),u=Math.min(1,r/.16);
   const profile=.21*(1-Math.exp(-((r/.42)**2)))-.03*(1-u*u*(3-2*u)),distance=t-profile;
   if(distance>=-.0005&&distance<=.15){seamPaintRetainedFloat32.push({node:n.getName(),position:p.slice(),profileDistance:distance});continue;}
   throw new Error('未改外侧蓝边源坐标与 V12 编码映射不一致: '+n.getName()+' '+key);
  }
  positions.setElement(i,target);paintRestoredVertices++;
 }
}
// V13：16位位置量化会压塌极薄但封闭的布尔面，形成实际拓扑孔。
// 以下实体保留源Float32位置及原局部变换，索引与法线继续Meshopt压缩。
// V14缩短端帽的极薄倒角同样保留Float32；否则16位位置会压塌36个面/端帽。
// 不隐藏或删除网格，也不通过提高碰撞检测容差掩盖开孔。
// 标注紧凑轴系：20个轴/承/套件及4个真实桥座也保源Float32与局部矩阵；
// 保留微米级实际配合余量，仍须两编码真实间隙/薄壁重验，V27预算待root按实际体积审定；旧V26/V25预算不自动转移。
const regexExactNodes=doc.getRoot().listNodes().filter(n=>n.getMesh()&&/^(WingLowerClosure.*|Nacelle_[LR]_Front|Pod_wing_saddle_[LR]_Front|BraceWingSeat_[LR]|BraceRod_mesh_[LR]|BraceRod(Eye|EyeNeck|Ferrule)_[LR]_Root|Drive_.+|CargoHinge.+|ControlHinge.+|RootBearingHousing_.+|RootHingeShaft_[LR]|RootBearing(Fixed|Seal)_[LR]_(Front|Rear)|RootCarrier(Moving|Thrust|Bridge)_[LR]|RootFixedBearingPedestal_[LR]|RootFairing.+|ActuatorSideSlot_.+|Fuselage|CargoHoodShell|CargoOpeningLip|Composite_wing_[LR]|V_tail_[LR]|ControlSurface_.+|ControlFlexure.+|ControlHorn_.+|Motor_cowl_.+|Landing_wear_tip_.+|Fixed_root_[LR]|Fixed_root_blue_[LR]|Wing_blue_leading_[LR]|Blade_[LR]_(Front|Rear)_[AB]|RootHingeEndcap_.+)$/.test(n.getName()));
const parentValidation=JSON.parse(fs.readFileSync(path.join(stage,'v25-parent-validation.json'),'utf8'));
const bake=JSON.parse(fs.readFileSync(path.join(stage,'BAKE_RECEIPT.json'),'utf8'));
const allNodes=new Map(doc.getRoot().listNodes().map(n=>[n.getName(),n]));
const criticalNames=new Set(regexExactNodes.map(n=>n.getName()));
for(const name of parentValidation.quantization.float32PositionExceptions){
 const node=allNodes.get(name);if(!node)throw Error('Original Float32 exception node removed: '+name);
 if(node.getMesh())criticalNames.add(name);
 else if(!['WingLowerClosure_L','WingLowerClosure_R'].includes(name))throw Error('Unexpected loss of original critical mesh owner: '+name);
}
for(const name of bake.newMeshOwnersComparedToFrozenM??[]){if(!allNodes.get(name)?.getMesh())throw Error('New mesh owner missing: '+name);criticalNames.add(name);}
const exactNodes=doc.getRoot().listNodes().filter(n=>criticalNames.has(n.getName()));
const exactMeshes=new Set(exactNodes.map(n=>n.getMesh()));
const exactTransforms=exactNodes.map(n=>[n,n.getMatrix().slice()]);
const exactPositions=[...exactMeshes].flatMap(m=>m.listPrimitives().map(p=>[p,p.getAttribute('POSITION').clone()]));
await doc.transform(quantize({quantizePosition:16,quantizeNormal:12,cleanup:false}));
for(const [p,a]of exactPositions)p.setAttribute('POSITION',a);
for(const [n,m]of exactTransforms)n.setMatrix(m);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
await doc.transform(prune({propertyTypes:["Accessor"],keepAttributes:true,keepIndices:true,keepLeaves:true}),dedup());await io.write(out,doc);
// V21：glTF Transform写出器会将极小静止旋转视作identity而省略。
// 对多圈丝杠/行星动画，静止姿态也是导程相位基准，不能丢掉这几微弧度。
// 只恢复五个无网格转轴的源TRS字段；已编码的Meshopt二进制和动画采样
// 完整保持，不重新量化、不改动作、不调整碰撞或qerror门槛。
function restoreDriveRestTransforms(sourcePath, runtimePath, meshNames = null, expectMesh = meshNames !== null) {
 const read = (p) => { const bytes=fs.readFileSync(p); const size=bytes.readUInt32LE(12); return {bytes,json:JSON.parse(bytes.subarray(20,20+size).toString('utf8')),tail:bytes.subarray(20+size)}; };
 const source=read(sourcePath),runtime=read(runtimePath);
 const names=meshNames??['Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2'];
 const rows=[];
 for(const name of names){
  const a=source.json.nodes.find(n=>n.name===name),b=runtime.json.nodes.find(n=>n.name===name);
  if(!a||!b||(!expectMesh&&(a.mesh!==undefined||b.mesh!==undefined))||(expectMesh&&(a.mesh===undefined||b.mesh===undefined)))throw new Error('V21静止转轴身份不符：'+name);
  const before=Object.fromEntries(['matrix','translation','rotation','scale'].filter(k=>k in b).map(k=>[k,b[k]]));
  for(const field of ['matrix','translation','rotation','scale']){if(field in a)b[field]=structuredClone(a[field]);else delete b[field];}
  rows.push({node:name,before,sourceRest:Object.fromEntries(['matrix','translation','rotation','scale'].filter(k=>k in a).map(k=>[k,a[k]])),exactSerializedFields:true});
 }
 const json=Buffer.from(JSON.stringify(runtime.json)),padding=Buffer.alloc((-json.length)&3,0x20),chunk=Buffer.alloc(8),header=Buffer.from(runtime.bytes.subarray(0,12));
 chunk.writeUInt32LE(json.length+padding.length,0);chunk.writeUInt32LE(0x4e4f534a,4);header.writeUInt32LE(20+json.length+padding.length+runtime.tail.length,8);
 fs.writeFileSync(runtimePath,Buffer.concat([header,chunk,json,padding,runtime.tail]));
 const after=read(runtimePath);
 if(!runtime.tail.equals(after.tail))throw new Error('V21静止姿态恢复不得修改Meshopt二进制或动画缓冲');
 for(const row of rows){const node=after.json.nodes.find(n=>n.name===row.node);for(const [key,value]of Object.entries(row.sourceRest))if(JSON.stringify(node[key])!==JSON.stringify(value))throw new Error('V21静止姿态字段未精确保留：'+row.node);}
 return {nodes:rows,meshoptAndAnimationBufferByteIdentical:true,reason:'保持源静止转轴的微小旋转，不允许JSON默认值省略破坏滑架—转轴的相位基准'};
}
const driveRestTransformPreservation=restoreDriveRestTransforms(input,out);
// Exact Float32 geometry also requires its original serialized local TRS, not a decomposed approximation.
const criticalTransformPreservation=restoreDriveRestTransforms(input,out,exactNodes.map(n=>n.getName()));
const semanticAliasTransformPreservation=restoreDriveRestTransforms(input,out,['WingLowerClosure_L','WingLowerClosure_R'],false);
const check=await io.read(out);
const clips=check.getRoot().listAnimations();
if(clips.length!==2 || clips[0].getName()!=='TRANSWING_Hover_Cruise_Hover' || clips[0].listChannels().length!==18)throw new Error('Transition clip was lost or split during compression');
const motorClip=clips.find(a=>a.getName()==='TRANSWING_Motors_Start_Stop');
if(!motorClip||motorClip.listChannels().length!==26)throw new Error('V14四电机完整启停动作丢失');
const clipTimes=clips[0].listSamplers().flatMap(s=>Array.from(s.getInput().getArray()));
const clipStart=clipTimes.reduce((a,b)=>Math.min(a,b),Infinity),clipEnd=clipTimes.reduce((a,b)=>Math.max(a,b),-Infinity);
if(Math.abs(clipStart)>1e-6 || Math.abs(clipEnd-199/24)>1e-5)throw new Error('Transition clip timeline must start at zero and end at 199/24 seconds');
const required=['WingPivot_L','WingPivot_R','Prop_L_Front','Prop_L_Rear','Prop_R_Front','Prop_R_Rear'];
const names=new Set(check.getRoot().listNodes().map(n=>n.getName()));for(const n of required)if(!names.has(n))throw new Error('Missing rig node '+n);
const triangles=check.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);
const renderedTriangles=check.getRoot().listNodes().reduce((sum,n)=>sum+(n.getMesh()?.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)??0),0);
const report={modelVersion:27,driveRestTransformPreservation,criticalTransformPreservation,semanticAliasTransformPreservation,paintEncodingPreservation:{layeredSourceFloat32Nodes:layeredPaintFloat32,layeredSourceFloat32Vertices:layeredPaintFloat32.reduce((sum,row)=>sum+row.vertices,0),legacyMappingAppliedToChangedWing:false,restoredVertices:paintRestoredVertices,seamFloat32Vertices:seamPaintRetainedFloat32.length,seamFloat32ProfileDistanceMaximum:Math.max(0,...seamPaintRetainedFloat32.map(x=>x.profileDistance)),seamFloat32DistanceBound:.15,baselineSha256:paintEncoding.runtimeBaselineSha256,map:"scripts/data/fixed-root-paint-encoding.json"},animations:clips.map(a=>({name:a.getName(),channels:a.listChannels().length,startSeconds:0,durationSeconds:a.listSamplers().reduce((maximum,s)=>s.getInput().getArray().reduce((m,t)=>Math.max(m,t),maximum),-Infinity)})),bounds:getBounds(check.getRoot().listScenes()[0]),meshInstances:check.getRoot().listNodes().filter(n=>n.getMesh()).length,renderedTriangles,inputBytes:fs.statSync(input).size,runtimeBytes:fs.statSync(out).size,compression:'EXT_meshopt_compression',quantization:{positions:16,normals:12,level:'medium',float32PositionExceptions:exactNodes.map(n=>n.getName())},triangles,meshes:check.getRoot().listMeshes().length,nodes:check.getRoot().listNodes().length,materials:check.getRoot().listMaterials().length,rigNodesVerified:required,textures:check.getRoot().listTextures().length};
// V27 has no inherited runtime-size approval. Measure first; never reduce
// protected Float32 positions or remove materials/meshes to meet a stale budget.
const sizeReview={version:27,actualRuntimeBytes:report.runtimeBytes,approvedBudgetBytes:null,
 status:'PENDING_ROOT_BUDGET_DECISION',priorV26ApprovedBudgetBytes:3800000,
 differenceFromPriorBudgetBytes:report.runtimeBytes-3800000,
 geometryPrecisionReducedForSize:false,meshesRemovedForSize:false};
report.runtimeBudgetReview=sizeReview;
report.criticalSelection={baseline:'frozen V25 validation plus current critical regex plus new mesh owners vs frozen M',
 sourceMeshOwnerCount:bake.expectedMeshes,sourceNodeCount:bake.expectedNodes,
 newMeshOwnersComparedToFrozenM:bake.newMeshOwnersComparedToFrozenM??[],criticalMeshOwners:exactNodes.length};
const manifestPath=path.join(stage,'model-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
manifest.version=27;
manifest.annotationRevision={...manifest.annotationRevision,
 id:'2026-10-07-v27-'+path.basename(bake.sourceCandidate,'.blend').replace(/^candidate-/, ''),reviewStatus:'CANDIDATE_PIPELINE_TRIAL_APPEARANCE_REPAIR_PENDING',
 sourceCandidate:bake.sourceCandidate,sourceCandidateSha256:bake.sourceCandidateSha256,
 publicationPerformed:false,finalDeliveryAccepted:false,pipelineTrialOnly:true};
manifest.assetEncoding={driveRestTransformPreservation,criticalTransformPreservation,semanticAliasTransformPreservation,
 paintEncodingPreservation:report.paintEncodingPreservation,runtimeBytes:report.runtimeBytes,
 runtimeBudgetReview:sizeReview,compression:report.compression,quantization:report.quantization,
 reason:'V27新机构与几何候选独立编码；全部原Float32例外、当前关键owner及新增owner严格保持源位置与序列化TRS。预算先报告实际，等待root决定；不削减精度/材料/网格。'};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(stage,'model-validation.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(stage,'RUNTIME_SIZE_REVIEW.json'),JSON.stringify(sizeReview,null,2));
console.log(JSON.stringify({modelVersion:report.modelVersion,runtimeBytes:report.runtimeBytes,
 meshInstances:report.meshInstances,nodes:report.nodes,criticalMeshes:exactNodes.length,
 renderedTriangles:report.renderedTriangles,animations:report.animations,sizeReview},null,2));
