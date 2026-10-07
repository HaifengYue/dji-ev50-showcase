"""Compare all native geometry or record the explicit small revision domain."""
from pathlib import Path
import hashlib,json,os,sys,re
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
from native_snapshot import snapshot
LABEL=os.environ.get('TRANSWING_EDGE_LABEL','candidate-inset-integrated-b-edge-linkage')
path=ROOT/'qa/revision-20261007'/(LABEL+'.blend')
ref=ROOT/'REVISION_EDGE_LINKAGE_GEOMETRY_REFERENCE.json'
current=snapshot(path)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
if os.environ.get('TRANSWING_EDGE_WRITE_REFERENCE')=='1':
    assert not ref.exists(),'Never overwrite an already frozen current reference'
    ref.write_text(json.dumps({'schema':'transwing.edge-linkage-geometry-reference.v1','sourceCandidateSha256':sha(path),'verificationOnly':True,'notAConstructionInput':True,'rows':current},indent=2)+'\n')
    baseline=json.loads((ROOT/'REVISION_INSET_GEOMETRY_REFERENCE.json').read_text())['rows']
    assert set(baseline)==set(current),'No added, removed or renamed authored node permitted'
    changes={name:[key for key in current[name] if current[name].get(key)!=baseline[name].get(key)] for name in current if current[name]!=baseline[name]}
    def allowed(name):
        return bool(re.match(r'^(Composite_wing_[LR]|Wing_blue_leading_[LR]|Fixed_root_[LR]|Fuselage|Brace.*|Drive_Front.*|Drive_GuideRail_[LR]|Drive_LeadScrewThread|Drive_ScrewRotor|Drive_MotorRotor|Drive_PlanetRotor_[0-9]+)$',name))
    unexpected=[n for n in changes if not allowed(n)]
    report={'sourceSha256':sha(path),'baseReferenceSha256':sha(ROOT/'REVISION_INSET_GEOMETRY_REFERENCE.json'),'changedNodes':changes,'unexpectedChangedNodes':unexpected,'meshCount':sum(row['type']=='MESH'for row in current.values()),'nodeCount':len(current),'passed':not unexpected,'rigAxesNacellesAndRearDriveProtectedByExactRowIdentity':True}
    (ROOT/'qa/revision-20261007-inset/EDGE_LINKAGE_CHANGE_DOMAIN.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2));assert report['passed']
else:
    reference=json.loads(ref.read_text());differences=[n for n in sorted(set(reference['rows'])|set(current)) if reference['rows'].get(n)!=current.get(n)]
    report={'passed':not differences,'referenceSha256':sha(ref),'candidateSha256':sha(path),'completeMeshCount':sum(row['type']=='MESH'for row in current.values()),'completeNodeCount':len(current),'differences':differences,'method':'Every exact stored Float32 vertex including unused vertices, oriented polygon/material association, named parent, local basis and parent inverse; Blend packaging excluded'}
    (ROOT/'qa/revision-20261007-inset/EDGE_LINKAGE_REBUILD_COMPARISON.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2));assert report['passed']
