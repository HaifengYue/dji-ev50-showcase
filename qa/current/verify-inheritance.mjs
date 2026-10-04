/** 双编码逐态精确身份只授权有限历史配对继承；保守影响域仍全部重跑。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {acceptedReference,verifiedReference,resolveEvidence,verifyOriginalCode} from './reference-records.mjs';
import {readCurrentNodeInventory} from './node-inventory.mjs';
const {validateMotionReference,compareMotionCapture,poseGridHash}=await tsImport('./motion-reference.mts',import.meta.url);
export {poseGridHash};
export const EXPECTED_MOTION_REFERENCE_SHA256='c336364b318c85bb7fa6ddf1e45ede1ea5a78b1dc33ae74cd41c346ebabb7905';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sorted=xs=>[...xs].sort();
export function exactNames(actual,expected,label){
 assert(Array.isArray(actual)&&actual.every(n=>typeof n==='string'&&n.length),'缺失或未知网格身份 '+label);
 assert.equal(new Set(actual).size,actual.length,'重复网格身份 '+label);
 assert.deepEqual(sorted(actual),sorted(expected),label);
}
const modelPaths={source:'assets/blender/xp4-source.glb',runtime:'public/models/xp4.glb'};

/** 当前GLB完整节点图独立重建闭包，并逐项核对捕获祖先；叶标记不能假冒缺失节点。 */
export function captureScope(capture,c,inventory){
 assert(inventory&&inventory.modelSha256===capture.modelSha256,'缺少当前模型绑定的完整节点清单');
 assert.equal(inventory.nodeCount,inventory.nodes.length);assert.equal(inventory.meshCount,capture.meshes.length);
 const actualNodes=new Map(inventory.nodes.map(n=>[n.name,n]));assert.equal(actualNodes.size,inventory.nodes.length,'完整节点清单含重复身份');
 exactNames(inventory.nodes.filter(n=>n.isMesh).map(n=>n.name),capture.meshes.map(m=>m.name),'实际完整节点清单与网格捕获不符');
 const names=capture.meshes.map(m=>m.name),meshNames=new Set(names),nodeIdentities=new Map(),activeNames=new Set();
 for(const m of capture.meshes){
  const ancestors=m.hierarchy.ancestors;assert(Array.isArray(ancestors)&&ancestors.length,'缺少实际祖先链 '+m.name);
  assert.equal(ancestors[0].name,m.name);assert.equal(new Set(ancestors.map(a=>a.name)).size,ancestors.length,'祖先链含重复节点 '+m.name);
  for(const [i,a]of ancestors.entries()){assert.equal(typeof a.name,'string');assert.equal(typeof a.isActive,'boolean');assert.equal(typeof a.type,'string');if(a.isActive)activeNames.add(a.name);const identity={type:a.type,isActive:a.isActive,parent:ancestors[i+1]?.name??null};if(nodeIdentities.has(a.name))assert.deepEqual(nodeIdentities.get(a.name),identity,'祖先节点身份含歧义 '+a.name);else nodeIdentities.set(a.name,identity);}
  const active=ancestors.find(a=>a.isActive)?.name??null;
  assert.equal(m.hierarchy.nearestActiveAncestor,active);assert.equal(m.hierarchy.qaGroup,active??'固定机体');
  for(const a of ancestors)assert.equal(a.isActive,capture.activeNodeNames.includes(a.name),'活动节点身份不一致 '+a.name);
 }
 exactNames(capture.activeNodeNames,[...activeNames],'活动节点名单含缺失或未知身份');
 for(const[name,identity]of nodeIdentities){const node=actualNodes.get(name);assert(node,'捕获祖先不在当前实际完整节点清单 '+name);assert.equal(node.parent,identity.parent,'捕获祖先父级与当前实际节点不同 '+name);assert.equal(node.type,identity.type,'捕获祖先类型与当前实际节点不同 '+name);}
 const geometry=[...new Set([...(c.geometryChanges??[]),...(c.normalOnlyChanges??[]),...(c.runtimeGeometryChanges??[]),...(c.runtimeNormalOnlyChanges??[])])];
 const direct=new Set([...geometry,...(c.addedNodes??[]),...(c.motionAffectedMeshes??[])]);
 for(const n of direct)assert(meshNames.has(n),'声明影响域含缺失/非网格节点 '+n);
 const transformed=[...new Set([...(c.transformChanges??[]),...(c.runtimeTransformChanges??c.runtimeEncodingTransformChanges??[]),...(c.parentChanges??[])])].sort();
 const descendants=transformed.map(ancestor=>{
  assert(actualNodes.has(ancestor),'声明变换节点不在当前实际完整节点清单 '+ancestor);
  const meshDescendants=names.filter(name=>{const visited=new Set();for(let node=actualNodes.get(name);node;node=node.parent===null?null:actualNodes.get(node.parent)){assert(!visited.has(node.name),'当前实际节点清单存在父级循环');visited.add(node.name);if(node.name===ancestor)return true;if(node.parent!==null)assert(actualNodes.has(node.parent),'当前实际节点清单缺少父级 '+node.parent);}return false;}).sort();
  meshDescendants.forEach(n=>direct.add(n));return {ancestor,meshDescendants};
 });
 return {currentMeshes:sorted(names),geometryChangedMeshes:sorted(geometry),declaredMotionAffectedMeshes:sorted(c.motionAffectedMeshes??[]),transformedAncestorDescendants:descendants,rerunMeshes:names.filter(n=>direct.has(n)).sort(),inheritanceCandidates:names.filter(n=>!direct.has(n)).sort()};
}

