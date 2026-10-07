"""最新三处标注的集成候选。默认从冻结基线完整构造；可验证复用已生成中间阶段。"""
from pathlib import Path
import bpy,bmesh,os,sys,runpy,json,hashlib,math
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).parent;OUT=ROOT/'qa/revision-20261007-inset';LABEL=os.environ.get('TRANSWING_INTEGRATED_LABEL','candidate-inset-integrated-b');sys.path[:0]=[str(HERE),str(ROOT/'scripts')]
LOCKS={'rebuild_rear_corner_flat.py':'6cdc7976778b8b31b66a4ced2fdd5b343027a5f1570be694176bdc46ced22515','connect_moving_bridge.py':'48a461e291fe32e6ac9d658d588893a6b33a843dad0087b7ef9014221e05c711','build_bridge_sweep_cutter.py':'b7ae153b6ac218fcf4ca9ecb078134711366610bce6900f4295df1919ba037d3'}
for name,sha in LOCKS.items():assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==sha,name
stage_env=os.environ.get('TRANSWING_INSET_STAGE')
if stage_env:
 stage=Path(stage_env);expected=os.environ.get('TRANSWING_INSET_STAGE_SHA');assert expected and hashlib.sha256(stage.read_bytes()).hexdigest()==expected,'Explicit stage SHA required';bpy.ops.wm.open_mainfile(filepath=str(stage))
else:
 os.environ['TRANSWING_INSET_LABEL']=LABEL+'-core';runpy.run_path(str(HERE/'build_skin_swept.py'));stage=ROOT/'qa/revision-20261007'/(LABEL+'-core.blend')
stage_sha=hashlib.sha256(stage.read_bytes()).hexdigest();scene=bpy.context.scene;scene.frame_set(99);bpy.context.preferences.filepaths.save_version=0
centers={s:bpy.data.objects['WingPivot_'+s].location.copy()for s in ['L','R']};axes={s:Vector((1 if s=='L'else -1,-1,1)).normalized()for s in ['L','R']}
for s in ['L','R']:bpy.data.objects['WingPivot_'+s].rotation_mode='QUATERNION';bpy.data.objects['WingPivot_'+s].rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
def boolean(obj,cutter,kind):
 bpy.context.view_layer.update();bpy.context.view_layer.objects.active=obj;m=obj.modifiers.new('本轮有限实体接回','BOOLEAN');m.operation=kind;m.solver='EXACT';m.object=cutter;bpy.ops.object.modifier_apply(modifier=m.name)
def temp_revolve(name,side,profile):
 origin=centers[side];a=axes[side];sg=-1 if side=='L'else 1;e=Vector((sg,-1,0)).normalized();f=a.cross(e).normalized();vertices=[];rings=[];faces=[];n=96
 for t,r in profile:
  if r==0:rings.append([len(vertices)]);vertices.append(origin+a*t);continue
  ring=[]
  for j in range(n):ring.append(len(vertices));vertices.append(origin+a*t+r*(e*math.cos(j*2*math.pi/n)+f*math.sin(j*2*math.pi/n)))
  rings.append(ring)
 for u,v in zip(rings,rings[1:]+rings[:1]):
  if len(u)==len(v)==1:continue
  for j in range(n):
   k=(j+1)%n
   faces.append((u[0],v[k],v[j])if len(u)==1 else(u[j],u[k],v[0])if len(v)==1 else(u[j],u[k],v[k],v[j]))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(ed.is_manifold for ed in bm.edges);assert bm.calc_volume(signed=True)>0;bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);return obj
from triangulate_local_result import apply as triangulate
from rebuild_rear_corner_flat import rebuild_rear_corner_flat as rebuild_rear_corner
from build_bridge_sweep_cutter import build as build_bridge_cutter
from connect_moving_bridge import connect
from repair_drive_phase import synchronize_lead_screw_phase
from finish_local_normals import finish
receipts={'rear':[],'ribs':[],'triangulation':[],'normals':[],'movingBores':[]}
for side in ['L','R']:
 wing=bpy.data.objects['Composite_wing_'+side];receipts['triangulation'].append(triangulate(wing));receipts['rear'].append(rebuild_rear_corner(wing,side))
 for name in ['RootCarrierMoving_'+side,'RootCarrierThrust_'+side]:
  obj=bpy.data.objects[name];inv=obj.matrix_world.inverted();count=0;maxmove=0
  for v in obj.data.vertices:
   p=obj.matrix_world@v.co;q=p-centers[side];t=q.dot(axes[side]);radial=q-axes[side]*t;r=radial.length
   if r<.032:
    target=centers[side]+axes[side]*t+radial*(.0313/r);maxmove=max(maxmove,(target-p).length);v.co=inv@target;count+=1
  obj.data.update();receipts['movingBores'].append({'node':name,'newInnerRadius':.0313,'movedVertices':count,'maximumVertexMove':maxmove,'outerShapeAndAxialStackUnchanged':True})
 cutter=build_bridge_cutter(side,centers[side],axes[side],boolean,temp_revolve);receipts['ribs'].append(connect(side,centers[side],axes[side],cutter,boolean));bpy.data.objects.remove(cutter,do_unlink=True)
 for stem in ['Composite_wing_','Fixed_root_','RootCarrierBridge_','RootCarrierMoving_','RootCarrierThrust_']:
  ob=bpy.data.objects[stem+side];receipts['triangulation'].append(triangulate(ob))
  if stem in ['Composite_wing_','Fixed_root_']:receipts['normals'].append(finish(ob,centers[side],axes[side]))
receipts['drivePhase']=synchronize_lead_screw_phase();scene['insetIntegratedRevision']=LABEL;scene['revisionAccepted']=False;scene['revisionNote']='新图统一候选：内嵌关节、内移球点、自然平顺翼腹及闭合圆角；保留必要运动让位口，待本候选联合复核与用户审图，未发布';bpy.context.view_layer.update()
dest=ROOT/'qa/revision-20261007'/(LABEL+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(dest))
source_names=['build_integrated_flat_candidate.py','build_skin_swept.py','build_layout.py','relieve_local_sweep.py','triangulate_local_result.py','finish_local_normals.py','rebuild_rear_corner_flat.py','connect_moving_bridge.py','build_bridge_sweep_cutter.py','repair_drive_phase.py']
report={'candidate':LABEL,'sourceSha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'stageInput':str(stage.relative_to(ROOT)),'stageInputSha256':stage_sha,'defaultRebuild':'frozen V24 -> locked M -> current compact layout -> conservative local skin sweep -> integrated rear/rib/thread/bore revisions','sourceFiles':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest()for n in source_names},'receipts':receipts,'geometryAccepted':False,'appearanceAccepted':False,'published':False,'naturalFeatherException':'Only the original V25 naturally thin trailing-edge domain may return to its original thickness distribution; primary walls and original V25 >=.010u domain remain >=.010u. M artificial downward thickening is not preserved as a global minimum. Actual affected points and finite validation are separately bound to this candidate.','manufacturingOrStrengthCertification':False}
(OUT/(LABEL+'-construction.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2));print('INTEGRATED',LABEL,report['sourceSha256'],flush=True)
