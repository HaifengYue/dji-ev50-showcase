"""V26局部翼腹收边；始终从冻结V24基线经V25配方重新构造。"""
from pathlib import Path
import os,runpy,json,math,sys
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).resolve().parent));LABEL=os.environ.get('TRANSWING_DETAIL_LABEL','candidate-detail-m');os.environ['TRANSWING_REVISION_LABEL']=LABEL
bpy.context.preferences.filepaths.save_version=0
base=runpy.run_path(str(ROOT/'scripts/revision_20261007/rebuild_geometry.py'))
station=base['station'];thickness=base['thickness'];soft_min=base['soft_min'];rows=[]
from annotated_root_interface import lower_curve,lower_gap
def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)
def tree(o):
 o.data.calc_loop_triangles();return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[tuple(t.vertices)for t in o.data.loop_triangles],all_triangles=True)
def shift(p):
 x=abs(p.x);st=station(x);u=(p.y-st[1])/st[2]
 front=1-smooth((p.y+1.70)/.08);rear=smooth((u-.80)/.095)
 front_dx=max(0,lower_curve(p.y)+lower_gap(p.y)-.020-.65)*front*(1-smooth((x-.65)/.60))
 rear_dx=.02*rear*(1-smooth((x-.65)/.30))
 return max(front_dx,rear_dx),rear
def param(p):
 x=abs(p.x);st=station(x);u=(p.y-st[1])/st[2];return x,u,st
for side,sg in [('L',-1),('R',1)]:
 floor=bpy.data.objects['WingLowerClosure_'+side];wing=bpy.data.objects['Composite_wing_'+side];wt=tree(wing);mi=floor.matrix_world.inverted();changes=[]
 for v in floor.data.vertices:
  p=floor.matrix_world@v.co;x,u,st=param(p)
  dx,rear=shift(p)
  if dx<1e-10 and rear<1e-10 and u>.175:continue
  nx=x+dx;ns=station(nx);nu=(p.y-ns[1])/ns[2]-.032*(1-smooth((u-.045)/.13))+(.035+.025*(1-smooth((x-.80)/.12)))*rear;q=Vector((sg*nx,ns[1]+nu*ns[2],p.z));t=thickness(max(0,u),st[2],st[4]);nt=thickness(max(0,nu),ns[2],ns[4]);oldlow=soft_min(st[3]-t-.0004,st[3]+t-.0305);newlow=soft_min(ns[3]-nt-.0004,ns[3]+nt-.0305);q.z+=newlow-oldlow
  # 同一活动实体的原翼腹作为后缘收口宿主，保留完整.012厚度。
  hit=wt.ray_cast(Vector((q.x,q.y,-2)),Vector((0,0,1)),4)
  if rear>0 and hit[0] is not None and hit[1].z<-.5:
   amount=rear*(hit[0].z+.00005-newlow);q.z+=max(0,amount)
  v.co=mi@q;changes.append({'vertex':v.index,'before':list(p),'after':list(q)})
 floor.data.update();ft=tree(floor);coat=bpy.data.objects['WingLowerClosureBlue_'+side];ci=coat.matrix_world.inverted()
 for v in coat.data.vertices:
  p=coat.matrix_world@v.co;x,u,st=param(p);dx,rear=shift(p);p.x=sg*(x+dx);ns=station(x+dx);nu=(p.y-ns[1])/ns[2]-.032*(1-smooth((u-.045)/.13))+(.035+.025*(1-smooth((x-.80)/.12)))*rear;p.y=ns[1]+nu*ns[2]
  hit=ft.ray_cast(Vector((p.x,p.y,-2)),Vector((0,0,1)),4)
  if hit[0] is None:
   near=ft.find_nearest(p)
   if near[0] is None:raise ValueError('下皮蓝层失去宿主')
   p=near[0]
  else:p.z=hit[0].z
  p.z-=.004;v.co=ci@p
 coat.data.update();rows.append({'side':side,'floorChangedVertices':changes,'localPlanCornerRetreat':{'front':.15,'rear':.10,'spanDecay':.25},'centralFloorAndNewHingePreserved':True})
from unified_endcaps import unify
for side in ['L','R']:rows.append(unify(side,base['boolean'],station))
bpy.context.view_layer.update();bpy.context.scene['detailRevision']='2026-10-07-v26-'+LABEL;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'qa/revision-20261007'/(LABEL+'.blend')))
(ROOT/'qa/revision-20261007-detail'/(LABEL+'-construction.json')).write_text(json.dumps({'candidate':LABEL,'recipe':'frozen V24 baseline -> independently reproduced V25 -> bounded front/aft lower closure corner retreat','rows':rows,'geometrySourceSha256':__import__('hashlib').sha256((ROOT/'assets/baseline-20261007/xp4.blend').read_bytes()).hexdigest(),'constructionScripts':{str(p.relative_to(ROOT)):__import__('hashlib').sha256(p.read_bytes()).hexdigest()for p in [Path(__file__),Path(__file__).with_name('unified_endcaps.py'),ROOT/'scripts/revision_20261007/rebuild_geometry.py',ROOT/'scripts/revision_20261007/finish_supports_paint.py']},'status':'CANDIDATE_JOINT_VALIDATION_REQUIRED'},ensure_ascii=False,indent=2))
