/** 同一冻结输入上的 V24 独立正式验收；不把继承或候选预检写成重跑通过。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {resolveEvidence,acceptedReference,verifiedReference} from './reference-records.mjs';
import {verifyMotionIdentity,verifyPreservationReports,verifyInheritanceReport,exactNames,poseGridHash} from './verify-inheritance.mjs';
import {fileURLToPath} from 'node:url';
import {verifyRegenerationEvidence} from './regeneration-evidence.mjs';
import {collectFrozenInputs} from './freeze-inputs.mjs';
import {verifyInputLock} from './input-lock-integrity.mjs';

/** 拒绝双空格空退出码、额外字段、缺失/重复阶段及任何非零退出状态。 */
export function parseStageStatus(text,expected){
 assert.equal(typeof text,'string');
 const lines=(text.endsWith('\n')?text.slice(0,-1):text).split('\n');
 const status=lines.map(line=>{const match=/^([a-z0-9-]+) (0|[1-9][0-9]*)$/.exec(line);assert(match,'正式阶段状态行格式错误');const exitCode=Number(match[2]);assert(Number.isSafeInteger(exitCode)&&exitCode<=255,'正式阶段退出状态无效');return {name:match[1],exitCode};});
 assert.deepEqual(status.map(row=>row.name),expected,'正式阶段缺失、重复或顺序不符');
 assert(status.every(row=>row.exitCode===0),'正式阶段存在失败');
 return status;
}

/** 姿态值以原始Float64序列核对；标签只是说明文字，不能替代参数/顺序证据。 */
export function verifyPhysicalCoverage(reports,verified){
 const coverage={},expectedTargets=verified.declaredRerunMeshes;
 const specifications=[['fast','changedMeshes','states','sampleCount'],['wing','changedMeshes','states','sampleCount'],['spin','changedMeshes','states','sampleCount'],['details','changedMeshes','states','sampleCount'],['local-motion','selectedMeshes','states','samples'],['rotor-envelope','changedTargets','appliedPoseStates','sampleCount']];
 for(const encoding of ['source','runtime']){
  const motion=verified.motion.reports.find(r=>r.encoding===encoding),poseGroups={};
  for(const [stage,targetKey,stateKey,countKey]of specifications){
   const r=reports[stage+'-'+encoding],groupId=stage==='local-motion'?'seam-motion':stage;
   const group=verified.reference.grid.groups.find(g=>g.id===groupId);
   assert(r&&r.passed&&group,'完整物理检查或姿态参照缺失 '+stage+'-'+encoding);
   assert.equal(r.source,motion.source);assert.equal(r.sha256,verified.currentHashes[encoding],'当前物理检查绑定错误 '+stage+'-'+encoding);
   exactNames(r[targetKey],expectedTargets,'物理检查遗漏或扩大了保守重跑域 '+stage+'-'+encoding);
   assert.deepEqual(r.affectedScope,motion.affectedScope,'物理检查使用不同影响闭包 '+stage+'-'+encoding);
   assert(Array.isArray(r[stateKey]),'缺少实际施加的完整姿态 '+stage+'-'+encoding);
   assert.equal(r[countKey],group.stateCount);assert.equal(r[stateKey].length,group.stateCount);
   const actualHash=poseGridHash(r[stateKey]);assert.equal(actualHash,group.stateParametersSha256,'完整有序姿态参数被减少或改动 '+stage+'-'+encoding);
   if(stage!=='rotor-envelope')assert.equal(r.contacts.length,0);
   if(stage==='local-motion'){assert.equal(r.wingOnlyDiagnostic,false);assert.equal(r.unresolved.length,0);assert.equal(r.open.length,0);}
   poseGroups[groupId]={stateCount:group.stateCount,stateParametersSha256:actualHash};
  }
  const globals=['fast','wing','spin','details'].map(n=>reports[n+'-'+encoding]);
  const local=reports['local-motion-'+encoding],rotor=reports['rotor-envelope-'+encoding];
  coverage[encoding]={wholeModelInputStates:globals.reduce((s,r)=>s+r.sampleCount,0),changedMeshDetailedSamples:local.samples,relativePairs:local.relativePairs,rotorEnvelopeSamples:rotor.sampleCount,triangleSATTests:globals.reduce((s,r)=>s+r.triangleSATTests,0)+local.triangleSATTests,declaredRerunMeshCount:expectedTargets.length,completeOrderedPoseGroups:poseGroups};
 }
 // 全机支承/实体阶段也包含影响域过滤逻辑，其报告必须给出同一个实际闭包。
 for(const stage of ['solids','support']){
  const rows=reports[stage]?.reports;assert(Array.isArray(rows)&&rows.length===2,'缺少双编码实体/支承检查 '+stage);
  exactNames(rows.map(r=>r.source),verified.motion.reports.map(r=>r.source),'实体/支承编码不完整 '+stage);
  for(const r of rows){const motion=verified.motion.reports.find(m=>m.source===r.source);assert.equal(r.passed,true);assert.equal(r.sha256,verified.currentHashes[motion.encoding]);exactNames(r.changedMeshes,expectedTargets,'实体/支承检查影响域不完整 '+stage);assert.deepEqual(r.affectedScope,motion.affectedScope,'实体/支承闭包不一致 '+stage);}
 }
 return coverage;
}

