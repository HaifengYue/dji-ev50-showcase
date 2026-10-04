/** 几何改动与运动影响分开：父级变换的后代不得偷偷落入未改配对继承。 */
import assert from 'node:assert/strict';
export function affectedScope(scene:any,contract:any){
 const nodes=new Map<string,any>();scene.traverse((o:any)=>{assert(!nodes.has(o.name),'节点名必须唯一 '+o.name);nodes.set(o.name,o);});
 const currentMeshes=[...nodes.values()].filter((o:any)=>o.isMesh).map((o:any)=>o.name).sort();
 const declaredGeometry=[...new Set<string>([...(contract.geometryChanges??[]),...(contract.normalOnlyChanges??[]),...(contract.runtimeGeometryChanges??[]),...(contract.runtimeNormalOnlyChanges??[])])];
 for(const name of declaredGeometry)assert(nodes.get(name)?.isMesh,'Declared source/runtime geometry identity is not a current mesh '+name);
 const direct=new Set<string>([...declaredGeometry,...(contract.addedNodes??[]),...(contract.motionAffectedMeshes??[])]);
 const transformedAncestors=[...new Set<string>([...(contract.transformChanges??[]),...(contract.runtimeTransformChanges??contract.runtimeEncodingTransformChanges??[]),...(contract.parentChanges??[])])].sort();
 const descendantRows:any[]=[];
 for(const name of transformedAncestors){assert.equal(typeof name,'string','父级变更使用逐节点姓名，不接受模糊前缀');const o=nodes.get(name);assert(o,'声明变换节点不存在 '+name);const meshes:string[]=[];o.traverse((child:any)=>{if(child.isMesh){direct.add(child.name);meshes.push(child.name);}});descendantRows.push({ancestor:name,meshDescendants:meshes.sort()});}
 for(const name of contract.motionAffectedMeshes??[])assert(nodes.get(name)?.isMesh,'声明的运动影响项不是当前实际网格 '+name);
 const rerunMeshes=currentMeshes.filter(n=>direct.has(n));
 return {currentMeshes,geometryChangedMeshes:declaredGeometry.filter(n=>nodes.get(n)?.isMesh).sort(),declaredMotionAffectedMeshes:[...(contract.motionAffectedMeshes??[])].sort(),transformedAncestorDescendants:descendantRows,rerunMeshes,inheritanceCandidates:currentMeshes.filter(n=>!direct.has(n))};
}
export function assertMotionImpactCovered(scope:any,motionReport:any){
 assert.equal(motionReport.passed,true,'逐态运动身份报告未通过输入/采样完整性检查');
 const rerun=new Set(scope.rerunMeshes);
 assert(Array.isArray(motionReport.rerunMeshes)&&Array.isArray(motionReport.inheritanceEligibleMeshes),'缺少几何/世界变换/运动组联合恒等结果');
 for(const name of motionReport.rerunMeshes)assert(rerun.has(name),'未声明而被遗漏的实际几何/运动/祖先变化网格 '+name);
 for(const name of scope.inheritanceCandidates)assert(motionReport.inheritanceEligibleMeshes.includes(name),'该网格没有几何/逐态世界变换/运动组联合精确恒等证据 '+name);
}
