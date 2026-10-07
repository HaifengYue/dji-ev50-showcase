"""本次双图标注候选；从锁定、可再生的方案A基线构造，不读取自身输出。"""
from pathlib import Path
import sys,os,json,hashlib,math,collections
import bpy,bmesh
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'scripts'))
BASE=ROOT/'assets/baseline-20261007/xp4.blend'
EXPECTED='1e29d4697c931545cc7b6e5d3cfa124093c9adb7dfe71a03428cda66cbd15225'
assert hashlib.sha256(BASE.read_bytes()).hexdigest()==EXPECTED
OUT=ROOT/'qa/revision-20261007';OUT.mkdir(parents=True,exist_ok=True)
from wing_surfaces import ROOT_LOFT

def station(x):
 for a,b in zip(ROOT_LOFT,ROOT_LOFT[1:]):
  if a[0]<=x<=b[0]:
   t=(x-a[0])/(b[0]-a[0]);q=tuple(v+(w-v)*t for v,w in zip(a,b));return(q[0],q[1]-1.3,q[2],q[3]-.22,q[4])
 raise ValueError(x)
def thickness(u,c,r):return 5*r*c*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
def soft_min(a,b,width=.002):
 h=max(0.,1.-abs(a-b)/width);return min(a,b)-width*h*h*.25
def grid_solid(name,side,low,high,parent=None,expanded=False):
 nx,nu=34,56;vs=[];fs=[];sg=-1 if side=='L' else 1
 for layer in [0,1]:
  for i in range(nx+1):
   xmin,xmax=(.620,1.72)if expanded else(.650,1.70);x=xmin+(xmax-xmin)*i/nx;st=station(x)
   for j in range(nu+1):
    umin,umax=(.008,.985)if expanded else(.045,.895);u=umin+(umax-umin)*j/nu;y=st[1]+u*st[2];t=thickness(u,st[2],st[4]);z=low(st[3],t)if layer==0 else high(st[3],t);vs.append((sg*x,y,z))
 n=(nx+1)*(nu+1)
 for i in range(nx):
  for j in range(nu):
   a=i*(nu+1)+j;b=a+nu+1;fs.extend([(a,a+1,b+1,b),(a+n,b+n,b+1+n,a+1+n)])
 boundary=[j for j in range(nu+1)]+[i*(nu+1)+nu for i in range(1,nx+1)]+[nx*(nu+1)+j for j in range(nu-1,-1,-1)]+[i*(nu+1)for i in range(nx-1,0,-1)]
 for a,b in zip(boundary,boundary[1:]+boundary[:1]):fs.append((a,b,b+n,a+n))
 if sg<0:fs=[f[::-1]for f in fs]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);assert bm.calc_volume(signed=True)>0;bm.to_mesh(mesh);bm.free()
 if parent:obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.location=-parent.location
 return obj

def boolean(host,cut,operation):
 bpy.context.view_layer.objects.active=host;host.select_set(True);mod=host.modifiers.new('本轮有界实体构造','BOOLEAN');mod.operation=operation;mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);host.select_set(False)
def audit(obj):
 bm=bmesh.new();bm.from_mesh(obj.data);bm.normal_update();r={'node':obj.name,'vertices':len(bm.verts),'faces':len(bm.faces),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(f.calc_area()==0 for f in bm.faces),'volume':bm.calc_volume(signed=True)};bm.free();return r

