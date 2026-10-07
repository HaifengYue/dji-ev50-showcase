"""Flat natural underside rear-root material replacement. Call in cruise; no global rig edits.

The pathological rear subvolume is removed, then one continuous parametric
solid blending natural loft and lower closure is joined back as closed material. Endpoint
rounding is a sampled tangent circular arc, not a shading-only repair.
"""
from pathlib import Path
import math,json,struct,functools
import bpy,bmesh
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
from wing_surfaces import ROOT_LOFT
from annotated_root_interface import reference_curve,upper_gap

def _smooth(t):
 t=max(0.,min(1.,t));return t*t*(3-2*t)
def _station(x):
 for a,b in zip(ROOT_LOFT,ROOT_LOFT[1:]):
  if a[0]<=x<=b[0]:
   f=(x-a[0])/(b[0]-a[0]);s=tuple(v+(w-v)*f for v,w in zip(a,b));return(s[0],s[1]-1.3,s[2],s[3]-.22,s[4])
 raise ValueError('Rear patch outside original root loft: '+str(x))
def _skin(x,u):
 s=_station(x);t=5*s[4]*s[2]*(.2969*math.sqrt(max(0,u))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);return s[1]+u*s[2],s[3]-t,s[3]+t

def _mesh(name,verts,faces,material=None):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
 if material is not None:me.materials.append(material)
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));
 if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
 bm.to_mesh(me);bm.free();me.update();return ob

def _boolean(host,cut,operation):
 bpy.context.view_layer.update();bpy.context.view_layer.objects.active=host;mod=host.modifiers.new('Bounded rear material reconstruction','BOOLEAN');mod.operation=operation;mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name)
 bm=bmesh.new();bm.from_mesh(host.data)
 # Exact Boolean trailing-edge intersections can have two identities at the
 # same stored XYZ. Weld exact coincidence only in this authoring domain;
 # this removes collapsed duplicate-edge faces with zero geometric movement.
 seen={};targets={}
 for v in bm.verts:
  p=host.matrix_world@v.co
  if .639<abs(p.x)<1.026 and p.y>-1.131:
   key=tuple(v.co)
   if key in seen:targets[v]=seen[key]
   else:seen[key]=v
 if targets:bmesh.ops.weld_verts(bm,targetmap=targets)
 bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(host.data);bm.free();host.data.update()
 print('REAR_BOOLEAN',host.name,cut.name,operation,_audit(host),flush=True)

def _tree(o):
 o.data.calc_loop_triangles();return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[tuple(t.vertices)for t in o.data.loop_triangles],all_triangles=True)

def _prism(name,poly,zlo=-1.,zhi=1.,side=1):
 n=len(poly);v=[(side*x,y,z)for z in[zlo,zhi]for x,y in poly];f=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)];return _mesh(name,v,f)

def _grid(name,side,umin,umax,heights,mat,nx=56,nu=88,xmin=.640,xmax=1.025):
 xs=sorted(set([xmin+(xmax-xmin)*i/nx for i in range(nx+1)]+[.850,1.000]+[.675+.0025*i for i in range(31)]));nx=len(xs)-1;v=[];f=[]
 for layer in [0,1]:
  for x in xs:
   local_umax=umax+.006*_smooth((x-.850)/.150) if abs(umax-.994)<1e-10 else umax
   for j in range(nu+1):
    u=umin+(local_umax-umin)*j/nu
    y,lo,hi=_skin(x,u);zl,zh=heights(x,u,y,lo,hi);v.append((side*x,y,zl if layer==0 else zh))
 n=(nx+1)*(nu+1)
 for i in range(nx):
  for j in range(nu):
   a=i*(nu+1)+j;b=a+nu+1;f.extend([(a,a+1,b+1,b),(a+n,b+n,b+1+n,a+1+n)])
 edge=[j for j in range(nu+1)]+[i*(nu+1)+nu for i in range(1,nx+1)]+[nx*(nu+1)+j for j in range(nu-1,-1,-1)]+[i*(nu+1)for i in range(nx-1,0,-1)]
 f.extend((a,b,b+n,a+n)for a,b in zip(edge,edge[1:]+edge[:1]))
 # Natural zero-thickness trailing-edge vertices share one physical identity.
 # Only generated collapsed cap faces are omitted; no source face is deleted here.
 unique={};vv=[];mapping={}
 for i,p in enumerate(v):
  q=struct.unpack('<3f',struct.pack('<3f',*p))
  if q not in unique:unique[q]=len(vv);vv.append(q)
  mapping[i]=unique[q]
 ff=[]
 for face in f:
  ids=[]
  for j in face:
   if not ids or ids[-1]!=mapping[j]:ids.append(mapping[j])
  if len(ids)>1 and ids[0]==ids[-1]:ids.pop()
  if len(set(ids))>=3:ff.append(tuple(ids))
 return _mesh(name,vv,ff,mat)

