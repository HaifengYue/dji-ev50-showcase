"""Exact current native reconstruction identity and bounded modification domain."""
from pathlib import Path
import hashlib,json,os,re,sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/revision_20261007_edges'))
from native_snapshot import snapshot
LABEL=os.environ.get('TRANSWING_CONTROLS_LABEL','candidate-inset-integrated-b-independent-controls')
path=ROOT/'qa/revision-20261007'/(LABEL+'.blend');ref=ROOT/'REVISION_CONTROLS_GEOMETRY_REFERENCE.json'
OUT=ROOT/'qa/revision-20261007-controls';OUT.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
current=snapshot(path)
if os.environ.get('TRANSWING_CONTROLS_WRITE_REFERENCE')=='1':
 assert not ref.exists(),'Never overwrite a frozen current geometry reference'
 baseline=json.loads((ROOT/'REVISION_EDGE_LINKAGE_GEOMETRY_REFERENCE.json').read_text())['rows']
 assert set(baseline)==set(current),'All original node identities must survive'
 changes={n:[k for k in current[n]if current[n].get(k)!=baseline[n].get(k)]for n in current if current[n]!=baseline[n]}
 def allowed(n):
  return bool(re.fullmatch(r'Composite_wing_[LR]|Control(?:Surface|Pivot|AxisStart|Horn|FlexureFixed|FlexureMoving|HingeFixed|HingeMoving)_[LR]_Inboard|Ventral_antenna(?:\.001)?|Pod_U_access_panel_[LR]_(?:Front|Rear)(?:\.001)?',n))
 unexpected=[n for n in changes if not allowed(n)]
 report={'sourceSha256':sha(path),'parentReferenceSha256':sha(ROOT/'REVISION_EDGE_LINKAGE_GEOMETRY_REFERENCE.json'),'changedNodes':changes,'unexpectedChangedNodes':unexpected,'passed':not unexpected,'previousWingRootContoursLinkageAxesAllNacellesDriveAndOtherFourControlsProtected':True}
 (OUT/'CONTROLS_CHANGE_DOMAIN.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed'],report
 ref.write_text(json.dumps({'schema':'transwing.controls-geometry-reference.v1','sourceCandidateSha256':sha(path),'verificationOnly':True,'notAConstructionInput':True,'rows':current},indent=2)+'\n')
else:
 reference=json.loads(ref.read_text());differences=[n for n in sorted(set(reference['rows'])|set(current))if reference['rows'].get(n)!=current.get(n)]
 report={'sourceSha256':sha(path),'referenceSha256':sha(ref),'passed':not differences,'meshCount':sum(r['type']=='MESH'for r in current.values()),'nodeCount':len(current),'differences':differences,'method':'Every stored Float32 vertex, every oriented polygon and material, parent/local basis/parent inverse; packaging and recalculated split normals excluded'}
 (OUT/'CONTROLS_REBUILD_COMPARISON.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed'],report
print(json.dumps(report,indent=2))
