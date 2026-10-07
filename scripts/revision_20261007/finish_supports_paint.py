"""本轮改变宿主后的实体支承与底部涂层重接；不修改冻结构造输入。"""
import bpy,bmesh,math
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree

def capsule(name,start,end,radius):
 bm=bmesh.new();seed=bmesh.new();bmesh.ops.create_icosphere(seed,subdivisions=2,radius=radius);points=[v.co.copy()for v in seed.verts];seed.free()
 for endpt in [start,end]:
  for point in points:bm.verts.new(point+endpt)
 bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
 bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges)
 mesh=bpy.data.meshes.new(name);bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);return obj

def tree(obj):
 obj.data.calc_loop_triangles();return BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],[tuple(t.vertices)for t in obj.data.loop_triangles],all_triangles=True)

def supports(side,boolean):
 sg=-1 if side=='L'else 1;pivot=bpy.data.objects['WingPivot_'+side];origin=pivot.location.copy();axis=Vector((-sg,-1,1)).normalized();host=bpy.data.objects['Fixed_root_'+side];ht=tree(host);seat=bpy.data.objects['RootFixedBearingPedestal_'+side];rows=[]
 for k,dy in enumerate([-.018,.018]):
  x,y=sg*1.30,-1.48+dy;hit=ht.ray_cast(Vector((x,y,2)),Vector((0,0,-1)),4);assert hit[0]is not None
  end=hit[0]-Vector((0,0,.006));radial=end-origin-axis*(end-origin).dot(axis);radial.normalize();start=origin-axis*.014+radial*.058
  leg=capsule('TemporaryFixedHingeStrut_'+side+str(k),start,end,.0065);boolean(seat,leg,'UNION');bpy.data.objects.remove(leg,do_unlink=True);rows.append({'from':list(start),'to':list(end),'radius':.0065})
 seat['newFixedHostStruts']=True;return rows

def clip(poly,func,keep=True):
 out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  va,vb=func(a),func(b);ia=va>=0 if keep else va<=0;ib=vb>=0 if keep else vb<=0
  if ia:out.append(a.copy())
  if ia!=ib:
   lo,hi=a.copy(),b.copy();vl=va
   for _ in range(40):
    mid=(lo+hi)/2;vm=func(mid)
    if (vm>=0)==(vl>=0):lo=mid;vl=vm
    else:hi=mid
   out.append((lo+hi)/2)
 clean=[]
 for p in out:
  if not clean or (p-clean[-1]).length>1e-10:clean.append(p)
 if len(clean)>1 and (clean[-1]-clean[0]).length<1e-10:clean.pop()
 return clean if len(clean)>=3 else []

def paint(side,station):
 sg=-1 if side=='L'else 1;obj=bpy.data.objects['Fixed_root_blue_'+side];floor=bpy.data.objects['WingLowerClosure_'+side];host=bpy.data.objects['Fixed_root_'+side];ft,ht=tree(floor),tree(host);mats=list(obj.data.materials);obj.data.calc_loop_triangles();fixed=[];moving=[]
 def boundary(p):
  st=station(abs(p.x));return p.y-(st[1]+.045*st[2])
 for tri in obj.data.loop_triangles:
  poly=[obj.matrix_world@obj.data.vertices[i].co for i in tri.vertices];n=(poly[1]-poly[0]).cross(poly[2]-poly[0])
  if n.z>=0:fixed.append((poly,False));continue
  conditions=[lambda p:sg*p.x-.650,boundary];inside=poly
  for fn in conditions:
   outside=clip(inside,fn,False)
   if outside:fixed.append((outside,True))
   inside=clip(inside,fn,True)
   if not inside:break
  if inside:moving.append((inside,True))
 def make(name,rows,moving_owner):
  verts=[];faces=[];miss=0
  for poly,lower in rows:
   pts=[]
   for p in poly:
    p=p.copy()
    if lower and abs(p.x)>=.620-1e-7:
     hit=(ft if moving_owner else ht).ray_cast(Vector((p.x,p.y,-2)),Vector((0,0,1)),4)
     if hit[0]is not None:p.z=hit[0].z-.0004
     elif moving_owner:
      st=station(abs(p.x));u=(p.y-st[1])/st[2];t=5*st[4]*st[2]*(.2969*math.sqrt(max(0,u))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);z=min(st[3]-t-.0004,st[3]+t-.0305)
      nearest=ft.find_nearest(Vector((p.x,p.y,z)))
      if nearest[0]is None or math.hypot(nearest[0].x-p.x,nearest[0].y-p.y)>.0008:raise ValueError('New moving coating lost its actual panel host: '+str(list(p)))
      p=nearest[0].copy();p.z-=.0004
     else:miss+=1
    pts.append(p)
   start=len(verts);verts.extend(pts)
   for j in range(1,len(pts)-1):
    if (pts[j]-pts[0]).cross(pts[j+1]-pts[0]).length>1e-14:faces.append((start,start+j,start+j+1))
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
  for mat in mats:mesh.materials.append(mat)
  return mesh,miss
 fixed_mesh,miss=make(obj.name+'_revision',fixed,False);obj.data=fixed_mesh
 mesh,_=make('WingLowerClosureBlue_'+side,moving,True);new=bpy.data.objects.new('WingLowerClosureBlue_'+side,mesh);bpy.context.collection.objects.link(new);new.parent=floor.parent;new.location=-floor.parent.location;new['coatingHost']='WingLowerClosure_'+side;new['coatingOffset']=.0004
 return {'transferredPolygons':len(moving),'retainedPolygons':len(fixed),'fixedProjectionOutsideCurrentHostVertices':miss,'offset':.0004}

