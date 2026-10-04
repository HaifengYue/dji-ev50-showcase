/** 世界坐标退化过滤后重建当前实际三角网格的代表索引；原退化/焊接/材料阈值不变。 */
import assert from 'node:assert/strict';
import {loadAudit as originalLoadAudit} from './pose-audit.mts';
import {solidTopology} from './solid-contact.mjs';
export async function loadAudit(source?:string){
 const a=await originalLoadAudit(source),originalSnap=a.snap,originalPose=a.pose;
 const initial=new Map(),snapshotTopologies=new WeakMap(),topologyRefreshes:any[]=[];
 let currentPose:any={label:'initial',wing:0};
 for(const m of a.meshes){const s=originalSnap(m),topology=a.topology.get(m.name);initial.set(m.name,{ids:s.triangles.map((t:any)=>t.triangleIndex).join(','),topology});snapshotTopologies.set(s,topology);}
 const snap=(m:any)=>{
  const s=originalSnap(m);let topology=snapshotTopologies.get(s);
  if(!topology){const base=initial.get(m.name),ids=s.triangles.map((t:any)=>t.triangleIndex).join(',');
   if(ids===base.ids)topology=base.topology;
   else {topology=solidTopology(s,1e-12);assert(s.triangles.length>0,'No current actual surface triangles: '+m.name);if(base.topology.closed)assert(topology.closed,'Rigid structural material lost current-snapshot closure: '+m.name);const missing=base.topology.representatives.filter((r:any)=>!s.triangles.some((t:any)=>t.triangleIndex===r.triangleIndex));topologyRefreshes.push({mesh:m.name,pose:currentPose,previousComponentCount:base.topology.componentCount,currentComponentCount:topology.componentCount,currentTriangleCount:s.triangles.length,currentSkippedRelativeDegenerate:s.skippedDegenerate,missingPreviousRepresentatives:missing,currentClosed:topology.closed,policy:'Current actual triangle soup; unchanged1e-12 welding. No missing material representative or unresolved classification is ignored.'});}
   snapshotTopologies.set(s,topology);
  }
  a.topology.set(m.name,topology);return s;
 };
 const pose=(p:any)=>{currentPose=p;originalPose(p)};
 return {...a,snap,pose,topologyRefreshes};
}
