"""Bounded mirrored extension of the annotated two inboard controls.

The annotation points toward the wing root: its end seam grows by 50 percent.
The original straight hinge line and outer end remain fixed. Only trailing
material outside world |X|=1.83 is recut. Dimensions are visualization choices.
"""
import bpy,bmesh,math,json,hashlib,struct
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
from mesh_precision import face_area
OLD_SPAN=(1.035,2.115)
NEW_SPAN=(.495,2.115)
GAP=.007
END_GAP=.012

def gltf(v):return [float(v[0]),float(v[2]),float(-v[1])]
def mesh_object(name,vertices,faces,mat,parent=None,smooth=True):
 data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.parent=parent
 if mat:data.materials.append(mat)
 for f in data.polygons:f.use_smooth=smooth
 return o

def orient(o,triangulate=False):
 bm=bmesh.new();bm.from_mesh(o.data)
 if triangulate:bmesh.ops.triangulate(bm,faces=list(bm.faces))
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
 bm.to_mesh(o.data);bm.free();o.data.update()

def cylinder_between(name,start,end,radius,mat,parent=None,vertices=32,bevel_width=0):
 a,b=Vector(start),Vector(end);d=b-a
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=d.length,location=(a+b)/2)
 o=bpy.context.object;o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(mat);o.parent=parent
 return o

def ring_axis(name,center,axis,outer,inner,length,mat,parent=None):
 axis=Vector(axis).normalized();c=Vector(center);u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u);n=36
 vv=[tuple(c+axis*z+r*(u*math.cos(k*2*math.pi/n)+v*math.sin(k*2*math.pi/n)))for z,r in [(-length/2,outer),(length/2,outer),(-length/2,inner),(length/2,inner)]for k in range(n)];ff=[]
 for k in range(n):
  j=(k+1)%n;ff.extend([(k,j,n+j,n+k),(2*n+j,2*n+k,3*n+k,3*n+j),(j,k,2*n+k,2*n+j),(n+k,n+j,3*n+j,3*n+k)])
 return mesh_object(name,vv,ff,mat,parent)

def boolean(host,cut,operation):
 bpy.context.view_layer.update();bpy.context.view_layer.objects.active=host;mod=host.modifiers.new('Annotated control bounded material cut','BOOLEAN');mod.operation=operation;mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True);host.data.update()

def box(name,p,axes,lo,hi,parent):
 a,b,c=axes;vv=[tuple(p+a*x+b*y+c*z)for z in (lo[2],hi[2])for y in(lo[1],hi[1])for x in(lo[0],hi[0])];ff=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
 o=mesh_object(name,vv,ff,None,parent,False);orient(o);return o

def audit(o):
 bm=bmesh.new();bm.from_mesh(o.data);unseen=set(bm.verts);cc=0
 while unseen:
  cc+=1;stack=[unseen.pop()]
  while stack:
   for e in stack.pop().link_edges:
    for v in e.verts:
     if v in unseen:unseen.remove(v);stack.append(v)
 r={'vertices':len(bm.verts),'faces':len(bm.faces),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(face_area(f)<=1e-18 for f in bm.faces),'connectedComponents':cc,'signedVolume':bm.calc_volume(signed=True)};bm.free();return r

def fingerprint(o,filter_face=None):
 pts=[o.matrix_world@v.co for v in o.data.vertices];rows=[]
 for f in o.data.polygons:
  p=[pts[i]for i in f.vertices]
  if filter_face and not filter_face(p):continue
  q=[struct.pack('<3f',*v).hex()for v in p];rows.append(str(f.material_index)+':'+','.join(min(q[i:]+q[:i]for i in range(len(q)))))
 return hashlib.sha256(json.dumps(sorted(rows),separators=(',',':')).encode()).hexdigest()

