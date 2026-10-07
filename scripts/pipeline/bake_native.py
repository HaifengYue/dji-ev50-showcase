"""Re-bake current editable native baseline in memory; do not reconstruct old revisions."""
from pathlib import Path
import bpy,os,sys,runpy,json,hashlib,struct
ROOT=Path(__file__).resolve().parents[2];STAGE=(ROOT/os.environ.get('TRANSWING_INTEGRATED_STAGE','build/model')).resolve()
assert STAGE.is_relative_to(ROOT/'build')
contract=json.loads((ROOT/'scripts/data/current-model-contract.json').read_text());SOURCE=ROOT/contract['source']
assert contract['source']=='assets/blender/xp4.blend' and SOURCE.resolve().is_relative_to(ROOT)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(SOURCE)==contract['sourceSha256'],'Native baseline changed without updating reviewed contract'
STAGE.mkdir(parents=True,exist_ok=True);(STAGE/'assets/animation').mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'scripts'));bpy.ops.wm.open_mainfile(filepath=str(SOURCE));bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
assert json.loads(bpy.context.scene['annotatedMechanismJSON'])==contract['mechanism']
def snapshot():
 rows={}
 for o in bpy.data.objects:
  if o.type not in ('MESH','EMPTY'):continue
  row={'type':o.type,'parent':o.parent.name if o.parent else None,'matrixBasis':[list(r)for r in o.matrix_basis],'matrixParentInverse':[list(r)for r in o.matrix_parent_inverse]}
  if o.type=='MESH':
   vv=[tuple(v.co)for v in o.data.vertices];polys=[]
   for f in o.data.polygons:
    pts=[struct.pack('<3f',*vv[i]).hex()for i in f.vertices];polys.append(str(f.material_index)+':'+','.join(min(pts[i:]+pts[:i]for i in range(len(pts)))))
   payload={'allVerticesIncludingUnused':sorted(struct.pack('<3f',*v).hex()for v in vv),'orientedPolygons':sorted(polys),'materials':[m.name if m else None for m in o.data.materials]}
   row['cornerNormalsSha256']=hashlib.sha256(b''.join(struct.pack('<3f',*n.vector)for n in o.data.corner_normals)).hexdigest()
   row.update(geometrySha256=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest(),vertices=len(vv),polygons=len(polys))
  rows[o.name]=row
 return rows
before=snapshot();meshes=sorted(n for n,r in before.items()if r['type']=='MESH')
assert len(before)==contract['expectedNodes'] and len(meshes)==contract['expectedMeshes']
reference={'schema':'transwing.native-baseline-geometry.v1','sourceCandidate':contract['source'],'sourceCandidateSha256':sha(SOURCE),'rows':before,'currentMeshOwnerNames':meshes,'verificationOnly':True}
(STAGE/'SOURCE_GEOMETRY_REFERENCE.json').write_text(json.dumps(reference,indent=2)+'\n')
ns=runpy.run_path(str(ROOT/'scripts/export-transition.py'),run_name='current_native_export');ns['bake_transition'].__globals__['ROOT']=str(STAGE)
ns['bake_transition']();ns['select_clip'](ns['CLIP']);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
after=snapshot();assert set(after)==set(before)
for name in meshes:
 assert after[name]['geometrySha256']==before[name]['geometrySha256'],name
 assert after[name]['cornerNormalsSha256']==before[name]['cornerNormalsSha256'],name+' corner normals changed during bake'
for name,row in before.items():
 assert after[name]['type']==row['type'] and after[name]['parent']==row['parent'],name
 if not bpy.data.objects[name].animation_data:
  assert after[name]['matrixBasis']==row['matrixBasis'] and after[name]['matrixParentInverse']==row['matrixParentInverse'],name
source_glb=STAGE/'xp4-source.glb';ns['export_transition'](str(source_glb))
exported=snapshot()
for name in meshes:assert exported[name]['geometrySha256']==before[name]['geometrySha256'] and exported[name]['cornerNormalsSha256']==before[name]['cornerNormalsSha256'],name+' geometry/normals changed during export'
# Optional large derived Blender file, excluded from source control. Default avoids duplicate native assets.
if os.environ.get('TRANSWING_SAVE_BAKED_BLEND')=='1':bpy.ops.wm.save_as_mainfile(filepath=str(STAGE/'xp4.blend'),compress=True)
receipt={'schema':'transwing.native-baseline-rebake.v1','sourceCandidate':contract['source'],'sourceCandidateSha256':sha(SOURCE),'sourceGeometryReferenceSha256':sha(STAGE/'SOURCE_GEOMETRY_REFERENCE.json'),'expectedMeshes':len(meshes),'expectedNodes':len(before),'meshOwnerNames':meshes,'newMeshOwnersComparedToFrozenM':[],'lowerSkinMaterialOwners':['Composite_wing_L','Composite_wing_R'],'outputs':[{'path':str(source_glb.relative_to(ROOT)),'bytes':source_glb.stat().st_size,'sha256':sha(source_glb)}],'geometryUnchangedDuringBake':True,'cornerNormalsUnchangedDuringBakeAndExport':True,'historicalProceduralReconstruction':False,'editableNativeBaselineRebaked':True}
(STAGE/'BAKE_RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n');assert sha(SOURCE)==contract['sourceSha256'];print('NATIVE_BASELINE_REBAKE_PASSED')
