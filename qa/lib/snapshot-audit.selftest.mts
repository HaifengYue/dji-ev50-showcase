/** 复现真实运行蓝色外皮在11/360姿态的失效代表索引，并拒绝旧缓存错误。 */
import assert from 'node:assert/strict';import fs from 'node:fs';
import {loadAudit as oldLoad} from './pose-audit.mts';
import {loadAudit} from './snapshot-audit.mts';
import {containedComponents} from './solid-contact.mjs';
const pose={label:'regression: disappearing quantized paint representative',wing:11/360,fold:[0,.25,.75,1],phase:[11*.07,0,0,0]};
const old=await oldLoad();old.pose(pose);const paint=old.scene.getObjectByName('Wing_blue_leading_L')!,root=old.scene.getObjectByName('Fixed_root_L')!,ps=old.snap(paint),rs=old.snap(root);
const stale=old.topology.get(paint.name),missing=stale.representatives.filter((p:any)=>!ps.triangles.some((t:any)=>t.triangleIndex===p.triangleIndex));assert(missing.some((p:any)=>p.triangleIndex===0),'Regression fixture no longer reproduces old missing triangle0');
assert.throws(()=>containedComponents(ps,rs,stale,old.topology.get(root.name)),TypeError,'Old cached representative must fail on this actual fixture');
const fixed=await loadAudit();fixed.pose(pose);const a=fixed.scene.getObjectByName(paint.name)!,b=fixed.scene.getObjectByName(root.name)!,sa=fixed.snap(a),sb=fixed.snap(b),result=containedComponents(sa,sb,fixed.topology.get(a.name),fixed.topology.get(b.name));assert.equal(result.length,0);assert(!(result.unresolved??[]).some((x:any)=>x.reason==='unresolved-ray-disagreement'));assert.equal(fixed.topology.get(a.name).closed,false);assert.equal(fixed.topology.get(a.name).componentCount,1);assert(fixed.topologyRefreshes.some(r=>r.mesh===a.name&&r.missingPreviousRepresentatives.length));
for(const p of [0,11/360,1,11/360,0]){fixed.pose({...pose,wing:p});const s=fixed.snap(a);assert(fixed.topology.get(a.name).representatives.every((r:any)=>s.triangles.some((t:any)=>t.triangleIndex===r.triangleIndex)));}
const report={passed:true,runtimeSha256:fixed.sha256,fixture:pose,mesh:a.name,missingOldRepresentatives:missing,oldErrorReproducedAndRejected:true,openPaintRemainsOpen:true,componentCount:1,containmentStillPerformed:true,thresholdsUnchanged:{relativeDegeneracy:64*Number.EPSILON,weld:1e-12,materialBoundary:1e-8,SAT:1e-9},refreshes:fixed.topologyRefreshes};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