def build(label,shift,dz):
 bpy.ops.wm.open_mainfile(filepath=str(BASE));s=bpy.context.scene;s.frame_set(99)
 # Freeze the actual cruise pose before rebasing. Animation is regenerated only
 # after this candidate passes affected-material checks; old tracks are not reused.
 for o in bpy.data.objects:
  if o.animation_data:o.animation_data_clear()
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 oldp={side:bpy.data.objects['WingPivot_'+side].location.copy()for side in ['L','R']}
 source_world={o.name:o.matrix_world.copy()for o in bpy.data.objects}
 hardware_prefixes=('RootHingeShaft_','RootHingeEndcap_','RootBearingFixed_','RootBearingSeal_','RootBearingHousing_','RootCarrierMoving_','RootCarrierThrust_','RootFairingFixed_','RootFairingMoving_','RootCarrierBridge_','RootFixedBearingPedestal_')
 rows=[]
 for side,sg in [('L',-1),('R',1)]:
  p=bpy.data.objects['WingPivot_'+side];old=oldp[side];new=old+Vector((sg*shift,-shift,dz))
  children=list(p.children);p.location=new
  bpy.context.view_layer.update()
  for o in children:o.matrix_world=source_world[o.name]
  bpy.context.view_layer.update()
  for o in children:
   assert max(abs(o.matrix_world[i][j]-source_world[o.name][i][j])for i in range(4)for j in range(4))<2e-6, o.name+' cruise rebase drift'
  for o in bpy.data.objects:
   suffix=(o.name.endswith('_'+side)or('_'+side+'_')in o.name or o.name.startswith('RootHingeEndcap_'+side))
   if not suffix:continue
   if o.type=='MESH' and o.name.startswith(hardware_prefixes):
    inv=o.matrix_world.inverted();oldmat=source_world[o.name]
    o.data=o.data.copy()
    for v in o.data.vertices:v.co=inv@(new+2*(oldmat@v.co-old))
    o.data.update();o['annotationRevision']='2026-10-07';o['linearScaleRelativeToBaseline']=2.;rows.append(audit(o))
   elif o.name.startswith(('RootAxisStart_','RootAxisEnd_','RootBearingCenter_')):o.location=new+2*(source_world[o.name].translation-old)
  # 用户新图：悬停世界向机头移动前两完整动力组件；旋翼子树只平移一次。
  from nacelle_wing_layout import is_nacelle_root
  from mathutils import Quaternion
  hover=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(120))
  hover_delta=Vector((0,-.16,0));local_delta=hover.inverted()@hover_delta
  pods=[o for o in p.children if is_nacelle_root(o.name) and ('_'+side+'_Front')in o.name]
  assert len(pods)==14,(side,len(pods))
  for o in pods:o.location+=local_delta
  p['frontPodHoverWorldDelta']=list(hover_delta);p['frontPodCruiseLocalDelta']=list(local_delta)
  # Closed finite underside panel, genuinely part of the moving parent.
  floor=grid_solid('WingLowerClosure_'+side,side,lambda z,t:soft_min(z-t-.0004,z+t-.0305),lambda z,t:soft_min(z-t-.0004,z+t-.0305)+.012,p)
  for face in floor.data.polygons:face.use_smooth=abs(face.normal.z)>.5
  floor.data.materials.append(bpy.data.objects['Composite_wing_'+side].data.materials[0]);floor['annotationRevision']='2026-10-07';floor['nominalVerticalThickness']=.012
  # The central underside is reduced, never its upper skin or plan boundary.
  cut=grid_solid('TemporaryCentralUndersideCutter_'+side,side,lambda z,t:-1.,lambda z,t:z+t-.014,expanded=True)
  boolean(bpy.data.objects['Fixed_root_'+side],cut,'DIFFERENCE');bpy.data.objects.remove(cut,do_unlink=True)
  # Clearance pocket is symmetric about the true mechanical axis. It cuts
  # material, not the top-plan seam curve; support reconnection is separately checked.
  from finish_supports_paint import fill_obsolete_bore
  obsolete=fill_obsolete_bore(side,boolean);(OUT/(label+'-old-bore-closure-'+side+'.json')).write_text(json.dumps(obsolete,indent=2))
  # Reuse the frozen meridian construction, transform it around the new axis.
  # Same-owner annular attachment remains real; only the opposing moving half
  # receives the complete outer clearance. This avoids an oversized straight bore.
  from compact_hinge_enclosure import cavity_meshes,_blender_object
  for owner,names in [('fixed',['Fixed_root_'+side]),('moving',['Composite_wing_'+side,'WingLowerClosure_'+side,'Nacelle_'+side+'_Front','Pod_wing_saddle_'+side+'_Front'])]:
   for data in cavity_meshes(side,owner):
    cavity=_blender_object(data);axis=Vector((-sg,-1,1)).normalized()
    ts=[(Vector(v)-old).dot(axis)*2 for v in data['vertices']];mid=(min(ts)+max(ts))/2;span=max(ts)-min(ts)
    for vertex in cavity.data.vertices:
     q=2*(vertex.co-old);t=q.dot(axis);radial=q-axis*t
     if 'OppositeAndService' in data['name']:
      if radial.length>1e-9:radial*=1+.0015/radial.length
      t=mid+(t-mid)*(span+.003)/span
     vertex.co=new+axis*t+radial
    cavity.data.update()
    for name in names:boolean(bpy.data.objects[name],cavity,'DIFFERENCE')
    bpy.data.objects.remove(cavity,do_unlink=True)
  from finish_supports_paint import supports,paint,relieve_fixed_inner
  relief=relieve_fixed_inner(side);(OUT/(label+'-inner-relief-'+side+'.json')).write_text(json.dumps(relief,indent=2))
  from surface_supports import _contact
  try:_contact(bpy.data.objects['RootFixedBearingPedestal_'+side],bpy.data.objects['Fixed_root_'+side],'新轴位原环座有限支承')
  except ValueError:supports(side,boolean)
  paint(side,station)
  rows.extend([audit(floor),audit(bpy.data.objects['Fixed_root_'+side]),audit(bpy.data.objects['Composite_wing_'+side])])
  p['annotationRevision']='2026-10-07'
 record=json.loads(s['annotatedMechanismJSON']);old_length=record['rigidRodLength'];new_anchor_x=1.18;new_anchor_y=-1.04
 from mathutils.bvhtree import BVHTree
 surfaces=[]
 for side,sg in [('L',-1),('R',1)]:
  o=bpy.data.objects['Composite_wing_'+side];o.data.calc_loop_triangles();tree=BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[tuple(t.vertices)for t in o.data.loop_triangles],all_triangles=True)
  hit=tree.ray_cast(Vector((sg*new_anchor_x,new_anchor_y,2)),Vector((0,0,-1)),4);assert hit[0]is not None and hit[1].z>.5;surfaces.append(hit[0].z)
 new_anchor=Vector((new_anchor_x,new_anchor_y,sum(surfaces)/2+.029935374855995178));new_length=(new_anchor-Vector(record['bodyAnchorRightCruise'])).length
 for side,sg in [('L',-1),('R',1)]:
  pivot=bpy.data.objects['WingPivot_'+side];old_world=bpy.data.objects['BraceWing_'+side].matrix_world.translation;target=Vector((sg*new_anchor.x,new_anchor.y,new_anchor.z));delta=pivot.matrix_world.to_3x3().inverted()@(target-old_world)
  for name in ['BraceWing_'+side,'BraceBall_'+side+'_Wing','BraceBallPin_'+side+'_Wing','BraceWingSeat_'+side]:bpy.data.objects[name].location+=delta
  for obj in bpy.data.objects['BraceRod_'+side].children:
   if obj.name=='BraceRod_mesh_'+side:
    inv=obj.matrix_basis.inverted();obj.data=obj.data.copy()
    for vertex in obj.data.vertices:
     point=obj.matrix_basis@vertex.co;point.z=.034+(point.z-.034)*(new_length-.068)/(old_length-.068);vertex.co=inv@point
    obj.data.update()
   elif obj.name.endswith('_Root'):obj.location.z+=new_length-old_length
 record['wingAnchorRightCruise']=list(new_anchor);record['rigidRodLength']=new_length
 record['actualRightPivot']=[1.35+shift,-1.415-shift,-.2+dz];record['constructionRevision']='2026-10-07 candidate '+label;record['geometryAcceptance']=False;s['annotatedMechanismJSON']=json.dumps(record)
 import kinematics
 kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();kinematics.update_linkage()
 travel=[kinematics.slider_at(i/4000)for i in range(4001)];record['actualTravel']={'samples':4001,'minimumY':min(travel),'maximumY':max(travel),'hoverY':travel[0],'cruiseY':travel[-1],'continuousExtremaProof':False};s['annotatedMechanismJSON']=json.dumps(record)
 assert min(travel)>.971878 and max(travel)<1.900002,record['actualTravel']
 s['revisionCandidate']=label;s['revisionAccepted']=False;s['revisionNote']='双图标注候选，未通过运动与宿主接触检查；不是交付版'
 bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(label+'.blend')))
 receipt={'candidate':label,'sourceBlendSha256':EXPECTED,'baselineConstructionLockSha256':hashlib.sha256((ROOT/'CONSTRUCTION_INPUTS.json').read_bytes()).hexdigest(),'publishedParentCommit':'7dcd5cde3a650c48a164c72bd9473671ec74b641','pivotOffsetModelUnits':[shift,-shift,dz],'hardwareLinearScale':2,'axisDiameter':.056,'axisLength':.108,'floorThickness':.012,'frontPodHoverWorldDelta':[0,-.16,0],'rearPodsAdditionalLayoutDelta':[0,0,0],'rearPodsCruiseWorldPosePreserved':True,'rearPodsPivotLocalRebaseApplied':True,'rearPodsHoverTrajectoryRecomputed':True,'centralUpperSkinRetained':True,'centralTargetVerticalThickness':.014,'status':'CANDIDATE_NOT_ACCEPTED','topology':rows,'animationsRegenerated':False,'linkage':{'wingAnchorRightCruise':list(new_anchor),'rodLength':new_length,'actualTravel':record['actualTravel']},'constructionScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (OUT/(label+'-construction.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
 print('CANDIDATE',label,json.dumps(rows),flush=True)
for args in [(os.environ.get('TRANSWING_REVISION_LABEL','candidate-regenerated'),.09,.04)]:build(*args)
