"""以完整当前网格/父级/局部矩阵比较独立修订再生；不读最终模型作为构造输入。"""
from pathlib import Path
import bpy,json,hashlib,struct,os
ROOT=Path(__file__).resolve().parents[2];QA=ROOT/'qa/revision-20261007'
def snapshot(path):
 bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.view_layer.update();rows={}
 for o in bpy.data.objects:
  if o.type not in ['MESH','EMPTY']:continue
  row={'parent':o.parent.name if o.parent else None,'type':o.type,'matrixBasis':[list(r)for r in o.matrix_basis],'matrixParentInverse':[list(r)for r in o.matrix_parent_inverse]}
  if o.type=='MESH':
   vertices=[tuple(v.co)for v in o.data.vertices];polys=[]
   for f in o.data.polygons:
    points=[struct.pack('<3f',*vertices[i]).hex()for i in f.vertices];cyclic=[points[i:]+points[:i]for i in range(len(points))];polys.append(str(f.material_index)+':'+','.join(min(cyclic)))
   payload={'allVerticesIncludingUnused':sorted(struct.pack('<3f',*v).hex()for v in vertices),'orientedPolygons':sorted(polys),'materials':[m.name if m else None for m in o.data.materials]}
   row.update({'geometrySha256':hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'vertices':len(vertices),'polygons':len(polys)})
  rows[o.name]=row
 return rows
reference=ROOT/'REVISION_DETAIL_GEOMETRY_REFERENCE.json';candidate=QA/(os.environ.get('TRANSWING_REVISION_LABEL','candidate-detail-m-regenerated')+'.blend')
if os.environ.get('TRANSWING_CREATE_REFERENCE')=='1':
 original=QA/'candidate-detail-m.blend';ref={'schema':'transwing.revision-geometry-reference.v1','sourceCandidateSha256':hashlib.sha256(original.read_bytes()).hexdigest(),'rows':snapshot(original),'notAConstructionGeometrySubstitute':True};reference.write_text(json.dumps(ref,indent=2)+'\n')
ref=json.loads(reference.read_text());current=snapshot(candidate);differences=[]
for name in sorted(set(ref['rows'])|set(current)):
 if ref['rows'].get(name)!=current.get(name):differences.append(name)
report={'passed':not differences,'referenceSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'completeMeshCount':sum(r['type']=='MESH'for r in current.values()),'completeNodeCount':len(current),'differences':differences,'method':'Every mesh including unused vertices, complete oriented polygon/material association, each named parent, local basis and parent inverse, exact stored Float32 values; scene labels and Blend packaging excluded'}
(ROOT/'qa/revision-20261007-detail/REVISION_DETAIL_REBUILD_COMPARISON.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));assert report['passed'],differences
