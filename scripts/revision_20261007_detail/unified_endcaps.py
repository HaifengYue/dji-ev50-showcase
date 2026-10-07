"""同刚体翼腹真实合体，并从合体外表面重新生成有限前端蓝皮。"""
import bpy,bmesh,math
from mathutils import Vector
from finish_supports_paint import clip

def unify(side,boolean,station):
 sg=-1 if side=='L'else 1;wing=bpy.data.objects['Composite_wing_'+side];floor=bpy.data.objects['WingLowerClosure_'+side];before=len(wing.data.polygons)
 freeze_actual_triangles(wing)
 boolean(wing,floor,'UNION')
 bm=bmesh.new();bm.from_mesh(wing.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges), '合体必须闭合';volume=bm.calc_volume(signed=True);assert volume>0;bm.to_mesh(wing.data);bm.free();wing.data.update()
 trim_local_tips(wing,side,boolean,station)
 fix_aft_material(wing)
 name=floor.name;parent=floor.parent;matrix=floor.matrix_basis.copy();props={k:floor[k]for k in floor.keys()};bpy.data.objects.remove(floor,do_unlink=True);anchor=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(anchor);anchor.parent=parent;anchor.matrix_basis=matrix
 for k,v in props.items():anchor[k]=v
 anchor['materialMergedInto']=wing.name;anchor['notSeparateMesh']=True
 # The marked local leading patch receives exactly one coat from the actual
 # union exterior. Other original paint polygons remain on their own owner.
 sources=[bpy.data.objects['Wing_blue_leading_'+side],bpy.data.objects['WingLowerClosureBlue_'+side]]
 def inside_fields(p):return [1.03-sg*p.x,-1.66-p.y]
 def split(poly):
  inside=poly;outside=[]
  for i in range(2):
   fn=lambda p,j=i:inside_fields(p)[j]
   cut=clip(inside,fn,False)
   if cut:outside.append(cut)
   inside=clip(inside,fn,True)
   if not inside:break
  return outside,inside
 def assign(obj,polys):
  verts=[];faces=[];inv=obj.matrix_world.inverted();mats=list(obj.data.materials)
  for poly in polys:
   start=len(verts);verts.extend([inv@p for p in poly])
   for j in range(1,len(poly)-1):
    if (poly[j]-poly[0]).cross(poly[j+1]-poly[0]).length>1e-14:faces.append((start,start+j,start+j+1))
  mesh=bpy.data.meshes.new(obj.name+'_unified_local_endcoat');mesh.from_pydata(verts,[],faces);mesh.update()
  for mat in mats:mesh.materials.append(mat)
  obj.data=mesh
 for obj in sources:
  obj.data.calc_loop_triangles();kept=[]
  for tri in obj.data.loop_triangles:
   poly=[obj.matrix_world@obj.data.vertices[i].co for i in tri.vertices];outside,_=split(poly);kept.extend(outside)
  assign(obj,kept)
 # 材料直接赋给真实合体外皮，不另盖零厚重复面。
 blue=sources[0].data.materials[0]
 if blue not in list(wing.data.materials):wing.data.materials.append(blue)
 blue_index=list(wing.data.materials).index(blue)
 bm=bmesh.new();bm.from_mesh(wing.data);world=wing.matrix_world;inv=world.inverted()
 x0,x1=.62,1.03;s0,s1=station(x0),station(x1);yb0=s0[1]+.105*s0[2];yb1=s1[1]+.105*s1[2];slope=(yb1-yb0)/(x1-x0);intercept=yb1-slope*x1
 for point,normal in [(Vector((sg*1.03,0,0)),Vector((sg,0,0))),(Vector((0,intercept,0)),Vector((-sg*slope,1,0)))]:
  selected=[f for f in bm.faces if any(abs((world@v.co).x)<1.10 and (world@v.co).y<-1.65 for v in f.verts)]
  geom=list({v for f in selected for v in f.verts})+list({e for f in selected for e in f.edges})+selected
  bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-8,plane_co=inv@point,plane_no=world.to_3x3().transposed()@normal,clear_inner=False,clear_outer=False)
 painted=0
 for face in bm.faces:
  p=world@face.calc_center_median()
  if abs(p.x)<=1.030001 and p.y<=slope*abs(p.x)+intercept+1e-7:face.material_index=blue_index;painted+=1
  if .60<abs(p.x)<1.05 and ((-1.83<p.y<-1.64)or(-1.10<p.y<-.89)) and abs(face.normal.z)>.5:face.smooth=True
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges),'材质精确分界不能打开蒙皮';bm.to_mesh(wing.data);bm.free();wing.data.update();final_triangulation=finalize_actual_triangles(wing);patch=[None]*painted

 return {'side':side,'mergedInto':wing.name,'oldSeparateLowerPanelReplacedBySemanticEmpty':name,'unionPolygonsBefore':before,'unionPolygonsAfter':len(wing.data.polygons),'preTipCutUnionVolume':volume,'singlePatchPaintFaces':len(patch),'localLeadingPatchBounds':{'absXMax':1.03,'yMax':-1.66,'paintChordMax':.105},'newEndColor':{'method':'material_index on actual closed union after exact plane split','additionalOffset':0},'originalPaintOutsidePatchPreserved':True,'finalTriangulation':final_triangulation,'aftMaterialRepair':{'windowAbsX':[.60,.80],'windowY':[-1.055,-.955],'wholeLayerBaseDown':.0022,'actualFixedLowerSkinTargetGap':.0040,'additionalLowerMaterial':.005}}


