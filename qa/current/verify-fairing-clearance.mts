/** Mandatory independent source/runtime non-supporting fairing-clearance gate. */
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import * as T from 'three';
import {loadAudit} from './audit-scene.mts';
import {verifiedReference} from './reference-records.mjs';
import {reviewFairingSupportRoles,fairingClearanceSpecifications} from './fairing-support-roles.mjs';
import {verifyFairingClearancePair,FAIRING_CLEARANCE_LIMITS} from './fairing-clearance.mts';
import {hingeIdentity,isHingeFairing,validateHingeFairingDesign,fairingShellEvidence,worldPoints} from './hinge-identity.mts';
import {captureClearanceJson,assertClearanceJsonStable} from './fairing-clearance-evidence.mjs';
const hash=(p:string)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const supportsPath='qa/contracts/supports.json',wingPath='qa/contracts/layered-wing-refinement.json',supportsEvidence=captureClearanceJson(supportsPath),wingEvidence=captureClearanceJson(wingPath),supports=supportsEvidence.data,wing=wingEvidence.data,prior=verifiedReference('previous-supports.json');
assert.equal(prior.sha256,'64cadf0b8fd862350b2ca8b4911ba05a12d05387e2aff9a3796b4760d599d013');assert(supports.reviewed&&wing.reviewed,'Reviewed coordinate/role contracts are required before this physical gate');
const roles=reviewFairingSupportRoles(prior.data,supports,wing),specs=fairingClearanceSpecifications(),fairingDesign=validateHingeFairingDesign(wing.design.hingeFairings);
assert.equal(roles.retiredFixedMaterialInterfaceIds.length,4,'All four exact non-supporting clearance roles are required');assert.deepEqual(supports.poses,prior.data.poses,'No clearance pose reduction');assert.equal(supports.poses.length,17);
assert.equal(supports.reviewSourceSha256,wing.sourceSha256);const reports:any[]=[];
for(const[encoding,source]of [['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']]as const){
 const a=await loadAudit(source);assert.equal(a.sha256,wing[encoding+'Sha256']);const failures:any[]=[],shells:any[]=[],states:any[]=[],tolerance=FAIRING_CLEARANCE_LIMITS.encodingTolerance[encoding];
 const get=(name:string)=>{const node=a.scene.getObjectByName(name);assert(node,'Missing actual clearance node '+name);return node;};
 const actualMesh=(name:string)=>{const node:any=get(name);assert(node.isMesh,'Required clearance participant is not an actual mesh '+name);return node;};
 a.pose({label:'actual fairing shell and meridian proof',wing:1,fold:[1,1,1,1]});
 for(const spec of specs){const d=spec.clearance,mesh=actualMesh(d.fairing),identity=hingeIdentity(mesh.name);assert(identity&&isHingeFairing(identity));const pivot=get('WingPivot_'+identity.side).getWorldPosition(new T.Vector3()),proof=fairingShellEvidence(identity,worldPoints(mesh),mesh.geometry.index?.array??null,pivot,fairingDesign,tolerance);shells.push({name:mesh.name,...proof});if(!proof.passed)failures.push({id:d.id,reason:'actual fairing shell/meridian wall-offset proof failed',proof});}
 for(const pose of supports.poses){const appliedPose={label:'mandatory actual fairing clearance',fold:[0,0,0,0],phase:[.13,.39,.61,.87],...pose};a.pose(appliedPose);const pairs=[];
  for(const spec of specs){const d=spec.clearance,fairing=actualMesh(d.fairing),host=actualMesh(d.host);assert.equal(fairing.qaGroup,host.qaGroup,'Reviewed fairing clearance pair changed rigid-body ownership');
   const start=get(d.axisMarkers[0]).getWorldPosition(new T.Vector3()).toArray(),end=get(d.axisMarkers[1]).getWorldPosition(new T.Vector3()).toArray(),fsnap=a.snap(fairing),hsnap=a.snap(host),result=verifyFairingClearancePair(fsnap,hsnap,start,end,encoding,worldPoints(fairing).map(p=>p.toArray()));
   const row={id:d.id,definition:d,...result};pairs.push(row);if(!result.passed)failures.push({id:d.id,pose,reason:'actual fairing/wing clearance failed',failures:result.failures});
  }
  states.push({pose:appliedPose,pairs,passed:pairs.every(p=>p.passed)});
 }
 assert.equal(hash(source),a.sha256,'Production asset changed during physical fairing-clearance verification');
 reports.push({encoding,source,sha256:a.sha256,passed:!failures.length,clearanceIds:specs.map(s=>s.clearance.id),sampleCount:states.length,appliedPoseStates:states.map(s=>s.pose),shells,states,failures});
}
assertClearanceJsonStable(supportsEvidence);assertClearanceJsonStable(wingEvidence);
const report={passed:reports.every(r=>r.passed),sourceAndDecodedRuntimeCompared:true,supporting:false,addsSupportGraphEdges:false,createsCollisionExemptions:false,requiredGate:true,contractEvidence:{supports:{path:supportsPath,sha256:supportsEvidence.sha256},layeredWing:{path:wingPath,sha256:wingEvidence.sha256},priorSupport:{path:prior.path,sha256:prior.sha256}},roles,limits:FAIRING_CLEARANCE_LIMITS,reports,
 method:'All actual decoded fairing vertices; all actual host triangles clipped to the finite actual fairing axial window; projected polygon interiors and edges; complete original-tolerance triangle SAT and both-direction component containment. Four reviewed thin shells independently checked against complete actual meridians.',
 limitations:['The radial result is a conservative continuous-angle lower bound in a finite axial window, not a whole-object or whole-aircraft minimum Euclidean distance','Shell wall value is the reviewed radial/depth construction offset, not uniform normal thickness','Clearances are non-supporting obligations and never add support edges or contact exemptions; all ordinary support and unexpected same-rigid collision checks remain mandatory','Seventeen unchanged finite poses do not prove continuously swept clearance or engineering/manufacturing safety']};
fs.writeFileSync(process.env.QA_OUT??'qa/current/fairing-clearance-report.json',JSON.stringify(report,null,2)+'\n');console.log({passed:report.passed,reports:reports.map(r=>({encoding:r.encoding,sha256:r.sha256,poses:r.sampleCount,clearances:r.clearanceIds.length,failures:r.failures}))});if(!report.passed)process.exitCode=1;
