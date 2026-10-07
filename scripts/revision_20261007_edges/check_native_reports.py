"""Fail closed unless independent native reports bind to these exact bytes."""
from pathlib import Path
import hashlib,json,os
ROOT=Path(__file__).resolve().parents[2];LABEL=os.environ.get('TRANSWING_EDGE_LABEL','candidate-inset-integrated-b-edge-linkage')
source=ROOT/'qa/revision-20261007'/(LABEL+'.blend');digest=hashlib.sha256(source.read_bytes()).hexdigest();qa=ROOT/'qa/revision-20261007';checks=ROOT/'qa/revision-20261007-inset/edge-linkage-checks'
def read(p):return json.loads(p.read_text())
material=read(qa/(LABEL+'-dense-wing-material-check.json'));assert material['sourceBlendSha256']==digest and material['samples']==661 and material['passed'];assert not material['contacts']and not material['containedComponents']and not material['unresolvedContainment']
rotor=read(qa/(LABEL+'-rotor-fold-phase-preflight.json'));assert rotor['sourceBlendSha256']==digest and rotor['samples']==252 and rotor['passed']and not rotor['contacts']
support=read(checks/'SUPPORT_SLOT_CONTAINMENT_CHECK.json');assert support['sourceSha256']==digest and support['passedLimitedChecks'];assert not support['unexpectedStaticContacts']and not support['fuselageContainment']['strictInside'];assert all(r['components']==1 and r['nonmanifoldEdges']==0 and r['signedVolume']>0 for r in support['topology'].values())
drive=read(checks/(LABEL+'-sweep.json'));assert drive['sourceSha256']==digest and drive['sampleCount']==1201 and not drive['surfaceIntersections'];assert all(r['value']>0 for r in drive['minimumMeasuredAxialMargins'].values())
assembly=read(qa/(LABEL+'-material-and-support-check.json'));assert assembly['sourceBlendSha256']==digest and assembly['passed'];assert all(r['connectedComponents']==1 for r in assembly['topology'])
report={'schema':'transwing.current-native-motion-report-binding.v1','sourceSha256':digest,'passed':True,'sampledWingMaterialPoses':661,'rotorFoldCases':252,'drivePoses':1201,'closedContainmentIncluded':True,'sameRigidBodySkipsRequireSeparateLocalSelfIntersectionReview':True,'wholeMachineContinuousOrManufacturingCertification':False}
(checks/'NATIVE_MOTION_BINDING.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
