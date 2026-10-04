/** 沿用 V23 当前快照代表修复；每个姿态同时断言所有物理顶点/索引身份和版本不变。 */
import {loadAudit as loadPriorAudit} from '../lib/snapshot-audit.mts';
import {immutableGeometryGuard} from './exact-pair-cache.mts';
export {surfaceIds,type AuditPose} from '../lib/pose-audit.mts';
export async function loadAudit(source?:string){
 const a=await loadPriorAudit(source),guard=immutableGeometryGuard();const check=()=>a.meshes.forEach(guard);check();
 return {...a,pose:(p:any)=>{check();a.pose(p);check();},update:()=>{check();a.update();check();}};
}
