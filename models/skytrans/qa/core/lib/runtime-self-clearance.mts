/** 四个桨系局部实体回归：仅排除同一叶片刚体，不按整个Prop豁免。 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as T from 'three';
import {applyModelPose,type ModelRig} from '../../src/rig.ts';
import {loadRuntimeRig,setMotorSamples} from './runtime-rotor-motion.mts';
import {MOTOR_IDS} from '../../src/motors.ts';
const compactModule='./compact-geometry.mjs';
const {contact}=await import(compactModule);
const foldOwner=(object:T.Object3D)=>{for(let p:T.Object3D|null=object;p;p=p.parent)if(/^BladeFold_[LR]_(Front|Rear)_[AB]$/.test(p.name))return p;return null};
export function checkRuntimeSelfClearance(rig:ModelRig){
 const pairs:{blade:T.Mesh,target:T.Mesh}[]=[],seen=new Set<string>();
 assert.equal(rig.props.length,4,'必须检查全部四个旋翼');
 for(const id of MOTOR_IDS){const prop=rig.props.find(p=>p.id===id)!;assert.ok(prop);const meshes:T.Mesh[]=[];prop.object.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o)});
  for(const name of [`Spinner_${id}`,...['A','B'].flatMap(l=>[`Blade_${id}_${l}`,`Blade_hinge_pin_${id}_${l}`,`Blade_hinge_arm_${id}_${l}`])])assert.ok(meshes.some(m=>m.name===name),`缺少必检实体${name}`);
  for(const blade of meshes.filter(m=>foldOwner(m)))for(const target of meshes){if(foldOwner(blade)===foldOwner(target))continue;const key=[blade.uuid,target.uuid].sort().join('/');if(seen.has(key))continue;seen.add(key);pairs.push({blade,target});}
 }
 assert.ok(pairs.length>=36,'必须含八片叶片对自身销轴、短叉、桨帽与另一叶片');
 const contacts:unknown[]=[],unresolved:unknown[]=[],angles=[0,1,7.5,15,22.5,30,45,60,75,82.5,89,90];let triangleSATTests=0;
 for(const angle of angles){applyModelPose(rig,.5);setMotorSamples(rig,angle/90);for(const {blade,target} of pairs){const r=contact(blade,target);triangleSATTests+=r.triangleSATTests;if(r.intersects||!r.closed)contacts.push({foldDegrees:angle,blade:blade.name,target:target.name,...r});if(r.unresolved.length)unresolved.push({blade:blade.name,target:target.name,reasons:r.unresolved});}}
 return {passed:contacts.length===0&&unresolved.length===0,motorCount:4,foldAnglesDegrees:angles,pairCount:pairs.length,meshPairTests:angles.length*pairs.length,triangleSATTests,contacts,unresolved,limitations:['真实GLB实际顶点、Float64三角SAT epsilon=1e-9及闭合实体包含；不放宽旧容差','局部有限折角不代替全模型运动和连续碰撞证明；没有浏览器验收']};
}
export async function runRuntimeSelfClearance(){const {rig,sha256}=await loadRuntimeRig();return {runtimeSha256:sha256,...checkRuntimeSelfClearance(rig)}}
export async function verifyFilledRootFault(){const {rig}=await loadRuntimeRig();const fold=rig.scene.getObjectByName('BladeFold_L_Front_A');assert.ok(fold);const fill=new T.Mesh(new T.SphereGeometry(.017,12,8));fill.name='Injected_solid_blade_root';fold.add(fill);const r=checkRuntimeSelfClearance(rig);const witness=r.contacts.find((c:any)=>c.blade===fill.name&&c.target==='Blade_hinge_pin_L_Front_A');assert.ok(witness,'前桨实心填孔必须被拒绝，不能只覆盖后桨');return {injected:'前桨叶根轴孔恢复实心，球半径仍为旧故障强度.017',rejected:true,contact:witness}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r={...await runRuntimeSelfClearance(),faultInjection:await verifyFilledRootFault()};writeFileSync(process.env.QA_OUT??'qa/current/results/runtime-self-clearance-report.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}
