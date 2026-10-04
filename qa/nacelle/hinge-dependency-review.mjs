/** Explicit approved hinge-height dependencies. Values do not replace actual physical gates. */
import assert from 'node:assert/strict';
const clone=x=>structuredClone(x);
const near=(a,b,message)=>assert(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6,message);
export const DEPENDENT_ANIMATION_NODES=Object.freeze(['BraceRod_L','BraceRod_R','BraceSpreader','Drive_MotorRotor','Drive_ScrewRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2']);
export function reviewHingeDependencyMetadata(previous,current,relocation){
 assert.deepEqual(relocation.deltaBlender,[0,0,.029]);assert.deepEqual(relocation.deltaGltf,[0,.029,0]);
 assert.deepEqual(relocation.previousRightPivotBlender,[1.5,-1.47,-.22]);assert.deepEqual(relocation.rightPivotBlender,[1.5,-1.47,-.191]);
 const before={mechanism:clone(previous.mechanism),internalDrive:clone(previous.internalDrive)},after={mechanism:clone(current.mechanism),internalDrive:clone(current.internalDrive)},changes=[];
 const restore=(parentA,parentB,key,path)=>{if(JSON.stringify(parentA[key])!==JSON.stringify(parentB[key]))changes.push({path,before:clone(parentA[key]),after:clone(parentB[key])});parentB[key]=clone(parentA[key]);};
 const oldTravel=before.mechanism.sliderTravel,newTravel=after.mechanism.sliderTravel;
 assert(Array.isArray(newTravel)&&newTravel.length===2&&newTravel.every(Number.isFinite));
 near(newTravel[0],1.0145352166,'Approved height change must reproduce the independently reviewed slider minimum');near(newTravel[1],oldTravel[1],'Cruise slider/body anchor must remain unchanged');
 assert(newTravel[0]>=before.mechanism.actualSlotTravel[0]&&newTravel[1]<=before.mechanism.actualSlotTravel[1]+1e-6,'New slider travel must remain within original real slot envelope');
 const deltaTravel=newTravel[0]-oldTravel[0];assert(deltaTravel<0);
 assert.deepEqual(after.internalDrive.stroke,newTravel,'One actual slider stroke controls the lowered drive');
 for(const side of ['L','R']){
  const a=before.mechanism.sides[side],b=after.mechanism.sides[side];assert(b.wingAnchorLocal.length===3);
  for(let k=0;k<3;k++)near(b.wingAnchorLocal[k],a.wingAnchorLocal[k]-(k===1?.029:0),'Wing ball cruise placement must be compensated only by the actual hinge rebase');
  assert.equal(b.braceLength,a.braceLength,'Cruise endpoints and physical rod length are unchanged in this approved height repair');
  restore(a,b,'wingAnchorLocal','mechanism.sides.'+side+'.wingAnchorLocal');
 }
 const oldStops=before.internalDrive.travelStopCentersBlenderY,newStops=after.internalDrive.travelStopCentersBlenderY;assert(newStops.length===2);
 near(newStops[0]-oldStops[0],deltaTravel,'Only the front stop follows the reviewed new minimum');assert.equal(newStops[1],oldStops[1],'Rear stop must remain exactly fixed');
 assert.equal(after.internalDrive.fixedAttachmentInterfaces.length,before.internalDrive.fixedAttachmentInterfaces.length);
 let frontInterfaces=0;
 for(let i=0;i<before.internalDrive.fixedAttachmentInterfaces.length;i++){
  const a=before.internalDrive.fixedAttachmentInterfaces[i],b=after.internalDrive.fixedAttachmentInterfaces[i];assert.deepEqual(b.pair,a.pair,'Drive interface identity/order changed');
  if(/^Drive_FrontTravelStop_[LR]$/.test(a.pair[0])){
   frontInterfaces++;assert.equal(a.frame,null);assert.equal(b.frame,null);
   for(const bound of ['min','max']){assert(b[bound].length===3);for(let k=0;k<3;k++)near(b[bound][k],a[bound][k]-(k===2?deltaTravel:0),'Front stop metadata may only translate with the actual slider minimum');restore(a,b,bound,'internalDrive.fixedAttachmentInterfaces.'+i+'.'+bound);}
  }
 }
 assert.equal(frontInterfaces,2);
 restore(before.mechanism,after.mechanism,'sliderTravel','mechanism.sliderTravel');
 restore(before.internalDrive,after.internalDrive,'stroke','internalDrive.stroke');
 restore(before.internalDrive,after.internalDrive,'travelStopCentersBlenderY','internalDrive.travelStopCentersBlenderY');
 assert.deepEqual(after,before,'Unapproved mechanism, fixed lowered-drive, slot, bore, body anchor or dependency metadata changed');
 return {changes,hingeDeltaGltf:relocation.deltaGltf,frontStopTranslationBlenderY:deltaTravel,unchangedRearStop:true,unchangedLowDriveFixedLayout:true,unchangedBodyAnchorCruise:true,unchangedRodLength:true,physicalAcceptanceEstablished:false};
}
