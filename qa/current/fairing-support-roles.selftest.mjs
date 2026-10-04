/** Pure exact-role schema regressions; no model loading or clearance acceptance. */
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {fairingClearanceSpecifications,reviewFairingSupportRoles,assertFixedCoordinateOnly} from './fairing-support-roles.mjs';
const bytes=fs.readFileSync('qa/reference/previous-supports.json');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'64cadf0b8fd862350b2ca8b4911ba05a12d05387e2aff9a3796b4760d599d013');
const previous=JSON.parse(bytes),clone=x=>JSON.parse(JSON.stringify(x)),specs=fairingClearanceSpecifications(),retired=new Set(specs.map(s=>s.replacedFixedInterfaceId));
function fixture(){const prior=clone(previous),current=clone(previous);current.fixed=current.fixed.filter(d=>!retired.has(d.id));current.clearances=specs.map(s=>clone(s.clearance));const wing={supportRoleChanges:specs.map(s=>({id:s.replacedFixedInterfaceId,kind:'fixed-material-to-non-supporting-clearance',before:clone(prior.fixed.find(d=>d.id===s.replacedFixedInterfaceId)),after:clone(s.clearance),retainedSupportPath:clone(s.retainedSupportPath)}))};return {prior,current,wing};}
let checks=0;const test=fn=>{fn();checks++;},run=a=>reviewFairingSupportRoles(a.prior,a.current,a.wing);
test(()=>{const a=fixture(),r=run(a);assert.equal(r.retiredFixedMaterialInterfaceIds.length,4);assert(r.replacementClearancesAddNoSupportEdges&&r.actualClearanceNotEstablishedBySchema);assert(a.current.clearances.every(d=>d.supporting===false));});
test(()=>assert.deepEqual(reviewFairingSupportRoles(previous,previous,{}).retiredFixedMaterialInterfaceIds,[]));
for(const mutate of [
 a=>a.wing.supportRoleChanges.pop(),
 a=>a.current.fixed.push(clone(a.prior.fixed.find(d=>retired.has(d.id)))),
 a=>a.current.fixed.splice(a.current.fixed.findIndex(d=>!specs.some(s=>s.retainedSupportPath.includes(d.id))),1),
 a=>a.current.clearances.pop(),
 a=>a.current.clearances.push(clone(a.current.clearances[0])),
 a=>a.current.clearances[1].id=a.current.clearances[0].id,
 a=>a.wing.supportRoleChanges[0].before.minimumContactArea=0,
 a=>a.wing.supportRoleChanges[0].retainedSupportPath=[],
 a=>a.current.fixed.find(d=>d.id===specs[0].retainedSupportPath[0]).minimumContactArea=0,
 a=>a.current.fixed.splice(a.current.fixed.findIndex(d=>d.id===specs[0].retainedSupportPath[0]),1),
 a=>a.current.classification.pop(),
 a=>a.current.fits.push({...clone(a.current.clearances[0]),supporting:true}),
 a=>a.current.fits[0].angles=16,
 a=>{a.current.fixed=clone(a.prior.fixed);for(const d of a.current.fixed)if(retired.has(d.id))d.minimumContactArea=0;},
 ])test(()=>{const a=fixture();mutate(a);assert.throws(()=>run(a));});
for(const change of [
 c=>c.supporting=true,c=>c.maximumFairingRadius=.045,c=>c.nominalBoreRadius=.05,c=>c.nominalWallThickness=.001,
 c=>c.encodingTolerance.runtime=.001,c=>c.satEpsilon=.0001,c=>c.collisionExemption=true,
 c=>c.requiredEvidence.noFullObjectTriangleIntersection=false,c=>c.requiredEvidence.noFullObjectContainmentEitherDirection=false,
 c=>c.axisMarkers=['WingPivot_L','WingPivot_R'],c=>c.pair=['RootFairingFixed_L','Fuselage']
])test(()=>{const a=fixture();change(a.current.clearances[0]);change(a.wing.supportRoleChanges[0].after);assert.throws(()=>run(a));});
test(()=>{const a=fixture();a.current.fits[0].center=[-1.5,-.22,1.47];assert.equal(run(a).retiredFixedMaterialInterfaceIds.length,4,'Fit coordinate relocation is a separate existing exact review, not a new graph edge');});
test(()=>{const old=previous.fixed.find(d=>d.regions?.some(r=>r.cylinder)),next=clone(old);next.regions[0].cylinder.center[0]+=.15;assertFixedCoordinateOnly(old,next);next.regions[0].cylinder.radius+=.01;assert.throws(()=>assertFixedCoordinateOnly(old,next));});
test(()=>{const old=previous.fixed.find(d=>d.regions?.some(r=>r.cylinder)),next=clone(old);delete next.regions[0].cylinder.center;assert.throws(()=>assertFixedCoordinateOnly(old,next));});
test(()=>{const old=previous.fixed[0],next=clone(old);next.minimumContactArea=0;assert.throws(()=>assertFixedCoordinateOnly(old,next));});
const r={passed:true,checks,noModelsLoaded:true,physicalClearanceNotEstablished:true};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(r,null,2)+'\n');console.log(r);
