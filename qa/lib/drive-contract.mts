/** Reviewed QA contract is separate from the production pose solver. */
import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';
export const contractPath=process.env.QA_DRIVE_CONTRACT??'qa/contracts/reference-drive-motion.json';
export const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
export function makeDriveAssertion(rig:any){
 const node=(name:string)=>{const o=rig.scene.getObjectByName(name);assert(o,`Missing drive node ${name}`);return o as T.Object3D};
 const slider=node(contract.slider),axis=new T.Vector3(...contract.sliderAxis).normalize();assert(contract.lead>0);
 const restCoordinate=slider.position.dot(axis),rest=new Map<string,T.Quaternion>(contract.rotations.map((d:any)=>[d.name,node(d.name).quaternion.clone()]));
 for(const d of contract.rotations)if(d.parent)assert.equal(node(d.name).parent?.name,d.parent,`${d.name} orbital carrier hierarchy`);
 const spinPositions=new Map<string,T.Vector3>(contract.rotations.map((d:any)=>[d.name,node(d.name).position.clone()]));
 const fixed=contract.fixedNodes.map((name:string)=>({name,object:node(name),position:node(name).position.clone(),quaternion:node(name).quaternion.clone(),scale:node(name).scale.clone()}));
 const rigid=contract.rigidNodes.map((name:string)=>({name,object:node(name),position:node(name).position.clone(),quaternion:node(name).quaternion.clone(),scale:node(name).scale.clone()}));
 for(const d of rigid){let p:T.Object3D|null=d.object;while(p&&p!==slider)p=p.parent;assert(p===slider,`${d.name} must inherit the sole rigid slider`)}
 for(const d of fixed){let p:T.Object3D|null=d.object;while(p){assert(p!==slider&&!contract.rotations.some((r:any)=>r.name===p!.name),`${d.name} must be fixed to airframe, not moving parent ${p.name}`);p=p.parent}}
 function check(){
  rig.scene.updateMatrixWorld(true);const travel=slider.position.dot(axis)-restCoordinate,rows=[];
  for(const d of contract.rotations){const o=node(d.name);assert(o.position.distanceTo(spinPositions.get(d.name)!)<1e-9,`${d.name} bearing-axis translation changed`);const expected=rest.get(d.name)!.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(...d.localAxis).normalize(),travel/contract.lead*2*Math.PI*d.ratio));const error=1-Math.abs(o.quaternion.clone().normalize().dot(expected.normalize()));assert(error<1e-10,`${d.name} angle disagrees with physical travel/lead: ${error}`);assert(o.scale.equals(new T.Vector3(1,1,1)),`${d.name} must not scale`);rows.push({name:d.name,expectedUnwrappedRadians:travel/contract.lead*2*Math.PI*d.ratio,quaternion:o.quaternion.toArray(),qerror:error})}
  for(const d of [...fixed,...rigid]){assert(d.object.position.distanceTo(d.position)<1e-9,`${d.name} local translation changed`);assert(1-Math.abs(d.object.quaternion.clone().normalize().dot(d.quaternion.clone().normalize()))<1e-10,`${d.name} local rigid orientation changed`);assert(d.object.scale.equals(d.scale),`${d.name} must retain rest scale (including static mesh quantization normalization) without stretching`)}
  if(contract.planetary){const c=contract.planetary,carrier=node('Drive_ScrewRotor'),carrierWorld=carrier.getWorldPosition(new T.Vector3()),wa=new T.Vector3(0,0,-1).transformDirection(carrier.matrixWorld);for(let i=0;i<3;i++){const p=node(`Drive_PlanetRotor_${i}`).getWorldPosition(new T.Vector3()).sub(carrierWorld),radial=p.clone().addScaledVector(wa,-p.dot(wa)).length();assert(Math.abs(radial-c.orbitRadius)<1e-7,'Planet orbit radius changes')}assert.equal((c.sunRatio-c.carrierRatio)*c.sunTeeth+(0-c.carrierRatio)*c.ringTeeth,0,'Willis relation for fixed ring');assert.equal(c.relativePlanetRatio*c.planetTeeth+(c.sunRatio-c.carrierRatio)*c.sunTeeth,0,'Planet spin mesh ratio')}
  return {travel,rows,slider:slider.position.toArray()};
 }
 return {check,node,slider,rest,axis};
}