def _inner_cut(side,kind):
 # Circle tangent to the original trailing-edge line in this span station.
 xc=.76395;radius=.060;s0=_station(.70);s1=_station(.80);slope=((s1[1]+.994*s1[2])-(s0[1]+.994*s0[2]))/.10;te=lambda x:s0[1]+.994*s0[2]+slope*(x-.70);yc=te(xc)-radius*math.sqrt(1+slope*slope);ang0=3.80;angt=math.atan2(1.,-slope)
 arc=[(xc+radius*math.cos(ang0+(angt-ang0)*i/64),yc+radius*math.sin(ang0+(angt-ang0)*i/64))for i in range(65)];xe,ye=arc[0];y0=-1.115;x0=(reference_curve(y0)+upper_gap(y0))if kind=='upper'else .650
 h=.00005;d0=((reference_curve(y0+h)+upper_gap(y0+h))-(reference_curve(y0-h)+upper_gap(y0-h)))/(2*h)if kind=='upper'else 0.;d1=-math.tan(ang0);border=[]
 for i in range(49):
  q=i/48;y=y0+(ye-y0)*q;x=(2*q**3-3*q*q+1)*x0+(q**3-2*q*q+q)*(ye-y0)*d0+(-2*q**3+3*q*q)*xe+(q**3-q*q)*(ye-y0)*d1;border.append((x,y))
 border+=arc[1:];last=border[-1];poly=[(-.5,y0),*border,(last[0],-.80),(-.5,-.80)];return _prism('RearRootTemporary_'+kind,poly,side=side),{'kind':kind,'curve':border,'circleCenter':[xc,yc],'radius':radius,'trailingTangentPoint':list(last)}

def _audit(o):
 bm=bmesh.new();bm.from_mesh(o.data);bad=sum(not e.is_manifold for e in bm.edges);unseen=set(bm.verts);cc=0
 while unseen:
  cc+=1;stack=[unseen.pop()]
  while stack:
   v=stack.pop()
   for e in v.link_edges:
    w=e.other_vert(v)
    if w in unseen:unseen.remove(w);stack.append(w)
 vol=bm.calc_volume(signed=True);
 from mesh_precision import face_area
 zero=sum(face_area(f)<=1e-18 for f in bm.faces);bm.free();return {'vertices':len(o.data.vertices),'faces':len(o.data.polygons),'nonManifoldEdges':bad,'connectedComponents':cc,'signedVolume':vol,'zeroAreaFaces':zero}

