"""重新烘焙两套完整动作至独立候选目录；不覆盖冻结基线。"""
from pathlib import Path
import bpy,sys,runpy,hashlib,json,os
ROOT=Path(__file__).resolve().parents[2];QA=ROOT/'qa/revision-20261007';STAGE=QA/'baked-candidate';sys.path.insert(0,str(ROOT/'scripts'))
label=os.environ.get('TRANSWING_REVISION_LABEL','candidate-final');source=QA/(label+'.blend');bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene
assert scene.get('revisionCandidate')==label
ns=runpy.run_path(str(ROOT/'scripts/export-transition.py'),run_name='revision_animation_authoring')
ns['bake_transition'].__globals__['ROOT']=str(STAGE)
ns['bake_transition']();ns['select_clip'](ns['CLIP']);scene.frame_set(0);bpy.context.view_layer.update()
scene['revisionAccepted']=False;scene['revisionNote']='2026-10-07三张标注图修订：新轴、闭合下蒙皮、中央翼腹、前两短舱、闭环连杆；仅概念模型；当前候选等待最终检查'
blend=STAGE/'xp4.blend';bpy.ops.wm.save_as_mainfile(filepath=str(blend));glb=STAGE/'xp4-source.glb';ns['export_transition'](str(glb))
receipt={'sourceCandidate':str(source.relative_to(ROOT)),'sourceCandidateSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'animationMethod':'unchanged frozen exporter logic, new current scene mechanism contract, two regenerated clips; no inherited old keyframes','outputs':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in [blend,glb]],'exporterSha256':hashlib.sha256((ROOT/'scripts/export-transition.py').read_bytes()).hexdigest(),'animationVerified':False}
(STAGE/'BAKE_RECEIPT.json').write_text(json.dumps(receipt,indent=2));print('BAKED',json.dumps(receipt),flush=True)
