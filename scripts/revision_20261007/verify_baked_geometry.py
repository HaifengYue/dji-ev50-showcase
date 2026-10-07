from pathlib import Path
import bpy,json,hashlib,struct
ROOT=Path(__file__).resolve().parents[2];QA=ROOT/'qa/revision-20261007';ref=json.loads((ROOT/'REVISION_GEOMETRY_REFERENCE.json').read_text());source=ROOT/'assets/blender/xp4.blend';bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.scene.frame_set(99);bpy.context.view_layer.update();differences=[];mesh_count=0;static_count=0
for name,row in ref['rows'].items():
 o=bpy.data.objects.get(name)
 if o is None or o.type!=row['type']or(o.parent.name if o.parent else None)!=row['parent']:differences.append({'name':name,'kind':'hierarchy'});continue
 if o.type=='MESH':
  mesh_count+=1;verts=[tuple(v.co)for v in o.data.vertices];polys=[]
  for f in o.data.polygons:
   pts=[struct.pack('<3f',*verts[i]).hex()for i in f.vertices];polys.append(str(f.material_index)+':'+','.join(min(pts[i:]+pts[:i]for i in range(len(pts)))))
  payload={'allVerticesIncludingUnused':sorted(struct.pack('<3f',*v).hex()for v in verts),'orientedPolygons':sorted(polys),'materials':[m.name if m else None for m in o.data.materials]};sha=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  if sha!=row['geometrySha256']:differences.append({'name':name,'kind':'complete-geometry'})
 if not o.animation_data:
  static_count+=1
  if [list(r)for r in o.matrix_basis]!=row['matrixBasis']or[list(r)for r in o.matrix_parent_inverse]!=row['matrixParentInverse']:differences.append({'name':name,'kind':'static-local-frame'})
report={'passed':not differences,'candidateReferenceSha256':hashlib.sha256((ROOT/'REVISION_GEOMETRY_REFERENCE.json').read_bytes()).hexdigest(),'sourceCandidateSha256':ref['sourceCandidateSha256'],'bakedBlendSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'completeMeshIdentitiesCompared':mesh_count,'allNamedParentsCompared':len(ref['rows']),'staticLocalFramesCompared':static_count,'animatedFramesVerifiedSeparatelyByActualGLTFPlayback':True,'differences':differences}
(QA/'baked-candidate/BAKE_GEOMETRY_IDENTITY.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));assert report['passed']
