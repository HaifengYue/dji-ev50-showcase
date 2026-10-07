"""V27指定候选独立烘焙；复用冻结导出逻辑，不改V25源或发布位置。"""
from pathlib import Path
import bpy,sys,runpy,hashlib,json,struct,os,re
ROOT=Path(__file__).resolve().parents[2]
LABEL=os.environ.get('TRANSWING_INTEGRATED_LABEL','candidate-inset-integrated-a')
assert re.fullmatch(r'candidate-inset-integrated-[a-z0-9-]+',LABEL)
SOURCE=ROOT/'qa/revision-20261007'/(LABEL+'.blend')
STAGE=(ROOT/os.environ.get('TRANSWING_INTEGRATED_STAGE','qa/revision-20261007-inset/baked-integrated-a')).resolve()
assert STAGE.is_relative_to(ROOT/'qa/revision-20261007-inset')
EXPECTED=os.environ.get('TRANSWING_INTEGRATED_EXPECTED_SHA','51ec3c493b62d0d4caac924ddf1e26b6889288affa5ccd5376f0eb249be6e72c'if LABEL=='candidate-inset-integrated-a'else'')
assert EXPECTED and hashlib.sha256(SOURCE.read_bytes()).hexdigest()==EXPECTED,'Explicit candidate SHA mismatch'
STAGE.mkdir(parents=True,exist_ok=True)
if (STAGE/'xp4.blend').exists() or (STAGE/'xp4-source.glb').exists():
 raise RuntimeError('Refuse to overwrite existing V27 baked assets')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
FROZEN_PARENT=ROOT/'assets/baseline-v25-20261007'
metadata_lock=json.loads((ROOT/'V26_PIPELINE_METADATA_INPUTS.json').read_text())
assert metadata_lock['schema']=='transwing.v26-pipeline-metadata-inputs.v1'
assert {r['path']for r in metadata_lock['files']}=={'assets/baseline-v25-20261007/manifest.json','assets/baseline-v25-20261007/model-validation.json'}
for row in metadata_lock['files']:
 path=ROOT/row['path'];assert path.is_file()and path.stat().st_size==row['bytes']and sha(path)==row['sha256'],'Frozen V25 metadata input mismatch'
parent_manifest=json.loads((FROZEN_PARENT/'manifest.json').read_text())
assert parent_manifest['version']==25
for name,source in [('v25-parent-manifest.json',FROZEN_PARENT/'manifest.json'),('v25-parent-validation.json',FROZEN_PARENT/'model-validation.json'),('model-manifest.json',FROZEN_PARENT/'manifest.json')]:
 (STAGE/name).write_bytes(source.read_bytes())
# Optional read-only audit of an existing working tree. These current outputs
# are not copied or consumed by construction and may be absent in a fresh tree.
protected=['public/models/xp4.glb','public/models/manifest.json','assets/blender/xp4.blend','assets/blender/xp4-source.glb','assets/model-validation.json','CONSTRUCTION_INPUTS.json','REVISION_CONSTRUCTION_INPUTS.json','scripts/export-transition.py','scripts/revision_20261007/compress-model-revision.mjs','src/modelAssetRevision.ts','REVISION_DETAIL_CONSTRUCTION_INPUTS.json','REVISION_DETAIL_GEOMETRY_REFERENCE.json']
(STAGE/'V25_PROTECTED_IDENTITIES.json').write_text(json.dumps({p:sha(ROOT/p)for p in protected if (ROOT/p).is_file()},indent=2)+'\n')
(STAGE/'FROZEN_PARENT_METADATA_CHECK.json').write_text(json.dumps({'passed':True,'scope':'Frozen parent metadata lock checked before this bake; current main outputs are optional audit only','metadataInputLockSha256':sha(ROOT/'V26_PIPELINE_METADATA_INPUTS.json'),'checks':[{'frozenParentPath':r['path'],'sha256':r['sha256'],'byteIdenticalToStageCapture':True}for r in metadata_lock['files']]},indent=2)+'\n')
sys.path.insert(0,str(ROOT/'scripts'))
EXPORTER=ROOT/'scripts/export-transition.py'
assert sha(EXPORTER)=='900791a92748f6358257288c6de2b69d40e35d1e4dcb46a92f2b1d8abb630dc3'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE));scene=bpy.context.scene
bpy.context.view_layer.update()
def snapshot():
 rows={}
 for o in bpy.data.objects:
  if o.type not in ['MESH','EMPTY']:continue
  row={'type':o.type,'parent':o.parent.name if o.parent else None,'matrixBasis':[list(r)for r in o.matrix_basis],'matrixParentInverse':[list(r)for r in o.matrix_parent_inverse]}
  if o.type=='MESH':
   vv=[tuple(v.co)for v in o.data.vertices];polys=[]
   for f in o.data.polygons:
    pts=[struct.pack('<3f',*vv[i]).hex()for i in f.vertices]
    polys.append(str(f.material_index)+':'+','.join(min(pts[i:]+pts[:i]for i in range(len(pts)))))
   payload={'allVerticesIncludingUnused':sorted(struct.pack('<3f',*v).hex()for v in vv),'orientedPolygons':sorted(polys),'materials':[m.name if m else None for m in o.data.materials]}
   row.update(geometrySha256=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest(),vertices=len(vv),polygons=len(polys))
  rows[o.name]=row
 return rows