/** 集合顺序不参与闭包身份，但每个父级及其完整实际后代必须一致。 */
function verifyCapturedScope(actual,expected,encoding){
 assert(actual&&typeof actual==='object','缺少实际影响闭包 '+encoding);
 for(const key of ['currentMeshes','geometryChangedMeshes','declaredMotionAffectedMeshes','rerunMeshes','inheritanceCandidates'])exactNames(actual[key],expected[key],'影响闭包不符 '+encoding+'.'+key);
 assert(Array.isArray(actual.transformedAncestorDescendants),'缺少父级后代闭包 '+encoding);
 const rows=new Map();for(const row of actual.transformedAncestorDescendants){if(rows.has(row.ancestor))exactNames(row.meshDescendants,rows.get(row.ancestor),'重复父级闭包不一致');else rows.set(row.ancestor,row.meshDescendants);}
 exactNames([...rows.keys()],expected.transformedAncestorDescendants.map(r=>r.ancestor),'缺失/未知变换父级 '+encoding);
 for(const row of expected.transformedAncestorDescendants)exactNames(rows.get(row.ancestor),row.meshDescendants,'变换父级后代覆盖不完整 '+encoding+'.'+row.ancestor);
}

/** 纯数据核验入口：不加载当前模型、不执行姿态或碰撞任务，可供反例自测调用。 */
export function validateMotionEvidence({motion,reference,referenceSha256,contract,currentHashes,nodeInventories}){
 assert.equal(referenceSha256,EXPECTED_MOTION_REFERENCE_SHA256,'运动参照不是已批准的固定字节');
 validateMotionReference(reference);
 assert.equal(motion.passed,true,'运动身份完整性失败');
 assert.equal(motion.sourceAndDecodedRuntimeCompared,true,'禁止仅单编码继承');
 assert.equal(motion.referenceSha256,referenceSha256);assert.equal(motion.stateCount,3224);
 assert.equal(motion.stateCount,reference.grid.stateCount);assert.equal(motion.stateParametersSha256,reference.grid.stateParametersSha256);
 assert.deepEqual(motion.reports.map(r=>r.encoding),['source','runtime'],'必须包含且只包含两个实际编码');
 // 本轮没有添加、删除或重新挂父级节点的授权。
 for(const field of ['addedNodes','removedNodes','parentChanges'])assert.deepEqual(contract[field],[],field+' 不能隐含扩大本轮范围');
 const comparisons=motion.reports.map((r,i)=>{
  const baseline=reference.models[i],capture=r.currentCapture;
  assert.equal(r.source,modelPaths[r.encoding]);assert.equal(r.currentModelSha256,currentHashes[r.encoding],'当前模型文件身份已变 '+r.encoding);
  assert.equal(capture.modelSha256,currentHashes[r.encoding]);assert.equal(r.baselineModelSha256,baseline.acceptedModelSha256,'不能用参照JSON哈希冒充旧GLB身份');
  exactNames(capture.meshes.map(m=>m.name),baseline.meshes.map(m=>m.name),'实际网格身份必须完整 '+r.encoding);
  const comparison=compareMotionCapture(baseline,capture,reference.grid,{allowedAddedMeshes:[]});
  for(const [key,value]of Object.entries(comparison))if(key!=='claim')assert.deepEqual(r[key],value,'运动报告未忠实记录实际指纹比较 '+r.encoding+'.'+key);
  const inventory=nodeInventories?.[r.encoding];assert(inventory&&inventory.modelSha256===currentHashes[r.encoding],'完整节点清单未绑定当前模型 '+r.encoding);
  const scope=captureScope(capture,contract,inventory);verifyCapturedScope(r.affectedScope,scope,r.encoding);
  for(const n of comparison.rerunMeshes)assert(scope.rerunMeshes.includes(n),'实际变化未纳入重跑 '+n);
  for(const n of scope.inheritanceCandidates)assert(comparison.inheritanceEligibleMeshes.includes(n),'缺少完整逐态联合恒等证据 '+n);
  return {...comparison,scope};
 });
 const names=motion.reports[0].currentCapture.meshes.map(m=>m.name);
 exactNames(motion.reports[1].currentCapture.meshes.map(m=>m.name),names,'源/运行网格名单不一致');
 const union=key=>names.filter(n=>comparisons.some(r=>r[key].includes(n)));
 const changedMotionMeshes=union('changedMotionMeshes'),rerunMeshes=union('rerunMeshes');
 const exactMotionMeshes=names.filter(n=>!changedMotionMeshes.includes(n));
 const inheritanceEligibleMeshes=names.filter(n=>comparisons.every(r=>r.inheritanceEligibleMeshes.includes(n)));
 const declaredRerunMeshes=names.filter(n=>comparisons.some(r=>r.scope.rerunMeshes.includes(n)));
 for(const [key,value]of Object.entries({changedMotionMeshes,exactMotionMeshes,inheritanceEligibleMeshes,rerunMeshes,declaredRerunMeshes}))exactNames(motion[key],value,'双编码运动汇总名单失真 '+key);
 const exactInheritedMeshes=names.filter(n=>!declaredRerunMeshes.includes(n));
 for(const n of exactInheritedMeshes)assert(inheritanceEligibleMeshes.includes(n),'未知或不确定身份不能继承 '+n);
 return {reference,motion,currentHashes,declaredRerunMeshes,exactInheritedMeshes,geometryChangedMeshes:sorted([...new Set([...(contract.geometryChanges??[]),...(contract.normalOnlyChanges??[]),...(contract.runtimeGeometryChanges??[]),...(contract.runtimeNormalOnlyChanges??[])])]),changedMotionMeshes,observedRerunMeshes:rerunMeshes,inheritanceEligibleMeshes};
}

