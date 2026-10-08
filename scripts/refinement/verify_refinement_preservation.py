"""Compare reopened original and refined native, preserving every unrelated owner."""
import bpy,json,sys,hashlib,struct
from pathlib import Path

def snapshot(path):
 bpy.ops.wm.open_mainfile(filepath=str(path.resolve()));bpy.context.scene.frame_set(0);bpy.context.view_layer.update();out={}
 for o in bpy.data.objects:
  row={'type':o.type,'parent':o.parent.name if o.parent else None,'basis':[list(r)for r in o.matrix_basis],'parentInverse':[list(r)for r in o.matrix_parent_inverse]}
  if o.type=='MESH':
   h=hashlib.sha256()
   for v in o.data.vertices:h.update(struct.pack('<3f',*v.co))
   for p in o.data.polygons:h.update(struct.pack('<II',len(p.vertices),p.material_index));h.update(struct.pack('<'+'I'*len(p.vertices),*p.vertices))
   row['geometrySha256']=h.hexdigest();row['materials']=[m.name if m else None for m in o.data.materials];row['cornerNormalsSha256']=hashlib.sha256(b''.join(struct.pack('<3f',*n.vector)for n in o.data.corner_normals)).hexdigest()
  out[o.name]=row
 return out

def main():
 source,candidate,out=map(Path,sys.argv[sys.argv.index('--')+1:]);assert hashlib.sha256(source.read_bytes()).hexdigest()=='41d1d093ce4b261483ffcc845303fc1e1b8cbb211c4b75ef24663aeb46f0d116';a=snapshot(source);b=snapshot(candidate);assert set(a)==set(b);changed=[n for n in a if a[n].get('geometrySha256')!=b[n].get('geometrySha256')];normals=[n for n in a if a[n].get('cornerNormalsSha256')!=b[n].get('cornerNormalsSha256')];transforms=[n for n in a if a[n]['basis']!=b[n]['basis']];parents=[n for n in a if a[n]['type']!=b[n]['type']or a[n]['parent']!=b[n]['parent']or a[n]['parentInverse']!=b[n]['parentInverse']];materials=[n for n in a if a[n].get('materials')!=b[n].get('materials')]
 expected_geometry={'Fuselage','Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R','BraceBodyCarriage_L','BraceBodyCarriage_R','BraceRod_mesh_L','BraceRod_mesh_R','Drive_LeadScrewThread'}
 expected_transforms={'BraceSpreader','Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2'}
 for side in ['L','R']:
  expected_transforms|={f'BraceBody_{side}',f'BraceRod_{side}',f'BraceBall_{side}_Body',f'BraceBallPin_{side}_Body',f'BraceRodEye_{side}_Root',f'BraceRodEyeNeck_{side}_Root',f'BraceRodFerrule_{side}_Root'}
 assert not parents and not materials and set(changed)<=expected_geometry and set(normals)<=expected_geometry and set(transforms)<=expected_transforms,(parents,materials,changed,normals,transforms)
 r={'schema':'transwing.native-refinement-preservation.v1','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'passed':True,'nodes':len(a),'meshes':sum(x['type']=='MESH'for x in a.values()),'changedGeometryOwners':changed,'changedCornerNormalOwners':normals,'changedLocalTransforms':transforms,'allParentsAndParentInverseMatricesUnchanged':True,'allMaterialBindingsUnchanged':True,'allOtherGeometryAndNormalsExactlyUnchanged':True,'sourceAndCandidateIndependentlyReopened':True};out.write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
if __name__=='__main__':main()
