"""新图V27布局候选：同轴重参数化、短轴紧凑栈、翼球点内移及实际前限位联动。"""
from pathlib import Path
import bpy,bmesh,sys,os,runpy,math,json,hashlib
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007-inset';OUT.mkdir(parents=True,exist_ok=True)
LABEL=os.environ.get('TRANSWING_INSET_LABEL','candidate-detail-inset-layout-a');os.environ['TRANSWING_DETAIL_LABEL']=LABEL
runpy.run_path(str(ROOT/'scripts/revision_20261007_detail/build_detail_candidate.py'))
scene=bpy.context.scene;scene.frame_set(99);bpy.context.preferences.filepaths.save_version=0
old_world={o.name:o.matrix_world.copy()for o in bpy.data.objects};old_p={s:bpy.data.objects['WingPivot_'+s].location.copy()for s in ['L','R']};t0=-.10414515;centers={};axis={};rebase_nodes={}
for side,sg in [('L',-1),('R',1)]:
 pivot=bpy.data.objects['WingPivot_'+side];axis[side]=Vector((-sg,-1,1)).normalized();centers[side]=old_p[side]+axis[side]*t0
 rebase_nodes[side]=[]
 for o in bpy.data.objects:
  q=o
  while q and q!=pivot:q=q.parent
  if q==pivot and o!=pivot:rebase_nodes[side].append(o)
 children=list(pivot.children);pivot.location=centers[side];bpy.context.view_layer.update()
 for o in children:o.matrix_world=old_world[o.name]
bpy.context.view_layer.update();max_error=0.;worst=None
for i in range(401):
 angle=120*i/400
 for side,sg in [('L',-1),('R',1)]:
  p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(axis[side],sg*math.radians(angle))
 bpy.context.view_layer.update()
 for side,sg in [('L',-1),('R',1)]:
  transform=Matrix.Translation(old_p[side])@Quaternion(axis[side],sg*math.radians(angle)).to_matrix().to_4x4()@Matrix.Translation(-old_p[side])
  for o in rebase_nodes[side]:
   expected=transform@old_world[o.name];err=max(abs(expected[r][c]-o.matrix_world[r][c])for r in range(4)for c in range(4))
   if err>max_error:max_error=err;worst={'node':o.name,'angle':angle,'error':err}
assert max_error<2e-6,worst
for side in ['L','R']:bpy.data.objects['WingPivot_'+side].rotation_quaternion=Quaternion((1,0,0,0))
bpy.context.view_layer.update()
rebase={'samples':401,'rangeDegrees':[0,120],'comparedDescendantNodes':{s:len(v)for s,v in rebase_nodes.items()},'maximumWorldMatrixElementError':max_error,'worst':worst,'tolerance':2e-6,'axisLineInvariant':True,'passed':True,'scope':'Before deliberately moving ball/rod/stop or replacing hardware; every original wing descendant world matrix at every sampled angle'}

def replace_profile(name,side,profile):
 obj=bpy.data.objects[name];origin=centers[side];a=axis[side];sg=-1 if side=='L'else 1;e=Vector((sg,-1,0)).normalized();f=a.cross(e).normalized();vertices=[];rings=[];faces=[];n=96;inv=obj.matrix_world.inverted();materials=list(obj.data.materials)
 for t,r in profile:
  if r==0:rings.append([len(vertices)]);vertices.append(inv@(origin+a*t));continue
  ring=[]
  for j in range(n):ring.append(len(vertices));vertices.append(inv@(origin+a*t+r*(e*math.cos(j*2*math.pi/n)+f*math.sin(j*2*math.pi/n))))
  rings.append(ring)
 for u,v in zip(rings,rings[1:]+rings[:1]):
  if len(u)==len(v)==1:continue
  for j in range(n):
   k=(j+1)%n
   if len(u)==1:faces.append((u[0],v[k],v[j]))
   elif len(v)==1:faces.append((u[j],u[k],v[0]))
   else:faces.append((u[j],u[k],v[k],v[j]))
 mesh=bpy.data.meshes.new(name+'_compact_inset');mesh.from_pydata(vertices,[],faces);mesh.update()
 for mat in materials:mesh.materials.append(mat)
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(ed.is_manifold for ed in bm.edges),name;assert bm.calc_volume(signed=True)>0,name;bm.to_mesh(mesh);bm.free();obj.data=mesh
 for poly in mesh.polygons:poly.use_smooth=True
 obj['insetLayoutRevision']='2026-10-07-v27';return {'node':name,'profileTR':profile,'parent':obj.parent.name if obj.parent else None}
def annulus(c,w,ri,ro):return[(c-w/2,ri),(c-w/2,ro),(c+w/2,ro),(c+w/2,ri)]
hardware=[]
for side in ['L','R']:
 hardware.append(replace_profile('RootHingeShaft_'+side,side,[(-.020,0),(-.020,.028),(.020,.028),(.020,0)]))
 for end,tc in [('Front',-.0093),('Rear',.0093)]:
  hardware.append(replace_profile('RootBearingFixed_'+side+'_'+end,side,annulus(tc,.003,.031,.0335)))
  hardware.append(replace_profile('RootBearingSeal_'+side+'_'+end,side,annulus(tc,.0033,.0309,.0328)))
  marker=bpy.data.objects['RootBearingCenter_'+side+'_'+end];marker.matrix_world.translation=centers[side]+axis[side]*tc
 for stem,c,w,ri,ro in [('RootBearingHousing_',.0093,.003,.0329,.0336),('RootCarrierMoving_',0,.009,.031,.035),('RootCarrierThrust_',0,.0086,.0309,.0348),('RootCarrierBridge_',-.0029,.0032,.0332,.0355),('RootFixedBearingPedestal_',.0112,.0022,.0319,.0333),('RootFairingFixed_',.0093,.0032,.0333,.0339),('RootFairingMoving_',0,.009,.0345,.0357)]:hardware.append(replace_profile(stem+side,side,annulus(c,w,ri,ro)))
 profile=[(.0104,0),(.0104,.0314),(.0136,.0314),(.0203,.0265),(.0203,0)]
 for name,sign in [('RootHingeEndcap_'+side+'-0.148',-1),('RootHingeEndcap_'+side+'0.148',1)]:hardware.append(replace_profile(name,side,[(sign*t,r)for t,r in profile]))
 for name,t in [('RootAxisStart_',-.020),('RootAxisEnd_',.020)]:bpy.data.objects[name+side].matrix_world.translation=centers[side]+axis[side]*t
