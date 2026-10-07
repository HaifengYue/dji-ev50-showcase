"""Reconstruct the published B lineage, then apply the two annotated local edits.

An explicitly SHA-pinned native B stage is allowed for development iteration.
Without it, the immutable complete B construction chain is executed first.
Final output assets are never used as a geometric input to the default route.
"""
from pathlib import Path
import hashlib,json,os,subprocess,sys
import bpy
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).parent
QA=ROOT/'qa/revision-20261007'
OUT=ROOT/'qa/revision-20261007-inset'
LABEL=os.environ.get('TRANSWING_EDGE_LABEL','candidate-inset-integrated-b-edge-linkage')
sys.path[:0]=[str(HERE),str(ROOT/'scripts'),str(ROOT/'scripts/revision_20261007_inset')]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
explicit=os.environ.get('TRANSWING_EDGE_BASE')
if explicit:
    source=Path(explicit).resolve()
    expected=os.environ.get('TRANSWING_EDGE_BASE_SHA')
    assert expected and sha(source)==expected,'Explicit native base identity required'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    base_receipt=ROOT/'qa/revision-20261007-inset/candidate-inset-integrated-b-construction.json'
else:
    base_label=LABEL+'-base'
    base_env=os.environ.copy()
    base_env['TRANSWING_INTEGRATED_LABEL']=base_label
    # Frozen B Boolean results require its original four-thread process.
    # The local delta is applied only after a cold load, in this two-thread process.
    subprocess.run([bpy.app.binary_path,'-b','-t','4','--python-exit-code','1','--python',str(ROOT/'scripts/revision_20261007_inset/build_integrated_flat_candidate.py')],cwd=ROOT,env=base_env,check=True)
    source=QA/(base_label+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    base_receipt=OUT/(base_label+'-construction.json')
source_sha=sha(source)
previous=json.loads(base_receipt.read_text())
scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
for side in ['L','R']:
    p=bpy.data.objects['WingPivot_'+side]
    assert not p.animation_data,'Native author input required; rebake only after construction'
    p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
import repair_end_contours
from apply_linkage_inset import apply_revised_linkage
edges=repair_end_contours.apply()
linkage=apply_revised_linkage(anchor_abs_x=1.06)
scene['edgeLinkageRevision']=LABEL
scene['revisionAccepted']=False
scene['revisionNote']='标注端头轮廓及明显内移球点的联动修订；本候选须按新SHA验证，旧报告不授予当前通过'
bpy.context.view_layer.update()
path=QA/(LABEL+'.blend')
bpy.ops.wm.save_as_mainfile(filepath=str(path))
report={**previous,'candidate':LABEL,'sourceSha256':sha(path),'sourceRecipe':'Frozen complete B construction followed by bounded edge contours and linked anchor/internal-drive revision','baseNativeSha256':source_sha,'deltaSourceFiles':{name:sha(HERE/name)for name in ['build_candidate.py','repair_end_contours.py','apply_linkage_inset.py']},'rebuildProcessContract':{'blenderVersion':'4.3.2','frozenBaseThreads':4,'deltaThreads':2,'coldLoadBetweenStages':True},'baseWasExplicitDevelopmentStage':bool(explicit),'parentPublishedCommit':'d0ca0a5a7105e2ef55a909f67aca26faec65c33a','receipts':{**previous['receipts'],'edgeContours':edges,'linkageInset':linkage,'drivePhase':linkage['phase']},'geometryAccepted':False,'appearanceAccepted':False,'published':False,'inheritedReceiptsAreLineageOnly':True,'manufacturingOrStrengthCertification':False}
(OUT/(LABEL+'-construction.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('EDGE_LINKAGE_CANDIDATE',str(path),report['sourceSha256'],flush=True)