def trim_local_tips(wing,side,boolean,station):
 sg=-1 if side=='L'else 1
 def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)
 for name,ya,yb,fn in [('front',-1.90,-1.73,lambda y:.70+.065*(1-smooth((y+1.79)/.06))),('rear',-1.055,-.89,lambda y:.65+.023*smooth((y+1.055)/.055))]:
  vertices=[];faces=[];n=48
  for j in range(n+1):
   y=ya+(yb-ya)*j/n;x=fn(y)
   vertices.extend([(sg*(-.2),y,-1),(sg*x,y,-1),(sg*x,y,1),(sg*(-.2),y,1)])
  for j in range(n):
   for k in range(4):a=j*4+k;b=j*4+(k+1)%4;faces.append((a,b,b+4,a+4))
  faces.extend([(3,2,1,0),(4*n,4*n+1,4*n+2,4*n+3)])
  mesh=bpy.data.meshes.new('TemporaryLocalTipCutter');mesh.from_pydata(vertices,[],faces);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new('TemporaryLocalTipCutter',mesh);bpy.context.collection.objects.link(obj);boolean(wing,obj,'DIFFERENCE');bpy.data.objects.remove(obj,do_unlink=True)
 bm=bmesh.new();bm.from_mesh(wing.data);world=wing.matrix_world;inv=world.inverted()
 original={v:world@v.co for v in bm.verts}
 def weight(p):
  x=abs(p.x)
  front=smooth((p.y+1.83)/.018)*smooth((-1.64-p.y)/.035)
  rear=smooth((p.y+1.10)/.030)*smooth((-.965-p.y)/.015)
  return smooth((x-.60)/.020)*max(front*smooth((1.03-x)/.15),rear*smooth((.90-x)/.10))
 selected=[v for v in bm.verts if weight(original[v])>0]
 for iteration in range(8):
  updates={}
  for v in selected:
   p=world@v.co;neighbors=[world@e.other_vert(v).co for e in v.link_edges if abs((world@e.other_vert(v).co).z-p.z)<.006]
   if len(neighbors)<2:continue
   mean=sum(neighbors,Vector())/len(neighbors);q=p+(mean-p)*(.20*weight(original[v]));delta=q-original[v];xy=Vector((delta.x,delta.y,0))
   if xy.length>.006:xy*=.006/xy.length
   delta=Vector((0,0,max(-.0018,min(.0018,delta.z))));updates[v]=inv@(original[v]+delta)
  for v,q in updates.items():v.co=q
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges),'局部真实顶点圆顺后仍须闭合';bm.to_mesh(wing.data);bm.free();wing.data.update()