def relieve_fixed_inner(side):
 """仅抬升新移轴导致接近的中央翼内侧底面；外上皮逐点不动。"""
 obj=bpy.data.objects['Fixed_root_'+side];host=tree(obj);world=obj.matrix_world.copy();inv=world.inverted();rows=[]
 def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)
 for v in obj.data.vertices:
  p=world@v.co;x=abs(p.x);y=p.y
  weight=smooth((x-.94)/.025)*smooth((1.32-x)/.025)*smooth((y+1.28)/.012)*smooth((-1.225-y)/.012)
  if not weight:continue
  hit=host.ray_cast(Vector((p.x,p.y,2)),Vector((0,0,-1)),4)
  if hit[0]is None or hit[1].z<.8:continue
  depth=hit[0].z-p.z
  if not .0109<depth<.030:continue
  limit=hit[0].z-.0108/hit[1].z;target=min(p.z+.0007*weight,limit)
  if target<=p.z:continue
  q=p.copy();q.z=target;v.co=inv@q;rows.append({'vertex':v.index,'before':list(p),'after':list(q),'outerSurface':list(hit[0]),'remainingNormalPlaneWall':(hit[0].z-q.z)*hit[1].z})
 obj.data.update();obj['newLowAngleInnerRelief']=True
 return {'node':obj.name,'changedVertices':rows,'maximumLift':max([r['after'][2]-r['before'][2]for r in rows]or[0]),'minimumMeasuredNormalPlaneWall':min([r['remainingNormalPlaneWall']for r in rows]or[1]),'outerTopVerticesUnchanged':True,'mainWallFloor':.0108,'independentFullGeometryAndMotionRecheckRequired':True}

def fill_obsolete_bore(side,boolean):
 """在旧轴位置重建有限上蒙皮；新轴孔随后按真实轮廓重新切出。"""
 sg=-1 if side=='L'else 1;host=bpy.data.objects['Fixed_root_'+side];ht=tree(host);cx,cy=1.35,-1.415;radius=.052;nr,ns=5,64;points=[];faces=[]
 def top(x,y):
  hits=[ht.ray_cast(Vector((sg*xx,y,2)),Vector((0,0,-1)),4)[0]for xx in [1.20,1.25]]
  if any(h is None for h in hits):raise ValueError('旧孔补皮缺少相邻实际上表面见证')
  return hits[0].z+(x-1.20)/.05*(hits[1].z-hits[0].z)-.00012
 for layer in [0,1]:
  points.append((sg*cx,cy,top(cx,cy)-(.014 if layer==0 else 0)))
  for i in range(1,nr+1):
   for j in range(ns):
    x=cx+radius*i/nr*math.cos(j*2*math.pi/ns);y=cy+radius*i/nr*math.sin(j*2*math.pi/ns);points.append((sg*x,y,top(x,y)-(.014 if layer==0 else 0)))
 count=1+nr*ns
 for layer in [0,1]:
  offset=layer*count
  for j in range(ns):faces.append((offset,offset+1+j,offset+1+(j+1)%ns))
  for i in range(nr-1):
   for j in range(ns):
    a=offset+1+i*ns+j;b=offset+1+i*ns+(j+1)%ns;faces.append((a,b,b+ns,a+ns))
 start=1+(nr-1)*ns
 for j in range(ns):a=start+j;b=start+(j+1)%ns;faces.append((a,b,b+count,a+count))
 me=bpy.data.meshes.new('OldAxisUpperSkinPatch_'+side);me.from_pydata(points,[],faces);me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);bm.to_mesh(me);bm.free();obj=bpy.data.objects.new('TemporaryOldAxisUpperSkin_'+side,me);bpy.context.collection.objects.link(obj)
 boolean(host,obj,'UNION');bpy.data.objects.remove(obj,do_unlink=True)
 return {'oldAxisXY':[sg*cx,cy],'radius':radius,'verticalThickness':.014,'actualNeighborSkinFitX':[1.20,1.25],'outerSkinInset':.00012,'newAxisCavityAppliedAfterPatch':True}
