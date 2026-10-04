/** Four explicitly authorized attachment-to-clearance changes; clearances never add support graph edges. */
import assert from 'node:assert/strict';
const clone=x=>JSON.parse(JSON.stringify(x)),sorted=x=>[...x].sort();
export function fairingClearanceSpecifications(){
 return ['L','R'].flatMap(side=>['Fixed','Moving'].map(role=>{
  const fairing='RootFairing'+role+'_'+side,host=role==='Fixed'?'Fixed_root_'+side:'Composite_wing_'+side;
  const replacedFixedInterfaceId='fixed:'+sorted([fairing,host]).join('/');
  const retainedSupportPath=role==='Fixed'?['fixed:RootFairingFixed_'+side+'/RootFixedBearingPedestal_'+side,'fixed:Fixed_root_'+side+'/RootFixedBearingPedestal_'+side]:['fixed:RootCarrierBridge_'+side+'/RootFairingMoving_'+side,'fixed:Composite_wing_'+side+'/RootCarrierBridge_'+side];
  return {replacedFixedInterfaceId,retainedSupportPath,clearance:{id:'clearance:fairing:'+side+':'+role,type:'finite-axis-triangle-clearance',supporting:false,pair:[fairing,host],fairing,host,axisMarkers:['RootAxisStart_'+side,'RootAxisEnd_'+side],nominalBoreRadius:.045,borePolygonSides:64,maximumFairingRadius:.044,nominalWallThickness:.0025,wallThicknessMeaning:'Actual shell meridian radial/depth offsets, not uniform normal thickness',encodingTolerance:{source:1e-6,runtime:6e-5},satEpsilon:1e-9,containmentEpsilon:1e-8,requiredPoses:'unchanged supports.poses',requiredEvidence:{closedFairingShell:true,actualShellMeridianOffsets:true,allFairingVerticesMaximumRadius:true,allHostTrianglesClippedToActualFairingAxialRange:true,nonemptyFiniteHostFaces:true,positiveActualRadialSeparation:true,noFullObjectTriangleIntersection:true,noFullObjectContainmentEitherDirection:true},collisionExemption:false,verificationStage:'fairing-clearance'}};
 }));
}
export function assertFixedCoordinateOnly(before,after){
 for(const key of ['min','max'])assert.equal(Object.hasOwn(after,key),Object.hasOwn(before,key),'Coordinate layout changed: '+before.id+'.'+key);
 const checkCenters=(a,b)=>{if(a.cylinder){assert(b.cylinder);assert.equal(Object.hasOwn(a.cylinder,'center'),Object.hasOwn(b.cylinder,'center'));assert(Array.isArray(b.cylinder.center)&&b.cylinder.center.length===3&&b.cylinder.center.every(Number.isFinite),'Finite actual cylinder center required');}if(a.regions){assert(Array.isArray(b.regions)&&a.regions.length===b.regions.length);a.regions.forEach((r,i)=>checkCenters(r,b.regions[i]));}};checkCenters(before,after);
 const signature=value=>{const r=clone(value);delete r.min;delete r.max;if(r.cylinder)delete r.cylinder.center;if(r.regions)r.regions=r.regions.map(signature);return r;};
 assert.deepEqual(signature(after),signature(before),'Only actual fixed-interface coordinate bounds/cylinder centers may move: '+before.id);
}
export function reviewFairingSupportRoles(prior,current,wing){
 const old=new Map(prior.fixed.map(d=>[d.id,d])),next=new Map(current.fixed.map(d=>[d.id,d]));
 assert.equal(old.size,prior.fixed.length,'Duplicate previous fixed interface');assert.equal(next.size,current.fixed.length,'Duplicate current fixed interface');
 const removed=[...old.keys()].filter(id=>!next.has(id)),added=[...next.keys()].filter(id=>!old.has(id));assert.deepEqual(added,[],'No new material-support graph edges authorized');
 const changes=wing.supportRoleChanges??[],clearances=current.clearances??[];
 if(!removed.length){assert.deepEqual(changes,[],'Role records without exact removed material interfaces');assert.deepEqual(clearances,[],'Clearance checks must replace the four explicit fairing material interfaces');return {retiredFixedMaterialInterfaceIds:[],newNonSupportingClearanceIds:[],requiredClearanceVerificationStage:null};}
 const specs=fairingClearanceSpecifications();
 assert.deepEqual(sorted(removed),sorted(specs.map(s=>s.replacedFixedInterfaceId)),'Only all four explicit fairing-to-wing material edges may be retired');
 assert(Array.isArray(changes)&&changes.length===4&&new Set(changes.map(c=>c.id)).size===4,'Exactly four unique support role records required');
 assert(Array.isArray(clearances)&&clearances.length===4&&new Set(clearances.map(c=>c.id)).size===4,'Exactly four unique non-supporting clearance checks required');
 assert.deepEqual(current.classification,prior.classification,'Fairing role changes cannot remove/reclassify any mesh');
 const fitIdentity=d=>{const r=clone(d);delete r.center;delete r.eyeCenter;return r;};assert.deepEqual(current.fits.map(fitIdentity),prior.fits.map(fitIdentity),'Role changes cannot create or alter a load-bearing fit; center relocation is reviewed separately');
 for(const spec of specs){
  const change=changes.find(c=>c.id===spec.replacedFixedInterfaceId),before=old.get(spec.replacedFixedInterfaceId);assert(change&&before,'Missing exact fairing role identity');
  assert.equal(change.kind,'fixed-material-to-non-supporting-clearance');assert.deepEqual(change.before,before,'Fairing role before record must equal immutable accepted interface');
  assert.deepEqual(change.after,spec.clearance,'Unapproved fairing clearance rule');assert.deepEqual(change.retainedSupportPath,spec.retainedSupportPath,'Retained physical support route changed');
  assert.deepEqual(clearances.find(c=>c.id===spec.clearance.id),spec.clearance,'Current clearance differs from exact reviewed replacement');
  for(const id of spec.retainedSupportPath){assert(old.has(id)&&next.has(id),'Actual fairing support route omitted: '+id);assertFixedCoordinateOnly(old.get(id),next.get(id));assert.equal(next.get(id).minimumContactArea,old.get(id).minimumContactArea,'Remaining fairing support area cannot shrink');}
 }
 assert.deepEqual(sorted(changes.map(c=>c.id)),sorted(removed));assert.deepEqual(sorted(clearances.map(c=>c.id)),sorted(specs.map(s=>s.clearance.id)));
 return {retiredFixedMaterialInterfaceIds:sorted(removed),newNonSupportingClearanceIds:sorted(clearances.map(c=>c.id)),requiredClearanceVerificationStage:'fairing-clearance',replacementClearancesAddNoSupportEdges:true,actualClearanceNotEstablishedBySchema:true};
}