export function verifyMotionIdentity(out,contract){
 const artifact=verifiedReference('accepted-motion-reference.json'),referencePath=artifact.path,referenceSha256=artifact.sha256,reference=artifact.data;
 const currentHashes=Object.fromEntries(Object.entries(modelPaths).map(([encoding,p])=>[encoding,sha(p)]));
 const nodeInventories=Object.fromEntries(Object.entries(modelPaths).map(([encoding,p])=>[encoding,readCurrentNodeInventory(p,currentHashes[encoding])]));
 const reportPath=path.join(out,'motion-identity-report.json'),motion=read(reportPath);
 const verified=validateMotionEvidence({motion,reference,referenceSha256,contract,currentHashes,nodeInventories});
 for(const d of reference.dependencies)verifyOriginalCode(d.path,d.sha256);
 const currentNodeInventoryEvidence=Object.fromEntries(Object.entries(nodeInventories).map(([encoding,{nodes,...evidence}])=>[encoding,evidence]));
 return {...verified,currentNodeInventoryEvidence,motionIdentityEvidence:{path:reportPath,sha256:sha(reportPath),referencePath,referenceSha256,stateCount:reference.grid.stateCount,stateParametersSha256:reference.grid.stateParametersSha256}};
}

/** 几何保护仍独立强制执行；允许的局部变换/动画变化不再被错误宣称全部恒等。 */
export function verifyPreservationReports(out,contract,verified){
 assert.equal(contract.reviewed,true,'待复审候选不能进入正式继承');
 for(const [encoding,stage]of [['source','preservation'],['runtime','runtime-preservation']]){
  const r=read(path.join(out,stage+'-report.json')),baseline=verified.reference.models.find(m=>m.encoding===encoding);
  assert(r.passed&&r.exactUnchangedMeshIdentityRequired);assert.deepEqual(r.failures,[]);
  assert.equal(r.contractSha256,sha('qa/contracts/model-refinement.json'),'保护报告未绑定当前独立复审合同');
  assert.equal(r.baselineSha256,baseline.acceptedModelSha256);assert.equal(r.sourceSha256,verified.currentHashes[encoding]);
  const geometry=encoding==='runtime'?(contract.runtimeGeometryChanges??contract.geometryChanges):contract.geometryChanges;
  const normals=encoding==='runtime'?(contract.runtimeNormalOnlyChanges??contract.normalOnlyChanges):contract.normalOnlyChanges;
  exactNames(r.declaredGeometryChanges.map(x=>x.name),geometry,'当前编码几何变化与已复审名单不符');
  exactNames(r.declaredNormalOnlyChanges.map(x=>x.name),normals,'当前编码法线变化与已复审名单不符');
  const encodingChanged=new Set([...geometry,...normals]);
  const unchanged=baseline.meshes.map(m=>m.name).filter(n=>!encodingChanged.has(n));
  exactNames(r.unchangedGeometryAndCornerNormals.map(x=>x.name),unchanged,'几何未改名单缺失或误包含变化件');
  assert.deepEqual(r.addedNodes,contract.addedNodes);assert.deepEqual(r.removedNodes,contract.removedNodes);
  const metadata=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(row=>({...row,properties:[...row.properties].sort((a,b)=>a.key.localeCompare(b.key))}));
  assert(Array.isArray(r.declaredExtrasChanges),'缺少逐属性操作元数据保护结果');exactNames(r.declaredExtrasChanges.map(x=>x.name),(contract.extrasChanges??[]).map(x=>x.name),'操作元数据节点变化超出复审名单');
  assert.deepEqual(metadata(r.declaredExtrasChanges),metadata(contract.extrasChanges??[]),'操作元数据变化不等于逐属性before/after及存在性合同');
  exactNames(r.declaredTransformChanges,encoding==='runtime'?(contract.runtimeTransformChanges??contract.runtimeEncodingTransformChanges):contract.transformChanges,'局部变换变化与已复审名单不符');
  for(const [field,allowed]of [['declaredAnimationChanges','animationChangeNodes'],['declaredAnimationTimelineChanges','animationTimelineChangeNodes']]){
   assert(Array.isArray(r[field]),'缺少动画保护结果 '+field);
   for(const row of r[field])assert(typeof row.track==='string'&&contract[allowed].includes(row.track.split('.')[0]),'存在未授权动画变化 '+row.track);
  }
  assert.equal(r.unrelatedAnimationTrackDataPreserved,true,'未经声明的动画数据变化');
  assert.equal(r.exactRawReferenceFingerprints,true);assert.equal(r.referenceArtifact.sha256,acceptedReference().sha256);
 }
}

