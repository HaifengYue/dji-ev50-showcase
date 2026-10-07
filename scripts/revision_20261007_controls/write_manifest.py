"""Compose current metadata from frozen lineage plus actual current local receipts."""
from pathlib import Path
import os,json,runpy,hashlib
ROOT=Path(__file__).resolve().parents[2];STAGE=ROOT/os.environ['TRANSWING_INTEGRATED_STAGE'];label=os.environ['TRANSWING_INTEGRATED_LABEL']
runpy.run_path(str(ROOT/'scripts/revision_20261007_edges/write_manifest.py'))
construction=ROOT/'qa/revision-20261007-controls'/(label+'-construction.json');data=json.loads(construction.read_text())
p=STAGE/'model-manifest.json';m=json.loads(p.read_text());a=m['annotationRevision'];a['baselineCommit']='1797d4b1a0d653f786552116a3e9063148b444de';a['parentRevision']='published edge contours and linked inset'
a['independentControls']=data['receipts']['controlEnlargement'];a['shellDetailRepairs']=data['receipts']['shellDetails'];a['currentConstructionReceiptSha256']=hashlib.sha256(construction.read_bytes()).hexdigest()
a['scope']='Mirrored inboard control span extension, six independently driven control owners, and bounded actual shell-detail repairs'
m['independentControls']={'ids':['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R'],'rangeDegrees':[-12,12],'currentGeometry':data['receipts']['controlEnlargement'],'legacyGroupControlsAccepted':True,'canonicalPerSurfaceOverridesAliasOverridesGroup':True,'noFactoryOrAerodynamicAuthorityClaim':True}
p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print('CURRENT_CONTROLS_MANIFEST',p)
