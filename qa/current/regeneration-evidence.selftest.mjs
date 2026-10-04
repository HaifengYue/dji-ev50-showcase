/** 纯数据反例，不读模型或执行重建。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {REGENERATION_MODELS,verifyRegenerationEvidence} from './regeneration-evidence.mjs';

const hashes=new Map(REGENERATION_MODELS.flatMap((row,i)=>row.paths.map((file,j)=>[file,String(i*2+j+1).repeat(64)])));
const hash=file=>{assert(hashes.has(file),'Unexpected file: '+file);return hashes.get(file);};
function fixture(){
 const generator={passed:true,regeneratedSourcePath:REGENERATION_MODELS[0].paths[1],sourceSha256:hash(REGENERATION_MODELS[0].paths[0]),regeneratedSha256:hash(REGENERATION_MODELS[0].paths[1])};
 const exact={passed:true,failures:[],rows:REGENERATION_MODELS.map(({encoding,paths})=>({encoding,paths:[...paths],sourceSha256:hash(paths[0]),regeneratedSha256:hash(paths[1]),meshes:283,rawAttributeAndOrientedTriangleMultisetsExactlyEqual:true,roundingApplied:false,mismatches:[]}))};
 const regeneratedContract={passed:true,sources:REGENERATION_MODELS[0].paths.map(path=>({path,sha256:hash(path)}))};
 return {generator,exact,regeneratedContract};
}
const verify=value=>verifyRegenerationEvidence(value.generator,value.exact,value.regeneratedContract,hash);

test('当前双编码及重建双方完整绑定，历史路径无需解析',()=>{
 const valid=fixture();valid.generator.historicalSource={path:'archive/not-current.glb',sha256:'historical'};
 assert.equal(verify(valid).sourceAndRuntimeExact,true);
});

for(const [name,mutate]of[
 ['旧重建报告当前源哈希过期',value=>value.generator.sourceSha256='0'.repeat(64)],
 ['旧重建报告独立源哈希过期',value=>value.generator.regeneratedSha256='0'.repeat(64)],
 ['旧重建报告缺少源哈希',value=>delete value.generator.sourceSha256],
 ['旧重建报告路径漂移',value=>value.generator.regeneratedSourcePath='elsewhere.glb'],
 ['未舍入证据缺失',value=>delete value.exact],
 ['双编码记录缺一项',value=>value.exact.rows.pop()],
 ['双编码记录重复',value=>value.exact.rows[1]=structuredClone(value.exact.rows[0])],
 ['未舍入模型路径漂移',value=>value.exact.rows[1].paths[1]='elsewhere.glb'],
 ['未舍入当前模型哈希过期',value=>value.exact.rows[1].sourceSha256='0'.repeat(64)],
 ['未舍入重建模型哈希过期',value=>value.exact.rows[1].regeneratedSha256='0'.repeat(64)],
 ['未舍入重建模型哈希缺失',value=>delete value.exact.rows[0].regeneratedSha256],
 ['网格覆盖减少',value=>value.exact.rows[0].meshes=282],
 ['舍入被启用',value=>value.exact.rows[0].roundingApplied=true],
 ['无舍入声明缺失',value=>delete value.exact.rows[0].roundingApplied],
 ['实际属性恒等证明缺失',value=>delete value.exact.rows[0].rawAttributeAndOrientedTriangleMultisetsExactlyEqual],
 ['差异非空',value=>value.exact.rows[1].mismatches.push({name:'changed'})],
 ['差异明细缺失',value=>delete value.exact.rows[0].mismatches],
 ['全局失败非空',value=>value.exact.failures.push({encoding:'runtime'})],
 ['元数据重建源哈希过期',value=>value.regeneratedContract.sources[1].sha256='0'.repeat(64)],
 ['元数据当前源路径漂移',value=>value.regeneratedContract.sources[0].path='elsewhere.glb'],
 ['元数据双端缺一项',value=>value.regeneratedContract.sources.pop()],
])test(name,()=>{const value=fixture();mutate(value);assert.throws(()=>verify(value));});