def freeze_actual_triangles(obj):
 old=obj.data;old.calc_loop_triangles();mats=list(old.materials);normals=[n.vector.copy()for n in old.corner_normals];rows=[(tuple(t.vertices),old.polygons[t.polygon_index].material_index,old.polygons[t.polygon_index].use_smooth,tuple(t.loops))for t in old.loop_triangles]
 mesh=bpy.data.meshes.new(old.name+'_actual_triangle_surface');mesh.from_pydata([v.co.copy()for v in old.vertices],[],[r[0]for r in rows]);mesh.update()
 for mat in mats:mesh.materials.append(mat)
 for poly,row in zip(mesh.polygons,rows):poly.material_index=row[1];poly.use_smooth=row[2]
 if old.has_custom_normals:mesh.normals_split_custom_set([normals[i]for row in rows for i in row[3]])
 obj.data=mesh

def fix_aft_material(wing):
 from mathutils.bvhtree import BVHTree
 def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)
 wing.data.calc_loop_triangles();world=wing.matrix_world;inv=world.inverted();tree=BVHTree.FromPolygons([world@v.co for v in wing.data.vertices],[tuple(t.vertices)for t in wing.data.loop_triangles],all_triangles=True)
 fixed=bpy.data.objects['Fixed_root_'+wing.name[-1]];fixed.data.calc_loop_triangles();fixed_tree=BVHTree.FromPolygons([fixed.matrix_world@v.co for v in fixed.data.vertices],[tuple(t.vertices)for t in fixed.data.loop_triangles],all_triangles=True)
 for vertex in wing.data.vertices:
  p=world@vertex.co;x=abs(p.x);w=smooth((x-.60)/.04)*smooth((.80-x)/.05)*smooth((p.y+1.055)/.025)*smooth((-.955-p.y)/.020)
  if w<=0:continue
  low=tree.ray_cast(Vector((p.x,p.y,-2)),Vector((0,0,1)),4)[0]
  lower=low is not None and abs(p.z-low.z)<2e-5
  top=tree.ray_cast(Vector((p.x,p.y,2)),Vector((0,0,-1)),4)[0];fixed_low=fixed_tree.ray_cast(Vector((p.x,p.y,-2)),Vector((0,0,1)),4)[0]
  required=.0022
  if top is not None and fixed_low is not None and -.020<fixed_low.z-top.z<.01:required=max(required,.0040-(fixed_low.z-top.z))
  p.z-=w*(required+(.005 if lower else 0));vertex.co=inv@p
 wing.data.update()


def finalize_actual_triangles(obj):
 from mesh_precision import face_area
 source=bmesh.new();source.from_mesh(obj.data);chosen=None
 for quad,ngon in [('BEAUTY','EAR_CLIP'),('ALTERNATE','EAR_CLIP'),('SHORT_EDGE','EAR_CLIP'),('BEAUTY','BEAUTY'),('FIXED','EAR_CLIP')]:
  trial=source.copy();bmesh.ops.triangulate(trial,faces=list(trial.faces),quad_method=quad,ngon_method=ngon)
  bad=sum(not e.is_manifold for e in trial.edges);zero=sum(face_area(f)<=1e-18 for f in trial.faces)
  if bad==0 and zero==0:chosen=trial;method=[quad,ngon];break
  trial.free()
 source.free()
 if chosen is None:raise ValueError('完整合体未找到无退化且闭合的真实三角剖分')
 bmesh.ops.recalc_face_normals(chosen,faces=list(chosen.faces));volume=chosen.calc_volume(signed=True);assert volume>0;chosen.to_mesh(obj.data);chosen.free();obj.data.update()
 return {'method':method,'allFacesExplicitTriangles':all(len(f.vertices)==3 for f in obj.data.polygons),'nonManifoldEdges':0,'zeroAreaFacesFloat64Threshold':1e-18,'zeroAreaFaces':0,'signedVolume':volume,'purpose':'Prevent exporter choosing a collinear ear at a material boundary; no tolerance relaxation or face deletion'}
