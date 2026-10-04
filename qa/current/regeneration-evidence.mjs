/** 作者重建证据的当前文件身份门槛；不会把历史来源路径当成当前文件。 */
import assert from 'node:assert/strict';

export const REGENERATION_MODELS=[
 {encoding:'source',paths:['assets/blender/xp4-source.glb','qa/regenerated/assets/blender/xp4-source.glb']},
 {encoding:'runtime',paths:['public/models/xp4.glb','qa/regenerated/public/models/xp4.glb']},
];

export function verifyRegenerationEvidence(generator,exact,regeneratedContract,hash){
 assert.equal(generator?.passed,true,'缺少已通过的独立重建报告');
 assert.equal(generator.regeneratedSourcePath,REGENERATION_MODELS[0].paths[1],'独立重建源路径漂移');
 assert.equal(generator.sourceSha256,hash(REGENERATION_MODELS[0].paths[0]),'重建报告当前源证据过期');
 assert.equal(generator.regeneratedSha256,hash(REGENERATION_MODELS[0].paths[1]),'重建报告独立源证据过期');
 assert.equal(exact?.passed,true,'缺少未舍入重建证据');
 assert.deepEqual(exact.failures,[],'未舍入重建证据含失败或缺失失败明细');
 assert(Array.isArray(exact.rows),'缺少双编码未舍入重建记录');
 assert.deepEqual(exact.rows.map(row=>row.encoding),REGENERATION_MODELS.map(row=>row.encoding),'未舍入重建必须恰含源和运行双编码');
 for(const [index,model]of REGENERATION_MODELS.entries()){
  const row=exact.rows[index];
  assert.deepEqual(row.paths,model.paths,'未舍入重建文件路径漂移 '+model.encoding);
  assert.equal(row.sourceSha256,hash(model.paths[0]),'未舍入重建当前模型证据过期 '+model.encoding);
  assert.equal(row.regeneratedSha256,hash(model.paths[1]),'未舍入重建独立模型证据过期 '+model.encoding);
  assert.equal(row.meshes,283,'未舍入重建网格覆盖不完整 '+model.encoding);
  assert.equal(row.rawAttributeAndOrientedTriangleMultisetsExactlyEqual,true,'未证明实际属性及有向三角完全相同 '+model.encoding);
  assert.equal(row.roundingApplied,false,'未舍入重建不得应用舍入或缺失声明 '+model.encoding);
  assert.deepEqual(row.mismatches,[],'未舍入重建存在差异或缺失明细 '+model.encoding);
 }
 assert.equal(regeneratedContract?.passed,true,'缺少当前源与重建源操作元数据证明');
 assert.deepEqual(regeneratedContract.sources?.map(row=>row.path),REGENERATION_MODELS[0].paths,'操作元数据证明的当前/重建源路径漂移');
 for(const row of regeneratedContract.sources)assert.equal(row.sha256,hash(row.path),'操作元数据证明的文件证据过期 '+row.path);
 return {sourceAndRuntimeExact:true,roundingApplied:false,models:exact.rows.map(row=>({encoding:row.encoding,paths:row.paths,sourceSha256:row.sourceSha256,regeneratedSha256:row.regeneratedSha256,meshes:row.meshes}))};
}
