"""Default: reconstruct the frozen native edge geometry chain, then controls.
An explicit SHA-pinned accepted native stage is allowed only for development.
"""
from pathlib import Path
import bpy,sys,os,hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).parent;sys.path[:0]=[str(HERE),str(ROOT/'scripts')]
LABEL=os.environ.get('TRANSWING_CONTROLS_LABEL','candidate-inset-integrated-b-independent-controls-final');QA=ROOT/'qa/revision-20261007';OUT=ROOT/'qa/revision-20261007-controls';OUT.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
explicit=os.environ.get('TRANSWING_CONTROLS_BASE')
if explicit:
 source=Path(explicit).resolve();expected=os.environ.get('TRANSWING_CONTROLS_BASE_SHA');assert expected and sha(source)==expected,'Explicit native development base requires exact SHA pin'
else:
 base_label=LABEL+'-edge-base';env=os.environ.copy();env['TRANSWING_EDGE_LABEL']=base_label
 for k in ('TRANSWING_EDGE_BASE','TRANSWING_EDGE_BASE_SHA'):env.pop(k,None)
 subprocess.run([bpy.app.binary_path,'-b','-t','2','--python-exit-code','1','--python',str(ROOT/'scripts/revision_20261007_edges/build_candidate.py')],cwd=ROOT,env=env,check=True);source=QA/(base_label+'.blend')
base_report_path=ROOT/'qa/revision-20261007-inset'/(source.stem+'-construction.json')
previous=json.loads(base_report_path.read_text())
bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0
for side in ['L','R']:
 p=bpy.data.objects['WingPivot_'+side];assert not p.animation_data;p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
from enlarge_inboard import apply
receipt=apply()
from repair_shell_details import apply as repair_shell_details
shell_receipt=repair_shell_details()
scene=bpy.context.scene;scene['independentControlRevision']=LABEL;scene['revisionAccepted']=False
scene['revisionNote']='按红箭头向翼根加长左右内侧舵面50%，六面独立；保持原直铰轴及±12检视角，等待当前SHA全姿态材料验证'
path=QA/(LABEL+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path))
report={**previous,'candidate':LABEL,'sourceSha256':sha(path),'baseNativeSha256':sha(source),'baseWasExplicitDevelopmentStage':bool(explicit),'recipe':'frozen native edge/linkage geometry chain + bounded mirrored inboard control extension','deltaSourceFiles':{n:sha(HERE/n)for n in ['build_candidate.py','enlarge_inboard.py','repair_shell_details.py']},'receipt':receipt,'shellDetails':shell_receipt,'receipts':{**previous.get('receipts',{}),'controlEnlargement':receipt,'shellDetails':shell_receipt},'inheritedReceiptsAreLineageOnly':True,'geometryAccepted':False,'appearanceAccepted':False,'published':False}
(OUT/(LABEL+'-construction.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(ROOT/'qa/revision-20261007-inset'/(LABEL+'-construction.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('CONTROLS_CANDIDATE',str(path),report['sourceSha256'],flush=True)