export function verifyInheritanceReport(report,verified){
 assert.equal(report.passed,true);assert.equal(report.sourceSha256,verified.currentHashes.source);assert.equal(report.runtimeSha256,verified.currentHashes.runtime);
 assert.deepEqual(report.motionIdentityEvidence,verified.motionIdentityEvidence,'继承未绑定当前双编码运动证明/固定参照');
 assert.deepEqual(report.currentNodeInventoryEvidence,verified.currentNodeInventoryEvidence,'继承未绑定当前完整节点清单');
 for(const key of ['geometryChangedMeshes','declaredRerunMeshes','exactInheritedMeshes','changedMotionMeshes','observedRerunMeshes','inheritanceEligibleMeshes'])exactNames(report[key],verified[key],'继承名单失真 '+key);
 exactNames(report.changedMeshes,verified.declaredRerunMeshes,'兼容 changedMeshes 必须是完整保守重跑域');
 assert.equal(report.unchangedMeshCount,verified.exactInheritedMeshes.length);assert.equal(report.exactInheritedMeshCount,verified.exactInheritedMeshes.length);
 for(const flag of ['exactInheritedSourceAndDecodedRuntimeGeometry','exactInheritedOrderedFloat64WorldMatrices','exactInheritedActiveAncestryAndGroups','allUnexpectedGeometryTransformAndAnimationChangesRejected','allUnexpectedMetadataChangesRejected'])assert.equal(report[flag],true,flag);
 assert.equal(report.pairInheritanceRule,'both-endpoints-in-exactInheritedMeshes');
 for(const e of report.evidence){assert.equal(e.rerun,false,'旧证据不能改称本轮重跑');assert.equal(sha(e.path),e.sha256,'历史证据已漂移 '+e.path);}
}