def native_loft(sign,shift,material,parent):
 # Literal immutable outer-wing primitive stations in generate_transwing.py.
 # This natural subvolume contains no accepted root contour or tip geometry.
 stations=[(.48,-.49,.86,0,.115),(1.53,-.45,.83,0,.105),(2.70,-.40,.77,.01,.095)];dense=[]
 for a,b in zip(stations,stations[1:]):
  count=max(1,math.ceil(abs(b[0]-a[0])/.06))if min(abs(a[0]),abs(b[0]))<.62 else 1
  for k in range(count):dense.append(tuple(a[j]+(b[j]-a[j])*k/count for j in range(5)))
 dense.append(stations[-1]);samples=[.5*(1-math.cos(math.pi*i/28))for i in range(29)];loop=[(u,1)for u in samples]+[(u,-1)for u in reversed(samples[1:-1])];vv=[]
 for x,le,ch,z,r in dense:
  for u,sg in loop:
   t=5*r*ch*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
   vv.append(tuple(Vector((sign*x,le+u*ch,z+sg*t))+shift))
 n=len(loop);ff=[]
 for k in range(len(dense)-1):
  for j in range(n):ff.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
 ff += [tuple(range(n-1,-1,-1)),tuple((len(dense)-1)*n+j for j in range(n))]
 o=mesh_object('Temporary_natural_control_loft',vv,ff,material,parent,False);orient(o);return o