record=json.loads(scene['annotatedMechanismJSON']);old_length=record['rigidRodLength'];anchors=[]
for side,sg in [('L',-1),('R',1)]:
 obj=bpy.data.objects['Composite_wing_'+side];obj.data.calc_loop_triangles();tree=BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],[tuple(t.vertices)for t in obj.data.loop_triangles],all_triangles=True);hit=tree.ray_cast(Vector((sg*1.12,-1.04,2)),Vector((0,0,-1)),4);assert hit[0]is not None and hit[1].z>.5;anchors.append(hit[0].z+.029935374855995178)
anchor=Vector((1.12,-1.04,sum(anchors)/2));new_length=(anchor-Vector(record['bodyAnchorRightCruise'])).length
for side,sg in [('L',-1),('R',1)]:
 delta=Vector((sg*anchor.x,anchor.y,anchor.z))-bpy.data.objects['BraceWing_'+side].matrix_world.translation
 for name in ['BraceWing_'+side,'BraceBall_'+side+'_Wing','BraceBallPin_'+side+'_Wing','BraceWingSeat_'+side]:
  o=bpy.data.objects[name];o.matrix_world.translation+=delta
 for obj in bpy.data.objects['BraceRod_'+side].children:
  if obj.name=='BraceRod_mesh_'+side:
   inv=obj.matrix_basis.inverted();obj.data=obj.data.copy()
   for vertex in obj.data.vertices:
    p=obj.matrix_basis@vertex.co;p.z=.034+(p.z-.034)*(new_length-.068)/(old_length-.068);vertex.co=inv@p
   obj.data.update()
  elif obj.name.endswith('_Root'):obj.location.z+=new_length-old_length
record['actualRightPivot']=list(centers['R']);record['wingAnchorRightCruise']=list(anchor);record['rigidRodLength']=new_length;record['constructionRevision']='2026-10-07-v27 inset layout';record['geometryAcceptance']=False;record['previousAdmissionNotCurrentAcceptance']=True;scene['annotatedMechanismJSON']=json.dumps(record)
sys.path.insert(0,str(ROOT/'scripts'));import kinematics
kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();kinematics.update_linkage();bpy.context.view_layer.update();travel=[kinematics.slider_at(i/4000)for i in range(4001)];slider_y=bpy.data.objects['BraceSpreader'].matrix_world.translation.y;stops=[]
for side in ['L','R']:
 bushing=bpy.data.objects['Drive_GuideBushing_'+side];offset=min((bushing.matrix_world@v.co).y for v in bushing.data.vertices)-slider_y
 stop=bpy.data.objects['Drive_FrontTravelStop_'+side];points=[stop.matrix_world@v.co for v in stop.data.vertices];old_inner=max(p.y for p in points);delta=min(travel)+offset-.004-old_inner;stop.matrix_world.translation.y+=delta
 stops.append({'node':stop.name,'translationY':delta,'newInnerFaceY':old_inner+delta,'guideBushingOffsetMin':offset,'guideStopDesignGap':.004})
record['actualTravel']={'samples':4001,'minimumY':min(travel),'maximumY':max(travel),'hoverY':travel[0],'cruiseY':travel[-1],'continuousExtremaProof':False};record['frontStopRevision']=stops;scene['annotatedMechanismJSON']=json.dumps(record);scene['insetRevision']=LABEL;scene['revisionAccepted']=False;scene['revisionNote']='新图布局灰模：同轴紧凑关节与翼球点内移，局部蒙皮/包覆尚待重构及完整材料验收，非制造设计'
bpy.context.view_layer.update();dest=ROOT/'qa/revision-20261007'/(LABEL+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(dest))
report={'candidate':LABEL,'sourceRecipe':'frozen V24 -> locked M recipe -> same-axis compact layout','outputSha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'reparameterization':rebase,'oldPivot':{s:list(v)for s,v in old_p.items()},'newPivot':{s:list(v)for s,v in centers.items()},'axisT0':t0,'hardware':hardware,'shaftDiameter':.056,'shaftLength':.040,'bearingCenterT':[-.0093,.0093],'bearingInnerDiameter':.062,'bearingOuterDiameter':.067,'wingAnchor':list(anchor),'rodLength':new_length,'travel':record['actualTravel'],'frontStops':stops,'skinReconstructionCompleted':False,'motionAndMaterialAccepted':False,'manufacturingDesignClaimed':False}
(OUT/(LABEL+'-construction.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2));print('LAYOUT',json.dumps({k:report[k]for k in ['outputSha256','newPivot','wingAnchor','rodLength','travel','frontStops']},ensure_ascii=False),flush=True)
