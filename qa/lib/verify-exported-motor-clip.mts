/** 独立解码第二个导出动作，检查实际四元数与四电机展折互锁；不以元数据标签代替运动。 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as T from 'three';
import {loadAudit} from './pose-audit.mts';
import {MOTOR_IDS} from '../../src/motors.ts';
const EXPECTED_SPIN_SIGNS={L_Front:-1,R_Front:1,L_Rear:1,R_Rear:-1} as const;
const reports=[];
for(const source of [process.env.QA_SOURCE??'assets/blender/xp4-source.glb',process.env.QA_MODEL??'public/models/xp4.glb']){
 const a=await loadAudit(source),clip=a.animations.find(c=>c.name==='TRANSWING_Motors_Start_Stop')!;assert.ok(clip);const mixer=new T.AnimationMixer(a.scene),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const previous=new Map<string,number>(),angles=new Map<string,number[]>(),folds=new Map<string,number[]>();let checks=0,stoppedChecks=0,minSignedIncrement=Infinity,maxAxisError=0;
 for(let frame=0;frame<=672;frame++){
  const time=frame/96;mixer.setTime(time);a.scene.updateMatrixWorld(true);
  for(const id of MOTOR_IDS){const prop=a.rig.props.find(p=>p.id===id)!,relative=prop.quaternion.clone().invert().multiply(prop.object.quaternion).normalize();const vector=new T.Vector3(relative.x,relative.y,relative.z);const offaxis=vector.clone().addScaledVector(prop.axis,-vector.dot(prop.axis)).length();maxAxisError=Math.max(maxAxisError,offaxis);assert.ok(offaxis*offaxis<2e-7,`${id} 导出旋转脱离实际轴`);const theta=2*Math.atan2(vector.dot(prop.axis),relative.w),prior=previous.get(id);const delta=prior===undefined?0:EXPECTED_SPIN_SIGNS[id]*Math.atan2(Math.sin(theta-prior),Math.cos(theta-prior));previous.set(id,theta);minSignedIncrement=Math.min(minSignedIncrement,delta);assert.ok(delta>=-1e-6,`${id} 导出动作反转`);
   const fractions=a.rig.blades.filter(b=>b.object.name.startsWith(`BladeFold_${id}_`)).map(b=>b.object.quaternion.angleTo(b.quaternion)/(Math.PI/2));assert.equal(fractions.length,2);assert.ok(Math.abs(fractions[0]-fractions[1])<1e-6);const fold=fractions[0];assert.ok(fold>=-1e-6&&fold<=1+1e-6);if(fold>1e-5){assert.ok(Math.abs(delta)<1e-6,`${id} 非全展时转动 @${time}`);stoppedChecks++}if(time<=.5||time>=6.5)assert.ok(Math.abs(fold-1)<1e-6);if(time>=1.5&&time<=5.5)assert.ok(fold<1e-6);
   if(!angles.has(id)){angles.set(id,[]);folds.set(id,[])}angles.get(id)!.push(delta);folds.get(id)!.push(fold);checks++;
  }
 }
 for(const id of MOTOR_IDS){const increments=angles.get(id)!;assert.ok(increments.some(x=>x>.01),`${id} 必须真实旋转`);const fs=folds.get(id)!;assert.ok(fs.some(x=>x>.1&&x<.9),`${id} 必须真实中间折角`)}
 reports.push({source,sha256:a.sha256,clip:clip.name,duration:clip.duration,samples:673,motorPoseChecks:checks,foldedNoRotationChecks:stoppedChecks,minSignedIncrement,maxAxisError,passed:true});
}
const result={passed:true,reports,limitations:['独立导出动作有限1/96秒采样；导出演示速度是可读可视化节拍，不与实时RPM参数等同','检查实际解码四元数及真实固定轴，不声称连续扫掠、浏览器或飞行安全']};writeFileSync(process.env.QA_OUT??'qa/current/results/exported-motor-clip-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
