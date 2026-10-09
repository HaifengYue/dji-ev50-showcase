/** V14独立四电机运行门槛：真实GLB、真实驱动与实际对象姿态；不把Node检查称为浏览器验收。 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {applyModelPose,applyMotorPose,createModelRig,type ModelRig} from '../../src/rig.ts';
import {MOTOR_IDS,newMotorState,newMotorCommands,newMotorStates,stepMotor,type MotorCommands,type MotorStates} from '../../src/motors.ts';
export const EXPECTED_SPIN_SIGNS={L_Front:-1,R_Front:1,L_Rear:1,R_Rear:-1} as const;
export type Driver=typeof applyModelPose;
export const qerror=(a:T.Quaternion,b:T.Quaternion)=>1-Math.abs(a.clone().normalize().dot(b.clone().normalize()));
export async function loadRuntimeRig(source:string|URL=process.env.QA_MODEL??new URL('../../public/models/xp4.glb',import.meta.url)){
 const bytes=readFileSync(source),model=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const parent=new T.Group();parent.add(model.scene);const rig=createModelRig(model.scene);
 return {rig,parent,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function setMotorSamples(rig:ModelRig,fold:number,phases:number[]=MOTOR_IDS.map(()=>0)){
 const states=newMotorStates();for(const [i,id] of MOTOR_IDS.entries())states[id]={rpm:fold===0?900:0,fold,phase:fold===0?phases[i]:0,stage:fold===0?'running':fold===1?'folded':'folding',requested:fold===0};
 applyMotorPose(rig,states);return states;
}
/** 逐个真实桨叶四元数检查；不能只信任stage或fold标记。 */
export function assertRuntimePose(rig:ModelRig,unfold:number,exploded=false){
 assert.equal(rig.props.length,4);assert.equal(rig.blades.length,8,'全部八片桨叶必须有独立折叠轴');
 for(const prop of rig.props){
  const s=prop.motor;assert.ok([s.rpm,s.fold,s.phase].every(Number.isFinite));assert.ok(s.rpm>=0&&s.rpm<=12000);assert.ok(s.fold>=0&&s.fold<=1);assert.ok(s.phase>=0&&s.phase<Math.PI*2+1e-10);
  if(s.rpm>1e-8)assert.equal(s.fold,0,`${prop.id} 转动前必须完全展开`);
  if(s.fold>1e-8){assert.equal(s.rpm,0);assert.equal(s.phase,0,`${prop.id} 折叠过程必须在停车相位`)}
  if(s.stage==='folded'){assert.equal(s.rpm,0);assert.equal(s.phase,0);assert.equal(s.fold,1)}
  const expected=prop.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(prop.axis,s.phase*EXPECTED_SPIN_SIGNS[prop.id]));
  assert.ok(qerror(prop.object.quaternion,expected)<1e-10,`${prop.id} 实际桨毂必须服从真实电机轴`);
  assert.ok(Math.abs(prop.object.quaternion.length()-1)<1e-6);
  for(const blade of rig.blades.filter(b=>b.object.name.startsWith(`BladeFold_${prop.id}_`))){
   const expected=blade.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),(blade.object.name.endsWith('_A')?1:-1)*s.fold*Math.PI/2));
   assert.ok(qerror(blade.object.quaternion,expected)<1e-10,`${blade.object.name} 实际折角与独立电机状态不符`);
  }
 }
 if(!exploded){rig.scene.updateWorldMatrix(true,true);for(const {rod,body,wing,length} of rig.braces){
  assert.ok(rod.localToWorld(new T.Vector3()).distanceTo(body.getWorldPosition(new T.Vector3()))<1e-6,`${rod.name} 起点脱开`);
  assert.ok(rod.localToWorld(new T.Vector3(0,length,0)).distanceTo(wing.getWorldPosition(new T.Vector3()))<1e-6,`${rod.name} 末端脱开 @ ${unfold}`);
  assert.ok(rod.scale.equals(new T.Vector3(1,1,1)),`${rod.name} 不得伸缩补偿`);
 }}
}
const snapshot=(rig:ModelRig)=>JSON.stringify({nodes:[...rig.nodes.values()].map(n=>[n.object.name,n.object.position.toArray(),n.object.quaternion.toArray(),n.object.scale.toArray()]),motors:rig.props.map(p=>p.motor)});
const commands=(mask:number):MotorCommands=>Object.fromEntries(MOTOR_IDS.map((id,i)=>[id,{enabled:Boolean(mask&(1<<i)),targetRpm:[660,1140,1920,2820][i]}])) as MotorCommands;
export async function runRuntimeMotionChecks(driver:Driver=applyModelPose){
 const {rig,sha256}=await loadRuntimeRig();
 const report={modelVersion:15,runtimeSha256:sha256,passed:false,motorCount:4,bladeCount:8,poseChecks:0,pauseChecks:0,independentMasks:0,wingJumps:0,interruptedSequences:0,partitionChecks:0,invalidAtomicChecks:0,axisPlaneChecks:0,stages:[] as string[],faultsRejected:0,limitations:['真实Node运行函数与实际GLB姿态，未执行浏览器、GPU、输入或帧率验收','四电机独立控制和有限时间步不构成飞控、气动、制造或连续碰撞认证','寻位阶段以受控低速机械归零；folded静止阶段无旋转，不能将indexing的rpm=0误称轴已停止运动']};
 const stages=new Set<string>();
 const apply=(wing:number,dt:number,c:MotorCommands,exploded=false)=>{driver(rig,wing,exploded,dt,c);assertRuntimePose(rig,wing,exploded);report.poseChecks++;rig.props.forEach(p=>stages.add(p.motor.stage));};
 const off=newMotorCommands();
 for(let mask=0;mask<16;mask++){
  for(const wing of [0,.125,.5,.875,1]){
   applyMotorPose(rig,newMotorStates());const c=commands(mask);
   for(let n=0;n<200;n++)apply(wing,.025,c);
   for(const [i,id] of MOTOR_IDS.entries()){const s=rig.props.find(p=>p.id===id)!.motor;assert.equal(s.rpm,mask&(1<<i)?c[id].targetRpm:0);assert.equal(s.fold,mask&(1<<i)?0:1)}
   const before=JSON.stringify(rig.props.map(p=>p.motor));apply(1-wing,0,c);assert.equal(JSON.stringify(rig.props.map(p=>p.motor)),before,'整翼跳转不得改变四电机状态');report.wingJumps++;
   const frozen=snapshot(rig);apply(1-wing,0,c);assert.equal(snapshot(rig),frozen,'零步长必须保持真实姿态');report.pauseChecks++;
   for(let n=0;n<220;n++)apply(1-wing,.025,off);
   const stopped=snapshot(rig);apply(1-wing,.5,off);assert.equal(snapshot(rig),stopped,'收桨停稳后不得继续旋转');
  }report.independentMasks++;
 }
 // 对每机独立中断，涵盖展叶、升速、降速、寻位、收叶，再启动。固定种子只用于可重现扰动。
 let seed=1741;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};
 for(let n=0;n<640;n++){const c=commands(Math.floor(random()*16));for(const id of MOTOR_IDS)c[id].targetRpm=60+Math.floor(random()*11941);apply(random(),[0,.001,.017,.13,.31,1.7,5,60][n%8],c);report.interruptedSequences++;}
 // 解析积分必须与小步分割一致，四元数相位按周期比较，不能只比较状态标签。
 for(const seconds of [.001,.65,.651,1,2.75,10,60])for(const targetRpm of [0,19,20,59,60,1800,12000])for(const initial of [newMotorState(),{rpm:1371,phase:1.271,fold:0,stage:'running' as const,requested:true},{rpm:0,phase:4.123,fold:0,stage:'indexing' as const,requested:false},{rpm:0,phase:0,fold:.413,stage:'folding' as const,requested:false}]){
  const c={enabled:targetRpm>0,targetRpm},big=stepMotor(initial,c,seconds);let tiny={...initial};const count=100;for(let i=0;i<count;i++)tiny=stepMotor(tiny,c,seconds/count);
  assert.ok(Math.abs(big.rpm-tiny.rpm)<1e-6&&Math.abs(big.fold-tiny.fold)<1e-9);assert.ok(Math.abs(Math.sin((big.phase-tiny.phase)/2))<1e-7,'有限大步长与子步相位不一致');report.partitionChecks++;
 }
 apply(.25,.3,commands(15));for(const input of [NaN,Infinity,-1,61]){const before=snapshot(rig);assert.throws(()=>driver(rig,.85,false,input,commands(15)));assert.equal(snapshot(rig),before);report.invalidAtomicChecks++;}
 for(const value of [NaN,Infinity,-1,12001]){const c=commands(15);c.R_Rear.targetRpm=value;const before=snapshot(rig);assert.throws(()=>driver(rig,.85,false,.37,c));assert.equal(snapshot(rig),before,'第4电机非法不能使前几台或整翼部分更新');report.invalidAtomicChecks++;}
 // 用实际网格的一点跨三个旋转相位构成扫掠平面，并与独立固定轴端点相比较。
 for(const wing of [0,.17,.49,.74,.9,1])for(const id of MOTOR_IDS){const points:T.Vector3[]=[];let axis:T.Vector3|undefined;for(const angle of [0,Math.PI*2/3,Math.PI*4/3]){apply(wing,0,off);const states=newMotorStates();for(const key of MOTOR_IDS)states[key]={rpm:900,phase:angle,fold:0,stage:'running',requested:true};applyMotorPose(rig,states);const mesh=rig.scene.getObjectByName(`Blade_${id}_A`) as T.Mesh;assert.ok(mesh?.isMesh);points.push(new T.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'),0).applyMatrix4(mesh.matrixWorld));axis=rig.scene.getObjectByName(`MotorAxisEnd_${id}`)!.getWorldPosition(new T.Vector3()).sub(rig.scene.getObjectByName(`MotorAxisStart_${id}`)!.getWorldPosition(new T.Vector3())).normalize();}const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();assert.ok(Math.abs(normal.dot(axis!))>1-1e-7,`${id} 扫掠平面必须垂直实体轴`);report.axisPlaneChecks++;}
 for(const stage of ['folded','unfolding','accelerating','running','decelerating','indexing','folding'])assert.ok(stages.has(stage),`缺少${stage}状态覆盖`);
 report.stages=[...stages].sort();report.passed=true;return report;
}
export async function verifyRuntimeFaultInjection(){
 const {rig}=await loadRuntimeRig();applyModelPose(rig,.5,false,2,commands(15));
 const prop=rig.props.find(p=>p.id==='L_Front')!;prop.motor.fold=.5;applyMotorPose(rig);
 assert.throws(()=>assertRuntimePose(rig,.5),/转动前必须完全展开/);
 return {rejected:true,injected:'前桨带速收桨，与旧后桨范围无关'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await runRuntimeMotionChecks();const result={...report,faultInjection:await verifyRuntimeFaultInjection()};writeFileSync(process.env.QA_OUT??'qa/current/results/runtime-rotor-motion-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
