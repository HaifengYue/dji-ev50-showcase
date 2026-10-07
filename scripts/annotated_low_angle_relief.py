"""Bounded final root relief for native primitive generation.

The original loft, lower split, prior wall construction, axis and linkage are
inputs unchanged. This suffix cuts only the locked moving upper seam window,
rebuilds its actual side chain on common rows and lifts eight fixed inner
vertices. Geometry is always newly generated, never loaded from a finished model.
"""
from pathlib import Path
from fractions import Fraction as F
import json,hashlib,struct,bisect,collections
import bpy,bmesh
from mathutils import Matrix
DATA_PATH=Path(__file__).with_name('data')/'annotated-low-angle-relief.json'
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]

def orient(a,b,c):return(F(b[0])-F(a[0]))*(F(c[1])-F(a[1]))-(F(b[1])-F(a[1]))*(F(c[0])-F(a[0]))

def ears(vertices):
 normal=(vertices[1].co-vertices[0].co).cross(vertices[2].co-vertices[0].co)
 # Face normal can be determined by all corners if initial corners are collinear.
 normal=vertices[0].co.copy()*0
 for a,b in zip(vertices,vertices[1:]+vertices[:1]):normal+=a.co.cross(b.co)
 drop=max(range(3),key=lambda k:abs(normal[k]));dims=[i for i in range(3)if i!=drop];p=[tuple(float(v.co[k])for k in dims)for v in vertices];area=sum(F(a[0])*F(b[1])-F(a[1])*F(b[0])for a,b in zip(p,p[1:]+p[:1]));assert area;sg=1 if area>0 else-1;active=list(range(len(p)));out=[]
 while len(active)>3:
  available=[]
  for j,b in enumerate(active):
   a,c=active[j-1],active[(j+1)%len(active)];ar=orient(p[a],p[b],p[c])*sg
   if ar<=0:continue
   if any(all(orient(p[u],p[v],p[q])*sg>=0 for u,v in[(a,b),(b,c),(c,a)])for q in active if q not in[a,b,c]):continue
   available.append((ar,j,(a,b,c)))
  assert available,'No positive exact ear retaining all boundary vertices'
  _,j,t=max(available);out.append(t);active.pop(j)
 assert orient(*(p[i]for i in active))*sg>0;out.append(tuple(active));assert sum(orient(*(p[i]for i in t))for t in out)==area;return out

def _mesh_fingerprint(obj):
 points=[tuple(v.co)for v in obj.data.vertices];faces=[]
 for f in obj.data.polygons:
  assert len(f.vertices)==3;tri=tuple(points[i]for i in f.vertices);faces.append(min(tri[i:]+tri[:i]for i in range(3)))
 h=hashlib.sha256();h.update(struct.pack('<QQ',len(points),len(faces)))
 for point in sorted(points):h.update(struct.pack('<3d',*point))
 for tri in sorted(faces):
  for point in tri:h.update(struct.pack('<3d',*point))
 return {'sha256':h.hexdigest(),'vertices':len(points),'triangles':len(faces)}

