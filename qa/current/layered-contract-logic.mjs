/** New authorized wing placement, while physical thresholds and lowered drive stay explicit. */
import assert from 'node:assert/strict';
import {resolveFullPanStrip} from './layered-domain-schema.mjs';
import {reviewFairingSupportRoles,assertFixedCoordinateOnly} from './fairing-support-roles.mjs';
import {reviewSupportCoordinateChanges,reviewAdditionalFixedMaterialInterfaces} from './support-coordinate-review.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),sorted=x=>[...x].sort(),sameNames=(a,b)=>assert.deepEqual(sorted(a),sorted(b));
export function reviewLowerDriveDescription(previous,current,changes=[]){
 const path='internalDrive.layoutV22.reason',before='Real red-target ball relocation requires a longer single slider stroke; no telescoping rods or fake ball positions',after='低置固定布局保留；实际新翼侧球心与定长杆闭合重新决定滑架行程，不使用伸缩杆或虚假球心';
 assert.deepEqual(Object.keys(current).sort(),Object.keys(previous).sort(),'Lowered drive layout key set changed');
 for(const key of Object.keys(previous))if(key!=='reason')assert.deepEqual(current[key],previous[key],'Lowered drive physical field changed: '+key);
 if(current.reason===previous.reason)assert.deepEqual(changes,[],'Descriptive record without a change');else{assert.equal(previous.reason,before);assert.equal(current.reason,after);assert.deepEqual(changes,[{path,before,after}],'Only exact reviewed lowered-drive explanation may change');}
 return {lowerDrivePhysicalLayoutPreserved:true,reviewedDescriptionChangeCount:changes.length};
}
export function reviewLayeredContractValues(previous,n,c,s,prior,wing,supportBoundsContext){
 assert.equal(n.version,24);assert(c.reviewed&&s.reviewed&&wing.reviewed);assert(n.layeredWingJoint,'Missing explicit authored layered joint design');
 assert(wing.design.lowerWrapWitnessesBlender.length>=8);for(const w of wing.design.lowerWrapWitnessesBlender){assert(w.minimumGap>=.003,'Physical lower-wrap minimum gap may not be relaxed');assert(w.minimumSkinThickness>=.006,'Physical lower-wrap minimum wall must retain reviewed design minimum');assert([w.x,w.y,w.minimumGap,w.maximumGap,w.minimumSkinThickness,w.maximumSkinThickness].every(Number.isFinite));assert(w.maximumGap>=w.minimumGap&&w.maximumGap<=.020&&w.maximumSkinThickness>=w.minimumSkinThickness&&w.maximumSkinThickness<=.09);}
 assert(wing.design.anchorInteriorWitnessRadius>=.0445,'Wing-top seat radius .0245 plus .020 interior skin witness margin must not shrink');
 const scan=wing.design.layerScanBlender;assert(Number.isFinite(scan.step)&&scan.step>0&&scan.step<=.01);assert(scan.xRange[0]<=.64&&scan.xRange[1]>=1.9&&scan.yRange[0]<=-1.8&&scan.yRange[1]>=-1.01);
 const fullPan=resolveFullPanStrip(wing.design,scan);for(const p of fullPan.knots)assert(p.xInner>=scan.xRange[0]&&p.xOuter<=scan.xRange[1]);
 for(const key of ['panDomainBlender','curveKnotsBlender','nominalPanThickness','nominalCruiseVerticalGap'])assert.deepEqual(wing.design[key],n.layeredWingJoint.design?.[key],'Reviewed complete pan design differs from current explicit manifest '+key);
 for(const key of ['removedNodes','addedNodes','parentChanges','animationTimelineChangeNodes'])assert.deepEqual(c[key],[],key+' is outside reviewed wing scope');
 assert.equal(n.mechanism.rootClearance,previous.mechanism.rootClearance);assert.equal(n.rootInterface.axisHalfGap,previous.rootInterface.axisHalfGap);
 for(const key of ['sliderAxis','sliderBodyHeight','braceScale'])assert.deepEqual(n.mechanism[key],previous.mechanism[key]);
 for(const side of ['L','R'])for(const key of ['axis','foldAngle','bodyAnchorLocal','rodLocalAxis'])assert.deepEqual(n.mechanism.sides[side][key],previous.mechanism.sides[side][key],key+' changed beyond approved relocation');
 assert(n.mechanism.sliderTravel[0]>=previous.mechanism.sliderTravel[0]&&n.mechanism.sliderTravel[1]<=previous.mechanism.sliderTravel[1]+1e-6,'Slider must fit accepted low drive travel, otherwise needs a newly reviewed dependent redesign');
 for(const key of ['screwLead','reductionRatio','phaseSign','axis','sliderOffsetY','screwAxisHeightBlender','planetaryReduction'])assert.deepEqual(n.internalDrive[key],previous.internalDrive[key],key+' must preserve the accepted lowered drive');
 const lowerDriveDescription=reviewLowerDriveDescription(previous.internalDrive.layoutV22,n.internalDrive.layoutV22,wing.descriptiveMetadataChanges??[]);
 for(const key of ['axisZ','guideAxisZ','crossbeamZ','saddleZ','saddleSize','frameZ'])assert.deepEqual(n.internalDrive.loweredLayout[key],previous.internalDrive.loweredLayout[key]);
 assert.deepEqual(n.internalDrive.stroke,n.mechanism.sliderTravel);
 for(const key of ['classification','decorations','incidentalContacts','poses'])assert.deepEqual(s[key],prior[key],key+' may not relax physical classifications, limits or samples');
 const additionalMaterial=reviewAdditionalFixedMaterialInterfaces(prior,s,wing,c,supportBoundsContext),roleChanges=reviewFairingSupportRoles(prior,s,wing),retired=new Set(roleChanges.retiredFixedMaterialInterfaceIds);
 const oldFixed=new Map(prior.fixed.map(x=>[x.id,x])),nextFixed=new Map(s.fixed.map(x=>[x.id,x]));sameNames([...oldFixed.keys()].filter(id=>!retired.has(id)).concat(additionalMaterial.additionalFixedMaterialInterfaceIds),[...nextFixed.keys()]);const changedFixed=[];
 for(const[id,old]of oldFixed){if(retired.has(id))continue;const next=nextFixed.get(id);assertFixedCoordinateOnly(old,next);assert.equal(next.minimumContactArea,old.minimumContactArea,'No lower material-area threshold '+id);assert.deepEqual(next.pair,old.pair);assert.equal(next.frame??null,old.frame??null);
  if(old.cylinder){assert(next.cylinder,'Finite cylinder must remain '+id);for(const k of ['axis','range','minimumRadius','radius'])assert.deepEqual(next.cylinder[k],old.cylinder[k],'No relaxed finite cylinder '+id);}
  for(const region of next.regions??[next]){assert(region.min?.length===3&&region.max?.length===3);assert(region.min.every((v,k)=>Number.isFinite(v)&&Number.isFinite(region.max[k])&&v<region.max[k]));}
  if(JSON.stringify(next)!==JSON.stringify(old)){const reviewed=wing.supportInterfaceChanges.find(r=>r.id===id);assert(reviewed,'Changed material interface needs exact finite review '+id);assert.deepEqual(reviewed.before,old);assert.deepEqual(reviewed.after,next);changedFixed.push(id);}
 }
 const coordinateReview=reviewSupportCoordinateChanges(prior,s,wing,c,supportBoundsContext);
 const nextFits=new Map(s.fits.map(x=>[x.id,x]));sameNames([...nextFits.keys()],prior.fits.map(x=>x.id));const relocatedFits=[];
 for(const old of prior.fits){const next=nextFits.get(old.id),a=clone(old),b=clone(next);
  if(JSON.stringify(old)!==JSON.stringify(next)){const reviewed=wing.fitCoordinateChanges.find(r=>r.id===old.id);assert(reviewed,'Fit relocation needs exact review '+old.id);assert.deepEqual(reviewed.before,old);assert.deepEqual(reviewed.after,next);assert(/^root-carrier:[LR]$|^spherical:[LR]:Root$/.test(old.id),'Only moved root axis or rod-root endpoint fit coordinates can change');for(const k of ['center','eyeCenter']){delete a[k];delete b[k];}relocatedFits.push(old.id);}
  assert.deepEqual(b,a,'Bore/shaft radii, clearance ranges, stations and angular samples must stay identical '+old.id);
 }
 assert.deepEqual(n.jointRefinements.newCollisionExemptions,[]);
 return {acceptedLowerDriveHeightAndStraightOutputPreserved:true,hingeAndWingAnchorRelocationAuthorized:true,originalMaterialAreaThresholdsPreserved:true,allFitRadiusGapAndSamplingLimitsPreserved:true,changedFixedInterfaceIds:changedFixed,relocatedFitCenters:relocatedFits,...roleChanges,...coordinateReview,...additionalMaterial,...lowerDriveDescription,newCollisionExemptions:[],wingProfileAndSeamPreserved:false};
}