function main(){
const dir=process.env.QA_DIR??'qa/current/results',read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),runtimeSha256=hash('public/models/xp4.glb'),sourceSha256=hash('assets/blender/xp4-source.glb');
const expected=read('qa/current/stages.json'),status=parseStageStatus(fs.readFileSync(path.join(dir,'status.log'),'utf8'),expected);
const reports={};for(const stage of expected.filter(n=>!['triangle-selftest','solid-selftest','support-selftest','input-stability'].includes(n))){const r=read(path.join(dir,stage+'-report.json'));assert.equal(r.passed,true,stage);reports[stage]=r;}
function bindings(r){if(!r||typeof r!=='object')return;if(r.source&&r.sha256&&typeof r.source==='string'&&fs.existsSync(r.source))assert.equal(r.sha256,hash(r.source),'源证据过期 '+r.source);if(r.runtimeSha256)assert.equal(r.runtimeSha256,runtimeSha256,'运行证据过期');for(const [key,v] of Object.entries(r))if(!['baseline','inheritedFrom'].includes(key)&&v&&typeof v==='object')Array.isArray(v)?v.forEach(bindings):bindings(v);}
for(const [name,r] of Object.entries(reports))if(name!=='inheritance')bindings(r);
assert.equal(reports.preservation.sourceSha256,sourceSha256);assert.equal(reports['runtime-preservation'].sourceSha256,runtimeSha256);assert.equal(reports['reviewed-contract'].sourceSha256,sourceSha256);assert.equal(reports['regenerated-contract'].sources[0].sha256,sourceSha256);
const generator={};for(const n of ['source-solids','source-kinematics','source-motor-animation','source-native-drive','source-runtime-geometry','generator-reproducibility','regenerated-runtime-geometry','regeneration-exact']){
 const p=`qa/current/author/${n}.json`,r=read(p);assert(r.passed,p);if(r.sourceBlendSha256)assert.equal(r.sourceBlendSha256,hash('assets/blender/xp4.blend'));if(r.blendSha256)assert.equal(r.blendSha256,hash('assets/blender/xp4.blend'));if(r.source==='assets/blender/xp4.blend')assert.equal(r.sourceSha256,hash(r.source));if(r.currentSourceSha256)assert.equal(r.currentSourceSha256,sourceSha256);if(r.acceptedRuntimeSha256)assert.equal(r.acceptedRuntimeSha256,hash(r.acceptedRuntime??'public/models/xp4.glb'));if(r.runtimeSha256)assert.equal(r.runtimeSha256,runtimeSha256);if(r.generatorHashes)for(const d of r.generatorHashes)assert.equal(d.sha256,hash('scripts/'+d.file));generator[n]={path:p,sha256:hash(p),passed:true};
}
verifyRegenerationEvidence(read('qa/current/author/generator-reproducibility.json'),read('qa/current/author/regeneration-exact.json'),reports['regenerated-contract'],hash);
const contract=read('qa/contracts/fuselage-slot-refinement.json'),motionIdentity=verifyMotionIdentity(dir,contract);
verifyPreservationReports(dir,contract,motionIdentity);verifyInheritanceReport(reports.inheritance,motionIdentity);
assert.deepEqual(reports['motion-identity'],motionIdentity.motion,'汇总必须使用正式 motion-identity 阶段');
const coverage=verifyPhysicalCoverage(reports,motionIdentity);
const straight=reports['straight-output-geometry'];assert.equal(straight.bothSourceAndRuntimeChecked,true);assert.deepEqual(straight.reports.map(r=>[r.source,r.kind]),[['assets/blender/xp4-source.glb','source'],['public/models/xp4.glb','runtime']]);for(const r of straight.reports){assert.equal(r.sha256,r.kind==='source'?sourceSha256:runtimeSha256);assert.equal(r.passed,true);assert.deepEqual(r.rows.map(x=>x.name).sort(),['BraceBodyCarriage_L','BraceBodyCarriage_R']);assert(r.rows.every(x=>x.passed));}
const support=reports.support;assert(support.contractReviewed);assert(support.reports.every(r=>r.coverage.length===r.meshCount&&r.coverage.every(c=>c.route)&&!r.failures.length));
const lock=read(path.join(dir,'input-lock.json'));verifyInputLock(lock,fs.readFileSync(path.join(dir,'input-sha256.txt'),'utf8'),collectFrozenInputs(),hash);
const slot=reports['slot-geometry'];assert.equal(slot.diagnosticOnly,false);assert.equal(slot.candidateModelsChecked,2);assert.deepEqual(slot.reports.map(r=>({source:r.source,baseline:r.baseline})),[{source:'qa/reference/source-protected-surfaces.json',baseline:true},{source:'assets/blender/xp4-source.glb',baseline:false},{source:'public/models/xp4.glb',baseline:false}],"正式直线检查必须恰含精简参考材料面、当前源与当前运行资产");const compactReference=verifiedReference('source-protected-surfaces.json'),acceptedModel=acceptedReference().data.models.find(m=>m.encoding==='source');assert.equal(slot.reports[0].sha256,compactReference.sha256,'参考JSON文件哈希不符');assert.equal(slot.reports[0].acceptedReferenceModelSha256,acceptedModel.acceptedModelSha256,'参考原始模型身份不符');for(const r of slot.reports.filter(r=>!r.baseline)){assert.equal(r.samples,225);assert.equal(r.failures.length,0);assert.equal(r.actualVertexEdges.passed,true);assert.deepEqual(Object.keys(r.actualVertexEdges.lines).sort(),["lowerL","lowerR","upperL","upperR"]);assert.deepEqual(Object.keys(r.lines).sort(),["lowerL","lowerR","upperL","upperR"]);assert(Object.values(r.lines).every(l=>Number.isFinite(l.maximumDeviation)&&l.maximumDeviation<=r.straightnessTolerance&&l.points===225&&l.actualPoints.length===225));}
const result={modelVersion:24,passed:true,runtimeSha256,sourceSha256,sourceBlendSha256:hash('assets/blender/xp4.blend'),inputLockFiles:lock.files.length,inputStability:true,stages:status,scope:{geometryChanges:reports.preservation.declaredGeometryChanges.map(r=>r.name),normalOnlyChanges:reports.preservation.declaredNormalOnlyChanges.map(r=>r.name),protectedMainHingeNodes:reports.preservation.protectedNodes.length,addedNodes:reports.preservation.addedNodes,removedNodes:reports.preservation.removedNodes,sourceTransformChanges:reports.preservation.declaredTransformChanges,runtimeTransformChanges:reports['runtime-preservation'].declaredTransformChanges,runtimeEncodingTransformChanges:contract.runtimeEncodingTransformChanges,sourceExtrasChanges:reports.preservation.declaredExtrasChanges,runtimeExtrasChanges:reports['runtime-preservation'].declaredExtrasChanges,animationChanges:reports.preservation.declaredAnimationChanges,geometryUnchangedMeshCount:reports.preservation.unchangedGeometryAndCornerNormals.length,exactGeometryPreservationOutsideDeclaredScope:true,declaredRerunMeshes:motionIdentity.declaredRerunMeshes,observedRerunMeshes:motionIdentity.observedRerunMeshes,exactInheritedMeshCount:motionIdentity.exactInheritedMeshes.length,exactInheritedMeshes:motionIdentity.exactInheritedMeshes,localDomain:reports['local-scope'].domain},motionIdentity:{reportPath:motionIdentity.motionIdentityEvidence.path,reportSha256:motionIdentity.motionIdentityEvidence.sha256,referencePath:motionIdentity.motionIdentityEvidence.referencePath,referenceSha256:motionIdentity.motionIdentityEvidence.referenceSha256,stateCount:motionIdentity.reference.grid.stateCount,stateParametersSha256:motionIdentity.reference.grid.stateParametersSha256,sourceAndDecodedRuntimeCompared:true,integrityPassed:true,collisionAcceptanceEstablishedBySeparatePhysicalStages:true},inheritance:reports.inheritance,slot:slot.reports.map(r=>({source:r.source,sha256:r.sha256,baseline:r.baseline,acceptedReferenceModelSha256:r.acceptedReferenceModelSha256??null,samples:r.samples,longitudinalRangeBlender:r.longitudinalRangeBlender,actualVertexEdges:r.actualVertexEdges?Object.fromEntries(Object.entries(r.actualVertexEdges.lines).map(([k,v])=>[k,{points:v.actualPoints.length,maximumDeviation:v.maximumDeviation,identification:v.identification}])):null,lines:Object.fromEntries(Object.entries(r.lines).map(([k,{actualPoints,...v}])=>[k,v])),minimumSampledSkinThickness:Math.min(...r.rows.flatMap(x=>Object.values(x.thickness).flatMap(t=>[t.upper,t.lower]).filter(v=>typeof v==='number')))})),straightOutputs:straight.reports.map(r=>({source:r.source,sha256:r.sha256,rows:r.rows.map(x=>({name:x.name,passed:x.passed,counts:x.actualGeometry.counts,topology:x.actualGeometry.topology,endpointDeviations:x.actualGeometry.endpointDeviations,centerlineMaximumDeviation:x.actualGeometry.centerline.maximumDeviation,volume:x.actualGeometry.volume,volumeRatio:x.actualGeometry.volumeRatio,actualSections:x.actualGeometry.sections.length}))})),support:support.reports.map(r=>({source:r.source,meshCount:r.meshCount,visibleMeshCount:r.visibleMeshCount,interfaces:r.rows.length,newlyMeasuredInterfaces:r.newlyMeasuredInterfaces,inheritedInterfaces:r.inheritedInterfaces,allMeshPhysicalPaths:true,fullCoverageReport:path.join(dir,'support-report.json')})),exportedDriveWinding:reports['baked-winding'].reports,coverage,inspectionCycles:reports.inspection.cycles.length,actualSdkHttpSseChecks:reports['python-render'].checks,linkage:reports.linkage.reports.map(r=>({source:r.source,poses:r.sampleCount,monotonicSamples:r.strokeMonotonicSamples,maxLengthError:r.maxLengthError,maxEndpointError:r.maxEndpointError,maxBackwardStep:r.maxBackwardStep})),sourceChecks:generator,regeneration:{nodes:reports['regenerated-contract'].nodes,operationalExtras:reports['regenerated-contract'].nodesWithExtras},limitations:['有限姿态、表面、射线和材料样本不构成连续净空、制造公差、载荷、强度、疲劳、气动或适航认证','距离均为未由原厂标定的概念模型单位；短圆端不计入长边线拟合，但另作实体闭合检查','只有双端源/解码运行几何、法线、拓扑、全部有序Float64世界矩阵与活动祖先精确恒等的历史有限配对才明确继承；全部保守运动影响域另行重跑，不宣称全机TRS或动画值未改','实际 SDK/HTTP/SSE/生产 GLB 检查与浏览器/WebGL/触控/设备性能测试不同']};
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log({passed:true,stages:status.length,inputs:lock.files.length,coverage,changedMeshes:result.scope.geometryChanges.length});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