before=snapshot()
prior_path=ROOT/'REVISION_DETAIL_GEOMETRY_REFERENCE.json'
prior=json.loads(prior_path.read_text())['rows']
assert set(prior).issubset(before),'Original named node removed'
actual_meshes=sum(r['type']=='MESH'for r in before.values())
actual_nodes=len(before)
new_mesh_owners=sorted(n for n,r in before.items()if r['type']=='MESH'and(n not in prior or prior[n]['type']!='MESH'))
assert actual_nodes>=len(prior)
for side in ['L','R']:
 alias=bpy.data.objects['WingLowerClosure_'+side]
 assert alias.type=='EMPTY'and alias.parent.name=='WingPivot_'+side
 assert bpy.data.objects['Composite_wing_'+side].type=='MESH'
reference={'schema':'transwing.v27-detail-geometry-reference.v1','sourceCandidate':str(SOURCE.relative_to(ROOT)),'sourceCandidateSha256':sha(SOURCE),'rows':before,'verificationOnly':True,'priorGeometryReference':'REVISION_DETAIL_GEOMETRY_REFERENCE.json','priorGeometryReferenceSha256':sha(prior_path),'newMeshOwnersComparedToFrozenM':new_mesh_owners,'currentMeshOwnerNames':sorted(n for n,r in before.items()if r['type']=='MESH')}
(STAGE/'SOURCE_GEOMETRY_REFERENCE.json').write_text(json.dumps(reference,indent=2)+'\n')
ns=runpy.run_path(str(EXPORTER),run_name='v27_detail_animation_authoring')
ns['bake_transition'].__globals__['ROOT']=str(STAGE)
ns['bake_transition']();ns['select_clip'](ns['CLIP']);scene.frame_set(0);bpy.context.view_layer.update()
scene['detailRevision']='2026-10-07-v27-'+LABEL.removeprefix('candidate-');scene['revisionAccepted']=False
scene['revisionNote']=('V27 '+LABEL+'独立管线：当前球点/定长杆/前限位/丝杠相位重新烘焙；本次仅验证管线，外观与联合材料验收由同SHA独立收据决定，未发布')
blend=STAGE/'xp4.blend';bpy.ops.wm.save_as_mainfile(filepath=str(blend))
glb=STAGE/'xp4-source.glb';ns['export_transition'](str(glb))
receipt={'sourceCandidate':str(SOURCE.relative_to(ROOT)),'sourceCandidateSha256':sha(SOURCE),'pipelineTrialOnly':True,'appearanceStatus':('a尾腹连续隆起与宽轴口仍待修；此处仅做新方法验证'if LABEL=='candidate-inset-integrated-a'else'后继候选须按新SHA独立复核，管线通过不授予外观或联合材料验收'),'sourceGeometryReferenceSha256':sha(STAGE/'SOURCE_GEOMETRY_REFERENCE.json'),'animationMethod':'Unchanged frozen export-transition.py; two clips freshly baked against the explicitly pinned current candidate geometry and persisted mechanism','exporterSha256':sha(EXPORTER),'frozenParentMetadataInputLockSha256':sha(ROOT/'V26_PIPELINE_METADATA_INPUTS.json'),'outputs':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p)}for p in [blend,glb]],'expectedMeshes':actual_meshes,'expectedNodes':actual_nodes,'meshOwnerNames':sorted(n for n,r in before.items()if r['type']=='MESH'),'newMeshOwnersComparedToFrozenM':new_mesh_owners,'priorGeometryReferenceSha256':sha(prior_path),'lowerSkinMaterialOwners':['Composite_wing_L','Composite_wing_R'],'semanticAliases':{'WingLowerClosure_L':'EMPTY','WingLowerClosure_R':'EMPTY'},'animationVerified':False,'publicationPerformed':False,'finalDeliveryAccepted':False}
(STAGE/'BAKE_RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('V27_BAKED',json.dumps(receipt),flush=True)