def _rebuild_rear_corner_impl(wing,side=None,*,fixed=None,report_path=None,lower_drop=0.0):
 """Replace only the current rear-root subvolume; preserve rig and other objects.

 wing: actual Composite_wing mesh object in cruise (not the semantic EMPTY).
 side: 'L'/'R', inferred from name if absent. fixed may be the same-side fixed
 root, used to keep the new lower-closure top below its actual underside.
 Returns construction receipt. This is not final wall/motion acceptance.
 """
 if isinstance(wing,str):wing=bpy.data.objects[wing]
 side=side or wing.name[-1];sg=-1 if side=='L'else 1
 if wing.type!='MESH':raise ValueError('Actual wing mesh required')
 if wing.parent and wing.parent.rotation_quaternion.angle>1e-6:raise ValueError('Rear reconstruction requires cruise pose')
 fixed=fixed or bpy.data.objects.get('Fixed_root_'+side);ft=_tree(fixed)if fixed else None;mat=wing.data.materials[0];before=_audit(wing)
 if before['nonManifoldEdges']or before['connectedComponents']!=1 or before['signedVolume']<=0:raise ValueError('Input wing must be one closed positive-volume component')
 if lower_drop!=0.0:raise ValueError('Flat reconstruction forbids an added lower drop')
 transform=wing.matrix_world.copy();source_vertices=[transform@v.co for v in wing.data.vertices]
 # Preserve original source world position; all temporary solids are world-space.
 profile_limits=[]
 def natural_lower(x,y):
  st=_station(x);u=(y-st[1])/st[2];Y,lo,hi=_skin(x,u)
  factor=max(_smooth((x-.995)/.030),1-_smooth((y+1.125)/.010),1-_smooth((u-.930)/.025))
  return lo+min(.00015*factor,max(0.,(hi-lo)*.10))
 def natural_normal(x,y):
  h=1e-5;dx=(natural_lower(x+h,y)-natural_lower(x-h,y))/(2*h);dy=(natural_lower(x,y+h)-natural_lower(x,y-h))/(2*h)
  return Vector((-dx,-dy,1)).normalized()
 def offset_upper(x,y,th=.0102):
  # Invert the XY part of the genuine normal offset of the smooth lower
  # airfoil; unlike a vertical skin difference, this reserves normal wall.
  px,py=x,y
  for _ in range(5):
   n=natural_normal(px,py);px=x-th*n.x;py=y-th*n.y
  n=natural_normal(px,py);return natural_lower(px,py)+th*n.z
 @functools.lru_cache(None)
 def merged_profile(x,u,y,lo,hi):
  bottom=natural_lower(x,y)
  # Numerical overlap inset is on the upper surface only and confined to
  # overlap with the unremoved original solid; no additional lower bulge.
  seam=.00015*max(_smooth((x-.995)/.030),1-_smooth((y+1.125)/.010))
  natural_top=hi-min(seam,max(0.,(hi-lo)*.10))
  required_top=min(natural_top,offset_upper(x,y))
  bound=reference_curve(y)+upper_gap(y)
  alpha=_smooth((x-(bound+.015))/.050)
  top=required_top+(natural_top-required_top)*alpha
  if ft is not None:
   h=ft.ray_cast(Vector((sg*x,y,-1)),Vector((0,0,1)),3)
   if h[0] is not None and h[1].z<-.55:
    cap=h[0].z-.00308
    if required_top>cap:profile_limits.append({'x':x,'y':y,'u':u,'normalOffsetTargetZ':required_top,'staticFixedGapCapZ':cap,'targetMarginConflict':required_top-cap})
    # The full rectangular stock includes material later wholly removed by
    # the rounded inner cutter. Do not invert that temporary stock volume.
    if cap>bottom:top=min(top,cap)
  return bottom,top
 upper=_grid('RearUnifiedReplacement_'+side,sg,.775,.994,merged_profile,mat)
 cutter,curve=_inner_cut(sg,'lower');_boolean(upper,cutter,'DIFFERENCE');bpy.data.objects.remove(cutter,do_unlink=True);curves=[curve]
 # Positive overlap lies outside the deleted core. The changed material is
 # bounded to original root station x<=1.025 and aft of about u=.775.
 delete=_prism('RearOldPathologyRemoval',[(-.2,-1.115),(1.000,-1.115),(1.000,-.80),(-.2,-.80)],side=sg)
 _boolean(wing,delete,'DIFFERENCE');bpy.data.objects.remove(delete,do_unlink=True)
 _boolean(wing,upper,'UNION');bpy.data.objects.remove(upper,do_unlink=True)
 # Triangulate current real material; no hidden duplicate outer skins.
 bm=bmesh.new();bm.from_mesh(wing.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP')
 for f in bm.faces:
  p=transform@f.calc_center_median()
  if .64<abs(p.x)<1.026 and p.y>-1.13:f.smooth=abs(f.normal.z)>.35
 bm.to_mesh(wing.data);bm.free();wing.data.update();after=_audit(wing)
 if after.get('zeroAreaFaces',0)or after['nonManifoldEdges']or after['connectedComponents']!=1 or after['signedVolume']<=0:raise ValueError('Rear reconstructed body is not one closed positive-volume component: '+str(after))
 tree=_tree(wing);removed=[]
 for p in source_vertices:
  if abs(p.x)<1.026 and p.y>-1.13:
   h,n,i,d=tree.find_nearest(p)
   if d>2e-6:removed.append({'before':list(p),'nearestAfter':list(h),'sampledSurfaceDistance':d})
 receipt={'side':side,'before':before,'after':after,'actualConstructionScope':{'gridAbsX':[.640,1.025],'unifiedGridChordU':[.775,1.0],'trailingUInner':.994,'trailingOuterRecoveryAbsX':[.850,1.000],'naturalLowerSkinRebuilt':True,'additionalOutwardLowerDrop':False,'featherPolicy':'Original V25 natural feather restored; M artificial lower thickening is not preserved','maximumAdditionalLowerDrop':0.0,'authorizedAdditionalInnerCornerCenterDeltaX':.00395,'originalCornerCenterX':.760,'normalWallOffsetTarget':.0102,'staticFixedGapCap':.00308,'offsetTargetMarginConflictSamples':profile_limits,'deletedCoreAbsXMax':1.0,'deletedCoreYMin':-1.115},'rounding':curves,'sourceVertexDistanceScreenMaximum':max([r['sampledSurfaceDistance']for r in removed]or[0]),'largestSourceVertexDistanceWitnesses':sorted(removed,key=lambda r:r['sampledSurfaceDistance'],reverse=True)[:20],'transformsPreserved':wing.matrix_world==transform,'claimBoundary':'Natural lower surface, inward numerical overlap inset only, .0102 normal-offset primary-wall target, and authorized .00395u inner circle-center retreat. Original V25 natural feather is retained as the reference. Source-vertex distances are finite diagnostics, not global bounds. Current integration requires wall/gap/motion checks.'}
 if report_path:Path(report_path).write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
 return receipt


def rebuild_rear_corner_flat(wing,side=None,*,fixed=None,report_path=None,lower_drop=0.0):
 """Transactional public entry; restores the source mesh if construction fails.

 Call at cruise: rebuild_rear_corner_flat(bpy.data.objects['Composite_wing_R'], 'R').
 The active saved file is never written by this function. Caller owns saving.
 """
 if isinstance(wing,str):wing=bpy.data.objects[wing]
 old=wing.data;working=old.copy();wing.data=working;objects_before=set(bpy.data.objects)
 try:
  result=_rebuild_rear_corner_impl(wing,side,fixed=fixed,report_path=report_path,lower_drop=lower_drop)
 except Exception:
  wing.data=old
  for obj in list(bpy.data.objects):
   if obj not in objects_before and obj.name.startswith(('RearRootTemporary_','RearUnifiedReplacement_','RearOldPathologyRemoval')):bpy.data.objects.remove(obj,do_unlink=True)
  if working.users==0:bpy.data.meshes.remove(working)
  raise
 if old.users==0:bpy.data.meshes.remove(old)
 if working.users==0:bpy.data.meshes.remove(working)
 return result
