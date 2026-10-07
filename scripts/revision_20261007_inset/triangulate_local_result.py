"""布尔多边面的显式合法三角化；不移动顶点，记录极小非共面四边面换对角线。"""
import bmesh,collections
from mesh_precision import face_area,triangle_area

def apply(obj):
 bm=bmesh.new();bm.from_mesh(obj.data);tag=bm.faces.layers.int.new('inset_polygon_source')
 for i,f in enumerate(bm.faces):f[tag]=i
 bmesh.ops.triangulate(bm,faces=list(bm.faces));repairs=[]
 for edge in list(bm.edges):
  if edge.is_manifold:continue
  groups=collections.defaultdict(list)
  for face in edge.link_faces:groups[face[tag]].append(face)
  for group,faces in groups.items():
   if len(faces)!=2 or any(len(f.verts)!=3 for f in faces):continue
   a,b=edge.verts;c=next(v for v in faces[0].verts if v not in edge.verts);d=next(v for v in faces[1].verts if v not in edge.verts)
   if triangle_area([c.co,d.co,a.co])==0 or triangle_area([d.co,c.co,b.co])==0 or bm.edges.get((c,d)):continue
   pa,pb,pc,pd=[obj.matrix_world@v.co for v in [a,b,c,d]];n=(pb-pa).cross(pc-pa);height=abs((pd-pa).dot(n))/max(n.length,1e-30)
   if height>1e-6:continue
   material=faces[0].material_index;before_area=sum(face_area(f)for f in faces);bmesh.ops.delete(bm,geom=faces,context='FACES_ONLY')
   for verts in [(c,d,a),(d,c,b)]:f=bm.faces.new(verts);f.material_index=material
   repairs.append({'originalPolygon':group,'maximumQuadPlaneDeviation':height,'beforeTwoTriangleArea':before_area,'afterTwoTriangleArea':triangle_area([c.co,d.co,a.co])+triangle_area([d.co,c.co,b.co]),'verticesUnmoved':True});break
 bad=sum(not e.is_manifold for e in bm.edges);zero=sum(face_area(f)==0 for f in bm.faces)
 assert bad==0 and zero==0,(obj.name,bad,zero)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free();obj.data.update()
 return {'node':obj.name,'nonManifoldEdges':bad,'trueFloat64ZeroAreaTriangles':zero,'diagonalRepairs':repairs,'verticesUnmoved':True}
