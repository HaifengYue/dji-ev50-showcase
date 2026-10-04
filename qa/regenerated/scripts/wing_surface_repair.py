"""有界翼面重剖分：修复 Float32 CSG 接回缝中的真实交叉与细折返。

只操作固定/活动四片翼的巡航 |X|<1.80 关联域。顶点集合整合、拓扑
link 条件、平面片归并均为构造操作，不是验收容差。最终实际网格仍
必须通过全索引精确自交、完整面保形、孔与薄壁、材料支承及扫掠门。
"""
import math
import collections
import bpy
import bmesh
from mesh_precision import face_area


def in_repair_domain(obj,point):
    x=float((obj.matrix_basis@point).x)
    if obj.parent is not None:x+=float(obj.parent.location.x)
    return abs(x)<1.80

def triangulate_patch_face(bm,f):
 vs=list(f.verts)
 if len(vs)==3:return
 normal=[0.,0.,0.]
 for a,b in zip(vs,vs[1:]+vs[:1]):
  for k in range(3):normal[k]+=(a.co[(k+1)%3]-b.co[(k+1)%3])*(a.co[(k+2)%3]+b.co[(k+2)%3])
 axis=max(range(3),key=lambda k:abs(normal[k]));ks=[k for k in range(3)if k!=axis]
 ratios=[[float(v.co[k]).as_integer_ratio()for k in ks]for v in vs];den=max(d for p in ratios for n,d in p);ps=[tuple(n*(den//d)for n,d in p)for p in ratios]
 def orient(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 area=sum(a[0]*b[1]-a[1]*b[0]for a,b in zip(ps,ps[1:]+ps[:1]));sgn=1 if area>0 else -1
 left=list(range(len(vs)));tris=[]
 while len(left)>3:
  ears=[]
  for j,q in enumerate(left):
   p,r=left[j-1],left[(j+1)%len(left)];a,b,c=ps[p],ps[q],ps[r];turn=sgn*orient(a,b,c)
   if turn<=0:continue
   if any(e.other_vert(vs[p])==vs[r] and any(of!=f for of in e.link_faces)for e in vs[p].link_edges):continue
   xmin,xmax=min(a[0],b[0],c[0]),max(a[0],b[0],c[0]);ymin,ymax=min(a[1],b[1],c[1]),max(a[1],b[1],c[1])
   if any(x not in(p,q,r) and xmin<=ps[x][0]<=xmax and ymin<=ps[x][1]<=ymax and min(sgn*orient(a,b,ps[x]),sgn*orient(b,c,ps[x]),sgn*orient(c,a,ps[x]))>=0 for x in left):continue
   ears.append((turn,j,(p,q,r)))
  if not ears:
   print('BADPOLY',f.index,[list(v.co)for v in vs],left,flush=True)
   raise ValueError('No exact constrained polygon ear: '+str(len(left))+' / '+str(len(vs)))
  _,j,tri=max(ears);tris.append(tri);left.pop(j)
 if sgn*orient(*(ps[x]for x in left))<=0:
  print('BADFINAL',f.index,[list(v.co)for v in vs],left,flush=True)
  raise ValueError('Final triangle invalid')
 tris.append(tuple(left));material=f.material_index;smooth=f.smooth
 bmesh.ops.delete(bm,geom=[f],context='FACES_ONLY')
 for tri in tris:nf=bm.faces.new([vs[i]for i in tri]);nf.material_index=material;nf.smooth=smooth

EPS=3e-7

def dot(a,b):return sum(x*y for x,y in zip(a,b))
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross(a,b):return(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def length(a):return math.sqrt(dot(a,a))
def segdist(p,a,b):
 ab=sub(b,a);den=dot(ab,ab)
 if den==0:return length(sub(p,a))
 t=dot(sub(p,a),ab)/den
 if not 0<=t<=1:return float('inf')
 return length(sub(sub(p,a),tuple(x*t for x in ab)))
def closest_distance(p,a,b,c):
 ab,ac,ap=sub(b,a),sub(c,a),sub(p,a);d1,d2=dot(ab,ap),dot(ac,ap)
 if d1<=0 and d2<=0:return length(ap)
 bp=sub(p,b);d3,d4=dot(ab,bp),dot(ac,bp)
 if d3>=0 and d4<=d3:return length(bp)
 vc=d1*d4-d3*d2
 if vc<=0 and d1>=0 and d3<=0:
  t=d1/(d1-d3);return length(sub(p,tuple(a[i]+ab[i]*t for i in range(3))))
 cp=sub(p,c);d5,d6=dot(ab,cp),dot(ac,cp)
 if d6>=0 and d5<=d6:return length(cp)
 vb=d5*d2-d1*d6
 if vb<=0 and d2>=0 and d6<=0:
  t=d2/(d2-d6);return length(sub(p,tuple(a[i]+ac[i]*t for i in range(3))))
 va=d3*d6-d5*d4
 if va<=0 and d4-d3>=0 and d5-d6>=0:
  t=(d4-d3)/((d4-d3)+(d5-d6));return length(sub(p,tuple(b[i]+(c[i]-b[i])*t for i in range(3))))
 n=cross(ab,ac);nl=length(n)
 return abs(dot(ap,n))/nl if nl else float('inf')


def simplify_slivers(bm,obj):
 records=[]
 for iteration in range(4):
  changes=0
  bm.verts.index_update();bm.faces.index_update()
  for f in list(bm.faces):
   if not f.is_valid or len(f.verts)!=3:continue
   points=[tuple(v.co)for v in f.verts];long=max(length(sub(a,b))for a in points for b in points)
   if long==0 or 2*face_area(f)/long>1e-7:continue
   if any(not in_repair_domain(obj,v.co) for v in f.verts):continue
   done=False
   for e in sorted(f.edges,key=lambda e:((e.verts[0].co-e.verts[1].co).length,e.verts[0].index,e.verts[1].index)):
    if len(e.link_faces)!=2:continue
    u,v=e.verts;nu={x.other_vert(u)for x in u.link_edges};nv={x.other_vert(v)for x in v.link_edges};opposite={x for q in e.link_faces for x in q.verts if x not in(u,v)}
    if nu&nv != opposite:continue
    for drop,keep in [(u,v),(v,u)]:
     affected=sorted(set(drop.link_faces)|set(keep.link_faces),key=lambda f:f.index)
     if any(len(q.verts)!=3 for q in affected):continue
     if any(not in_repair_domain(obj,x.co)for q in affected for x in q.verts):continue
     old=[[tuple(x.co)for x in q.verts]for q in affected];new=[];valid=True
     for q in affected:
      vs=[keep if x==drop else x for x in q.verts]
      if len(set(vs))<3:continue
      pts=[tuple(x.co)for x in vs];a=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));oldpts=[tuple(x.co)for x in q.verts];b=cross(sub(oldpts[1],oldpts[0]),sub(oldpts[2],oldpts[0]))
      if length(a)/2<=1e-18 or dot(a,b)<=0:valid=False;break
      new.append(pts)
     if not valid or not new:continue
     def samples(tris):
      out=[]
      for t in tris:
       out.extend(t)
       out.extend(tuple((a[k]+b[k])/2 for k in range(3))for a,b in zip(t,t[1:]+t[:1]))
       out.append(tuple(sum(a[k]for a in t)/3 for k in range(3)))
      return list(dict.fromkeys(out))
     deviation=0.
     for a,b in [(old,new),(new,old)]:
      for point in samples(a):
       deviation=max(deviation,min(closest_distance(point,*tri)for tri in b))
       if deviation>3e-7:break
      if deviation>3e-7:break
     if deviation>3e-7:continue
     displacement=(drop.co-keep.co).length
     bmesh.ops.pointmerge(bm,verts=[keep,drop],merge_co=keep.co.copy());records.append({'edgeLength':displacement,'patchDistanceSampleMax':deviation});changes+=1;done=True;break
    if done:break
  if not changes:break
 return records

def repair_wing_surfaces():
 reports=[]
 for name in ('Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R'):
  o=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(o.data);original_points={tuple(v.co)for v in bm.verts};original_volume=bm.calc_volume(signed=True);original_count=len(bm.verts);bmesh.ops.remove_doubles(bm,verts=[v for v in bm.verts if in_repair_domain(o,v.co)],dist=1e-7);sliver_records=simplify_slivers(bm,o);print('SLIVERS',name,len(sliver_records),flush=True);bm.verts.ensure_lookup_table();bm.verts.index_update();bm.faces.ensure_lookup_table();bm.faces.index_update();before={v:tuple(v.co)for v in bm.verts};volume=bm.calc_volume(signed=True);vol0=volume;patches=[];assigned=set();eligible={f for f in bm.faces if all(in_repair_domain(o,v.co) for v in f.verts)};areas={f:face_area(f)for f in bm.faces}
  for f in sorted(eligible,key=lambda f:(-areas[f],f.index)):
   if f in assigned:continue
   coords=[before[v]for v in f.verts];anchor=coords[0];n=cross(sub(coords[1],anchor),sub(coords[2],anchor));nl=length(n)
   if nl==0:continue
   n=tuple(v/nl for v in n);patch={f};assigned.add(f);queue=collections.deque([f]);maxdev=0
   while queue:
    a=queue.popleft()
    for e in a.edges:
     for b in e.link_faces:
      if b in assigned or b not in eligible:continue
      deviation=max(abs(dot(sub(before[v],anchor),n))for v in b.verts)
      if deviation>EPS:continue
      # Seed plane bounds geometry directly, including sub-precision CSG sliver fans.
      patch.add(b);assigned.add(b);queue.append(b);maxdev=max(maxdev,deviation)
   if len(patch)<2:continue
   boundary=[e for a in patch for e in a.edges if sum(b in patch for b in e.link_faces)==1];vs=collections.Counter(v for e in boundary for v in e.verts)
   if any(degree!=2 for degree in vs.values()):continue
   graph=collections.defaultdict(set)
   for e in boundary:a,b=e.verts;graph[a].add(b);graph[b].add(a)
   seen=set();stack=[next(iter(graph))]
   while stack:
    v=stack.pop()
    if v in seen:continue
    seen.add(v);stack.extend(graph[v]-seen)
   if len(seen)!=len(graph):continue
   patches.append((patch,maxdev))
  rows=[]
  for patch,dev in patches:
   if any(not f.is_valid for f in patch):continue
   try:r=bmesh.ops.dissolve_faces(bm,faces=sorted(patch,key=lambda f:f.index),use_verts=False)
   except Exception as e:print('DISSOLVE FAIL',str(e));continue
   rows.append({'faces':len(patch),'maximumSeedPlaneDistance':dev,'resultFaces':len(r.get('region',[]))})
  # Remove only redundant boundary vertices now exposed after planar consolidation.
  removed=[]
  for iteration in range(5):
   change=False
   for v in list(bm.verts):
    if not v.is_valid or len(v.link_edges)!=2 or len(v.link_faces)!=2:continue
    ns=[e.other_vert(v)for e in v.link_edges]
    if len(set(ns))!=2:continue
    if any(not in_repair_domain(o,x.co) for x in [v]+ns):continue
    d=segdist(tuple(v.co),tuple(ns[0].co),tuple(ns[1].co))
    if d>EPS:continue
    try:bmesh.ops.dissolve_verts(bm,verts=[v],use_face_split=False,use_boundary_tear=False)
    except Exception as e:continue
    removed.append(d);change=True
   if not change:break
  
  for f in list(bm.faces):triangulate_patch_face(bm,f)
  # 近共线末三角可能由合法保边三角化新产生。先确定并存储该真实
  # 三角拓扑，再用同一有限材料距离/link条件处理；不豁免新微壁。
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
  retained_points=set(before.values())
  bm.to_mesh(o.data);bm.free();o.data.update()
  bm=bmesh.new();bm.from_mesh(o.data)
  post_records=simplify_slivers(bm,o)
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update();report={'name':name,'originalVertexCount':original_count,'originalVolume':original_volume,'allFinalCoordinatesFromOriginal':all(tuple(v.co)in original_points for v in bm.verts),'sliverCollapseRecords':sliver_records,'postTriangulationSliverCollapseRecords':post_records,'patches':len(rows),'patchSourceFaces':sum(x['faces']for x in rows),'maximumPatchDeviation':max([x['maximumSeedPlaneDistance']for x in rows],default=0),'removedDegree2Vertices':len(removed),'maximumDegree2Deviation':max(removed,default=0),'volumeBefore':vol0,'volumeAfter':bm.calc_volume(signed=True),'bad':sum(not e.is_manifold for e in bm.edges),'zero':sum(face_area(f)<=1e-18 for f in bm.faces),'verticesBefore':len(before),'verticesAfter':len(bm.verts),'noSurvivingVertexMoved':all(tuple(v.co)in retained_points for v in bm.verts)};
  if report['bad'] or report['zero'] or report['volumeAfter']<=0 or abs(report['volumeAfter']-original_volume)>1e-8:
   raise ValueError('Bounded wing repair failed solid gate: '+name)
  reports.append(report);print('Wing surface rebuilt',name,len(bm.faces),flush=True)
  bm.to_mesh(o.data);bm.free();o.data.update()
  o.data.normals_split_custom_set([(0.,0.,0.)for _ in o.data.loops])
  o.data.set_sharp_from_angle(angle=math.radians(42));o.data.update()
 return {'parts':reports,'maximumCruiseAbsX':1.80,'patchSeedPlaneSelectionDistance':EPS,'nearVertexMergeDistance':1e-7,
         'method':'局部细折返边按流形link条件和双向有限材料距离筛选；连续近共面片按整数精确二维谓词保边重三角化，末片再按相同link和材料筛选处理',
         'acceptanceBoundary':'构造筛选不是连续几何保真证明；全索引零自交、1e-6全三角双向覆盖、真实孔/薄壁/支承与运动门另验',
         'unchangedCollisionAndAreaThresholds':True}