def _repair_upper_cap(obj):
 side=obj.name[-1];sg=-1 if side=='L' else 1;bm=bmesh.new();bm.from_mesh(obj.data);bm.normal_update();bm.verts.ensure_lookup_table();bm.edges.ensure_lookup_table();bm.faces.ensure_lookup_table();world=obj.matrix_world
 chosen=set()
 for f in bm.faces:
  ps=[world@v.co for v in f.verts]
  if abs(f.normal.z)<.25 and min(p.y for p in ps)<-1.050 and max(p.y for p in ps)>-1.165 and min(p.z for p in ps)>-.225 and max(p.z for p in ps)<-.180:chosen.add(f)
 groups=[]
 while chosen:
  first=min(chosen,key=lambda f:f.index);chosen.remove(first);comp={first};stack=[first]
  while stack:
   for edge in stack.pop().edges:
    for adjacent in edge.link_faces:
     if adjacent in chosen:chosen.remove(adjacent);comp.add(adjacent);stack.append(adjacent)
  groups.append(comp)
 large=[g for g in groups if len(g)>20];assert len(large)==1,'Ambiguous actual upper side component';cap=sorted(large[0],key=lambda f:f.index);assert len(cap)==105
 parts=collections.defaultdict(list)
 for edge in bm.edges:
  if sum(f in large[0]for f in edge.link_faces)!=1:continue
  neighbors=[f for f in edge.link_faces if f not in large[0]];assert len(neighbors)==1
  nz=neighbors[0].normal.z;role='outer'if nz>.7 else'inner'if nz<-.7 else'end'
  parts[role].append({'vertices':[v.index for v in edge.verts]})
 g={'boundary':dict(parts)}
 selected=set(cap);chains={};oldchains={}
 for role in ['outer','inner']:
  ids={i for e in g['boundary'][role]for i in e['vertices']};chain=sorted((bm.verts[i]for i in ids),key=lambda v:float(v.co.y));assert all(a.co.y<b.co.y for a,b in zip(chain,chain[1:]));chains[role]=chain;oldchains[role]=[tuple(v.co)for v in chain]
 def interp(points,y):
  yp=[p[1]for p in points];j=bisect.bisect_left(yp,y)
  if j<len(points)and yp[j]==y:return points[j]
  assert 0<j<len(points);a,b=points[j-1:j+1];t=(y-a[1])/(b[1]-a[1]);return tuple(a[k]+t*(b[k]-a[k])for k in range(3))
 old_inner={v:tuple(v.co)for v in chains['inner']};outer_original={v:tuple(v.co)for v in chains['outer']};oy=[float(v.co.y)for v in chains['outer']];canonicalized=[]
 for v in chains['inner']:
  y=float(v.co.y);nearest=min(oy,key=lambda a:abs(a-y))
  if nearest!=y and abs(nearest-y)<1e-6:
   p=interp(oldchains['inner'],nearest);v.co.y=nearest;v.co.z=f32(p[2]);canonicalized.append({'from':y,'to':nearest})
 assert all(a.co.y<b.co.y for a,b in zip(chains['inner'],chains['inner'][1:]));ys=sorted({float(v.co.y)for vs in chains.values()for v in vs});assert chains['outer'][0].co.y==chains['inner'][0].co.y and chains['outer'][-1].co.y==chains['inner'][-1].co.y
 outer_direction=None
 firstedge=bm.edges.get((chains['outer'][0],chains['outer'][1]));face=next(f for f in firstedge.link_faces if f in selected);lp=next(l for l in face.loops if l.edge==firstedge);outer_direction=lp.vert==chains['outer'][0]
 touched=set();new_outer=[]
 for role in ['outer','inner']:
  original_chain=chains[role][:];expanded=[]
  for a,b in zip(original_chain,original_chain[1:]):
   expanded.append(a);ay,by=float(a.co.y),float(b.co.y);aa,bb=tuple(a.co),tuple(b.co);current=a
   for y in ys:
    if not ay<y<by:continue
    edge=bm.edges.get((current,b));assert edge is not None;touched.update(f for f in edge.link_faces if f not in selected);u=(y-float(current.co.y))/(float(b.co.y)-float(current.co.y));_,v=bmesh.utils.edge_split(edge,current,u);t=(y-ay)/(by-ay);point=tuple(f32(aa[k]+t*(bb[k]-aa[k]))for k in range(3));v.co=point;v.co.y=y;expanded.append(v);current=v
    if role=='outer':new_outer.append({'point':list(v.co),'edgeEndpoints':[list(aa),list(bb)],'maxCoordinateRounding':max(abs(point[k]-(aa[k]+t*(bb[k]-aa[k])))for k in range(3))})
  expanded.append(original_chain[-1]);assert [float(v.co.y)for v in expanded]==ys;chains[role]=expanded
 for i,(outer,inner)in enumerate(zip(chains['outer'],chains['inner'])):
  if i in [0,len(ys)-1]:continue
  target=f32(float(outer.co.x)+sg*2e-6)
  if sg*(target-float(inner.co.x))>0:inner.co.x=target
 for v,p in outer_original.items():assert tuple(v.co)==p
 maxmove=max(max(abs(a-b)for a,b in zip(old_inner[v],v.co))for v in old_inner);assert maxmove<=5.1e-6,maxmove
 old_count=sum(len(f.verts)-2 for f in cap);bmesh.ops.delete(bm,geom=cap,context='FACES_ONLY');newfaces=[]
 for i in range(len(ys)-1):
  quad=[chains['outer'][i],chains['outer'][i+1],chains['inner'][i+1],chains['inner'][i]]
  tris=[(quad[0],quad[1],quad[2]),(quad[0],quad[2],quad[3])]
  for vs in tris:
   if not outer_direction:vs=tuple(reversed(vs))
   f=bm.faces.new(vs);f.smooth=False;f.material_index=0;newfaces.append(f)
 retained_retri=0
 for f in list(touched):
  assert f.is_valid and f not in selected
  vs=list(f.verts)
  if len(vs)==3:continue
  tt=ears(vs);smooth=f.smooth;material=f.material_index;bmesh.ops.delete(bm,geom=[f],context='FACES_ONLY')
  for ids in tt:nf=bm.faces.new(tuple(vs[i]for i in ids));nf.smooth=smooth;nf.material_index=material;retained_retri+=1
 wires=[e for e in bm.edges if not e.link_faces];bmesh.ops.delete(bm,geom=wires,context='EDGES');dead=[v for v in bm.verts if not v.link_faces];bmesh.ops.delete(bm,geom=dead,context='VERTS');bm.normal_update();row={'node':obj.name,'commonRows':len(ys),'newSideTriangles':len(newfaces),'boundaryOriginalOuterVerticesUnmoved':len(outer_original),'insertedOuterVertices':new_outer,'existingInnerCoordinateDisplacementMaximum':maxmove,'innerYCanonicalization':canonicalized,'retainedSkinTrianglesRebuiltAfterEdgeSubdivision':retained_retri,'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(f.calc_area()==0 for f in bm.faces),'signedVolume':bm.calc_volume(signed=True),'sideRows':[{'outer':list(a.co),'inner':list(b.co)}for a,b in zip(chains['outer'],chains['inner'])]};bm.to_mesh(obj.data);bm.free();obj.data.update();return row

def apply_bounded_low_angle_relief():
 raw=DATA_PATH.read_bytes();data=json.loads(raw);assert data['schema']=='transwing.bounded-low-angle-relief.v1';plan=data['upper'];reports=[]
 for name,expected in data['preconstructionRootGeometry'].items():
  assert _mesh_fingerprint(bpy.data.objects[name])==expected,'Full original root construction identity mismatch: '+name
 for side in ['L','R']:
  pivot=bpy.data.objects['WingPivot_'+side];assert pivot.rotation_quaternion.angle<1e-7,'Cruise authoring pose required'
  for name in ['Fixed_root_'+side,'Composite_wing_'+side]:
   obj=bpy.data.objects[name];assert obj.matrix_basis==Matrix.Identity(4) and not obj.modifiers
   assert not obj.get('boundedLowAngleReliefApplied'),'Suffix cannot be applied twice'
 for part in plan['parts']:
  side=part['side'];sign=-1 if side=='L'else 1;obj=bpy.data.objects['Composite_wing_'+side];knots=part['knots'];poly=[(0.,knots[0]['y'])]+[(sign*k['cutAbsX'],k['y'])for k in knots]+[(0.,knots[-1]['y'])];n=len(poly)
  verts=[(x,y,z)for z in plan['cutterZ']for x,y in poly];faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
  mesh=bpy.data.meshes.new('bounded_upper016_cutter_'+side);mesh.from_pydata(verts,[],faces);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);bm.to_mesh(mesh);bm.free();cut=bpy.data.objects.new('bounded_upper016_cutter_'+side,mesh);bpy.context.collection.objects.link(cut);bpy.context.view_layer.update();mod=obj.modifiers.new('bounded_upper016','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cut;bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True);obj['boundedUpper016Candidate']=True
  reports.append(_repair_upper_cap(obj))
 for part in data['fixedInner']['parts']:
  obj=bpy.data.objects[part['node']];by_point=collections.defaultdict(list)
  for v in obj.data.vertices:by_point[tuple(v.co)].append(v)
  changes=[]
  for record in part['vertices']:
   values=by_point[tuple(record['before'])];assert len(values)==1,'Frozen actual inner row point is missing or ambiguous';v=values[0];assert record['before'][:2]==record['after'][:2] and 0<record['after'][2]-record['before'][2]<.00010002
   v.co=record['after'];changes.append({'before':record['before'],'after':list(v.co)})
  obj.data.update();reports.append({'node':obj.name,'fixedInnerChanges':changes})
 for name in data['authorizedNodes']:bpy.data.objects[name]['boundedLowAngleReliefApplied']=True
 return {'schema':data['schema'],'parameterSha256':hashlib.sha256(raw).hexdigest(),'newGeometryRequiresAcceptance':True,'wholeMachineAccepted':False,'parts':reports}