function main(){
 const out=process.env.QA_DIR??'qa/current/results',contract=read('qa/contracts/model-refinement.json');
 const verified=verifyMotionIdentity(out,contract);verifyPreservationReports(out,contract,verified);
 const ref=acceptedReference(),accepted=ref.data,modelSha=Object.fromEntries(accepted.models.map(m=>[m.encoding,m.acceptedModelSha256]));
 const evidenceRecord=resolveEvidence,baseRecord=evidenceRecord('qa/v23/verification/final/summary.json'),base=baseRecord.data;
 assert.equal(baseRecord.sha256,accepted.acceptedSummarySha256);assert.equal(baseRecord.sha256,verified.reference.acceptedSummarySha256);
 assert(base.passed&&base.stages.length===31&&base.stages.every(s=>s.exitCode===0));
 assert.equal(base.runtimeSha256,modelSha.runtime);assert.equal(base.sourceSha256,modelSha.source);
 
 assert.equal(accepted.codeFingerprints.length,9,'九个受保护代码的反向字节证明缺失');const code=accepted.codeFingerprints.map(r=>verifyOriginalCode(r.originalPath,r.sha256));
 function bound(report,stage){let count=0;function visit(r){
  if(!r||typeof r!=='object')return;
  if(r.source&&r.sha256&&typeof r.source==='string'){const expected=r.source===modelPaths.runtime?modelSha.runtime:r.source===modelPaths.source?modelSha.source:null;if(expected){assert.equal(r.sha256,expected,'历史报告未绑定已验收模型 '+stage);count++;}}
  if(r.runtimeSha256){assert.equal(r.runtimeSha256,modelSha.runtime,'历史运行报告已漂移 '+stage);count++;}
  for(const[k,v]of Object.entries(r))if(!['baseline','inheritedFrom'].includes(k)&&v&&typeof v==='object')Array.isArray(v)?v.forEach(visit):visit(v);
 }visit(report);assert(count>0,'历史报告缺少原模型绑定 '+stage);}
 const stages=['fast','wing','spin','details','rotor-envelope','seam-motion','wing-anchor','fairings','seat-reattachment','linkage','drive-motion','baked-winding','exported-motor-clip'];
 const evidence=stages.map(stage=>{const e=evidenceRecord(`qa/v23/verification/final/${stage}-report.json`);assert.equal(e.data.passed,true);bound(e.data,stage);return {stage,path:e.path,originalPath:e.originalPath,sha256:e.sha256,scope:'仅两端均在 exactInheritedMeshes 且双编码几何/有序世界矩阵/祖先身份完全相同的历史有限配对；保守影响域另行重跑',rerun:false};});
 const chain=evidenceRecord('qa/v23/verification/final/inheritance-report.json');assert.equal(chain.data.passed,true);assert.deepEqual(chain.data,base.inheritance,'已验收继承链已漂移');
 assert.deepEqual(chain.data,accepted.inheritedChain);
 for(const old of chain.data.evidence){const e=evidenceRecord(old.path);assert.equal(e.sha256,old.sha256);assert.equal(e.data.passed,true);evidence.push({...old,path:e.path,originalPath:old.path,scope:'核对原始继承链字节；仅限双方均属于当前双编码精确继承名单，绝不代表本轮重新执行',rerun:false});}
 evidence.push({stage:'accepted-inheritance-chain',path:chain.path,originalPath:chain.originalPath,sha256:chain.sha256,scope:'原始明确继承链，未改称重跑',rerun:false});
 const r={passed:true,modelVersion:24,runtimeSha256:verified.currentHashes.runtime,sourceSha256:verified.currentHashes.source,
  baseline:{summaryPath:baseRecord.path,summarySha256:baseRecord.sha256,runtimeSha256:modelSha.runtime,sourceSha256:modelSha.source},
  referenceArtifact:{path:ref.path,sha256:ref.sha256},
  motionIdentityEvidence:verified.motionIdentityEvidence,currentNodeInventoryEvidence:verified.currentNodeInventoryEvidence,unchangedMeshCount:verified.exactInheritedMeshes.length,exactInheritedMeshCount:verified.exactInheritedMeshes.length,
  changedMeshes:verified.declaredRerunMeshes,declaredRerunMeshes:verified.declaredRerunMeshes,geometryChangedMeshes:verified.geometryChangedMeshes,
  exactInheritedMeshes:verified.exactInheritedMeshes,inheritanceEligibleMeshes:verified.inheritanceEligibleMeshes,changedMotionMeshes:verified.changedMotionMeshes,observedRerunMeshes:verified.observedRerunMeshes,
  exactInheritedSourceAndDecodedRuntimeGeometry:true,exactInheritedOrderedFloat64WorldMatrices:true,exactInheritedActiveAncestryAndGroups:true,allUnexpectedGeometryTransformAndAnimationChangesRejected:true,allUnexpectedMetadataChangesRejected:true,
  pairInheritanceRule:'both-endpoints-in-exactInheritedMeshes',unchangedPoseAndNarrowPhaseInputs:code,evidence,
  claim:'只有两端均具备源/解码运行几何、全部3224个有序Float64世界矩阵及活动祖先联合精确恒等的历史有限配对才继承；几何或保守运动影响域全部另行重新验收',
  limitations:['运动身份完整性 passed 不等于碰撞验收通过；本报告不宣称全机TRS或动画值全部未改','旧通过不能替代当前影响域物理重跑；有限姿态继承不是连续运动、制造或飞行安全证明']};
 verifyInheritanceReport(r,verified);
 fs.writeFileSync(process.env.QA_OUT??path.join(out,'inheritance-report.json'),JSON.stringify(r,null,2)+'\n');
 console.log({passed:true,exactInheritedMeshes:r.exactInheritedMeshCount,declaredRerunMeshes:r.changedMeshes.length,inheritedReports:evidence.length});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
