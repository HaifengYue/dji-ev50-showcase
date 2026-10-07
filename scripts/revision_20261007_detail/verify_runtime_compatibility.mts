/** Actual V26 staged GLB against unchanged production rig/UI geometry traversal. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath}from'node:url';
import * as THREE from 'three';
import{GLTFLoader}from'three/examples/jsm/loaders/GLTFLoader.js';
import{MeshoptDecoder}from'three/examples/jsm/libs/meshopt_decoder.module.js';
import{createModelRig,applyModelPose,measureModelRig,getWingJoint}from'../../src/rig.ts';
import{createRotorExposure}from'../../src/rotorExposure.ts';
import{createInternalDriveInspection}from'../../src/internalDriveInspection.ts';
import{runRuntimeMotionChecks,verifyRuntimeFaultInjection}from'../../qa/lib/runtime-rotor-motion.mts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const STAGE=path.resolve(ROOT,process.env.TRANSWING_DETAIL_STAGE??'qa/revision-20261007-detail/baked-candidate');
assert.ok(STAGE.startsWith(path.join(ROOT,'qa/revision-20261007-detail')+path.sep));
const report:any={passed:false,revision:26,files:[],productionSourceModified:false,browserPixelsTested:false,globalMaterialCollisionAcceptanceImplied:false};
const prior=process.env.QA_MODEL;
try{
for(const filename of['xp4-source.glb','xp4.glb']){
 const file=path.join(STAGE,filename),bytes=fs.readFileSync(file),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const scene=g.scene,rig=createModelRig(scene);assert.equal(rig.props.length,4);assert.equal(rig.blades.length,8);assert.equal(rig.braces.length,2);assert.equal(rig.internalDrive.length,5);
 let actualRenderMeshes=0;scene.traverse(o=>{if(o instanceof THREE.Mesh){actualRenderMeshes++;const clone=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();for(const m of Array.isArray(clone)?clone:[clone])m.dispose();}});
 const aliases=[];
 for(const side of['L','R']as const){const owner=scene.getObjectByName('Composite_wing_'+side),alias=scene.getObjectByName('WingLowerClosure_'+side);assert.ok(owner&&alias);assert.equal((alias as THREE.Mesh).isMesh,undefined);assert.equal(alias.parent?.name,'WingPivot_'+side);assert.equal(owner.parent?.name,'WingPivot_'+side);let primitives=0;owner.traverse(o=>{if(o instanceof THREE.Mesh){primitives++;assert.ok(o.geometry.getAttribute('position').count>0);}});assert.ok(primitives>=1);aliases.push({side,ownerType:owner.type,renderPrimitives:primitives,aliasType:alias.type});const joint=getWingJoint(rig,side)!;assert.ok(Math.abs(joint.angle-Math.PI*2/3)<1e-10);}
 const measured=measureModelRig(rig);assert.ok(!measured.bounds.isEmpty());let maximumClosure=0,axisChecks=0,boundsChecks=0;
 for(let i=0;i<=4000;i++){
  const u=i/4000;applyModelPose(rig,u);
  for(const{body,wing,rod,length}of rig.braces){const a=body.getWorldPosition(new THREE.Vector3()),b=wing.getWorldPosition(new THREE.Vector3());const error=Math.max(rod.localToWorld(new THREE.Vector3()).distanceTo(a),rod.localToWorld(new THREE.Vector3(0,length,0)).distanceTo(b),Math.abs(a.distanceTo(b)-length));maximumClosure=Math.max(maximumClosure,error);assert.ok(error<1e-6);assert.ok(rod.scale.equals(new THREE.Vector3(1,1,1)));}
  for(const prop of rig.props){const a=scene.getObjectByName('MotorAxisStart_'+prop.id)!.getWorldPosition(new THREE.Vector3()),b=scene.getObjectByName('MotorAxisEnd_'+prop.id)!.getWorldPosition(new THREE.Vector3()),axis=b.sub(a).normalize(),hub=prop.object.getWorldPosition(new THREE.Vector3());assert.ok(hub.sub(a).cross(axis).length()<1e-4);if(i===0)assert.ok(axis.y>.9999);if(i===4000)assert.ok(axis.z>.9999);axisChecks++;}
  if(i%10===0){const current=new THREE.Box3().setFromObject(scene).translate(new THREE.Vector3(0,measured.groundOffset,0));assert.ok(measured.bounds.clone().expandByScalar(.01).containsBox(current));boundsChecks++;}
 }
 for(const u of[0,.13,.5,1,.89,.5,.13,0]){applyModelPose(rig,u);const snapshot=rig.braces.map(x=>({position:x.rod.position.clone(),quaternion:x.rod.quaternion.clone()}));applyModelPose(rig,u,true);applyModelPose(rig,u);rig.braces.forEach((x,i)=>{assert.ok(x.rod.position.distanceTo(snapshot[i].position)<1e-10);assert.ok(1-Math.abs(x.rod.quaternion.dot(snapshot[i].quaternion))<1e-12);});}
 const inspection=createInternalDriveInspection(scene);inspection.setActive(true);inspection.setActive(false);inspection.dispose();const exposure=createRotorExposure(rig);exposure.update(null);exposure.dispose();
 process.env.QA_MODEL=file;const motion=await runRuntimeMotionChecks(),fault=await verifyRuntimeFaultInjection();assert.equal(motion.passed,true);assert.equal(fault.rejected,true);
 report.files.push({file:path.relative(ROOT,file),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),actualRenderMeshes,aliases,continuousParameterSamples:4001,maximumRigidRodClosureError:maximumClosure,actualMotorAxisChecks:axisChecks,boundsChecks,explodedRestoreChecks:8,productionMotorMotion:motion,productionMotionFaultInjection:fault});
}
report.passed=true;
}finally{if(prior===undefined)delete process.env.QA_MODEL;else process.env.QA_MODEL=prior;}
fs.writeFileSync(path.join(STAGE,'RUNTIME_COMPATIBILITY_CHECK.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,files:report.files.map((r:any)=>({...r,productionMotorMotion:{passed:r.productionMotorMotion.passed,poseChecks:r.productionMotorMotion.poseChecks,axisPlaneChecks:r.productionMotorMotion.axisPlaneChecks}}))},null,2));