def apply():
 before={o.name:fingerprint(o)for o in bpy.data.objects if o.type=='MESH'};rows=[];changed=[];support_rows=[]
 for side,sign in [('L',-1),('R',1)]:
  key=side+'_Inboard';wing=bpy.data.objects['Composite_wing_'+side];piv=bpy.data.objects['ControlPivot_'+key];surface=bpy.data.objects['ControlSurface_'+key];start=bpy.data.objects['ControlAxisStart_'+key];end=bpy.data.objects['ControlAxisEnd_'+key];parent=piv.parent
  assert sum(abs(a)for a in piv.rotation_euler)<1e-6 and not piv.animation_data
  old0=start.location.copy();p1=end.location.copy();axis=(p1-old0).normalized();old_length=(p1-old0).length;extension=old_length*.5;p0=old0-axis*extension;length=old_length+extension
  aft=Vector((0,1,0));aft=(aft-axis*aft.dot(axis)).normalized();normal=axis.cross(aft).normalized()
  # Recover the immutable primitive coordinate frame from the existing hinge.
  t=(OLD_SPAN[0]-.48)/(1.53-.48);le=-.49+.04*t;ch=.86-.03*t
  original=Vector((sign*OLD_SPAN[0],le+.78*ch,0));shift=old0-original
  pre=audit(wing);protected=lambda p:all(abs(v.x)<1.82 for v in p);protected_before=fingerprint(wing,protected)
  oldtree=BVHTree.FromPolygons([surface.matrix_world@v.co for v in surface.data.vertices],[tuple(f.vertices)for f in surface.data.polygons])
  replacement=native_loft(sign,shift,surface.data.materials[0],parent)
  cut=box('Temporary_enlarged_control_extract',p0,(axis,aft,normal),(0,GAP,-2),(length,2,2),parent);boolean(replacement,cut,'INTERSECT');orient(replacement,True)
  # A bounded cutter overlaps only the previous empty slot at its outer end.
  cut=box('Temporary_enlarged_control_relief',p0,(axis,aft,normal),(-END_GAP,-GAP,-2),(extension+.02,2,2),parent);boolean(wing,cut,'DIFFERENCE')
  # Preserve every non-replaced rigid descendant in world coordinates when the
  # origin moves on the SAME hinge line; horn stays attached to the real skin.
  retained={o:o.matrix_world.copy()for o in piv.children if not o.name.startswith(('ControlSurface_','ControlFlexureMoving_','ControlHingeMoving_'))}
  for stem in ('ControlFlexureFixed_','ControlFlexureMoving_','ControlHingeFixed_','ControlHingeMoving_'):
   o=bpy.data.objects.get(stem+key)
   if o:bpy.data.objects.remove(o,do_unlink=True)
  piv.location=p0;start.location=p0;end.location=p1;bpy.context.view_layer.update()
  for o,world in retained.items():o.matrix_world=world
  surface.data=replacement.data;bpy.data.objects.remove(replacement,do_unlink=True)
  for v in surface.data.vertices:v.co-=p0
  surface.location=(0,0,0);surface.rotation_euler=(0,0,0);surface.scale=(1,1,1);surface.data.update();surface.data.set_sharp_from_angle(angle=math.radians(42))
  piv['controlSizeRevision']='2026-10-07 annotated span +50% toward root';piv['originalHingeLinePreserved']=True
  def flexure(moving):
   sg=1 if moving else -1;cross=[(sg*.0003,0),(sg*(GAP+.001),-.00065),(sg*(GAP+.001),.00065)];origin=Vector()if moving else p0
   vv=[tuple(origin+axis*t+aft*y+normal*z)for t in(0,length)for y,z in cross];ff=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
   ob=mesh_object(('ControlFlexureMoving_'if moving else'ControlFlexureFixed_')+key,vv,ff,surface.data.materials[0],piv if moving else parent,False);orient(ob);return ob
  flexure(True);flexure(False)
  support_rows.append({'key':key,'pivot':piv.name,'surface':surface.name,'axisStart':start.name,'axisEnd':end.name,'axis':gltf(axis),'rangeDegrees':[-12,12],'group':'inboard','sign':piv['detailSign']})
  # Compare the unchanged-span exterior with the actual original control.
  bpy.context.view_layer.update();distances=[]
  for v in surface.data.vertices:
   q=surface.matrix_world@v.co;along=(parent.matrix_world.inverted()@q-old0).dot(axis)
   if .025<along<old_length-.025:
    near=oldtree.find_nearest(q)
    if near[0]is not None:distances.append(near[3])
  assert protected_before==fingerprint(wing,protected),'Protected root faces changed'
  for o in (wing,surface):
   a=audit(o);assert not a['nonManifoldEdges']and not a['zeroAreaFaces']and a['signedVolume']>0,(o.name,a)
  row={'key':key,'oldPrimitiveSpan':list(OLD_SPAN),'newPrimitiveSpan':list(NEW_SPAN),'oldAxisStart':list(old0),'newAxisStart':list(p0),'axisEnd':list(p1),'axis':list(axis),'oldAxisLength':old_length,'newAxisLength':length,'spanRatio':length/old_length,'hingeGapEachSide':GAP,'endGap':END_GAP,'protectedRootFacesUnchanged':True,'oldSpanSurfaceMaximumDistance':max(distances or[0]),'beforeFixed':pre,'afterFixed':audit(wing),'afterSurface':audit(surface),'primitiveFrameShift':list(shift)};rows.append(row);changed += [wing.name,surface.name]
  print('ENLARGED_CONTROL',json.dumps(row),flush=True)
 from control_supports import build_control_supports
 metal=bpy.data.objects['ControlHingeFixed_L_Outboard'].data.materials[0]
 support=build_control_supports({'metal':metal,'cylinder_between':cylinder_between,'ring_axis':ring_axis,'mesh_object':mesh_object,'gltf_vector':gltf,'DETAIL_MANIFEST':{'controlSurfaces':support_rows}})
 changed += support['newNodes']+support['changedNodes']
 after={o.name:fingerprint(o)for o in bpy.data.objects if o.type=='MESH'};changed_actual=[n for n in before if before[n]!=after.get(n)]
 permitted=set(changed)|{'ControlHorn_L_Inboard','ControlHorn_R_Inboard'}
 assert all(n in permitted for n in changed_actual),set(changed_actual)-permitted
 out={'schema':'transwing.annotated-inboard-enlargement.v1','annotationInterpretation':'Red arrow extends the inboard-end seam toward wing root, about 50 percent along span','newSpanRatio':1.5,'revisedControlIds':['L_Inboard','R_Inboard'],'allIndependentControlIds':['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R'],'rows':rows,'supports':support,'changedMeshNodes':changed_actual,'allOtherMeshWorldFingerprintsUnchanged':True,'sameStraightHingeLines':True,'outboardAndTailGeometryUnchanged':True,'noFactoryConstructionClaim':True,'motionAcceptance':False}
 bpy.context.scene['annotatedControlEnlargementJSON']=json.dumps(out)
 return out
