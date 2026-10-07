"""改变轴位后全机跨刚体表面扫掠初检；不复用旧运动结论。"""
from pathlib import Path
import os,hashlib,bpy,json,math,sys,time,itertools
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007';LABEL=os.environ.get('TRANSWING_CANDIDATE','candidate-large-raised');sys.path.insert(0,str(ROOT/'scripts'));bpy.ops.wm.open_mainfile(filepath=str(OUT/(LABEL+'.blend')));bpy.context.view_layer.update()
import kinematics
kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
meshes=[]
def group(o):
 p=o
 while p:
  if p.name.startswith('WingPivot_'):return p.name
  if p.name in ['BraceRod_L','BraceRod_R']:return p.name
  if p.name=='BraceSpreader':return p.name
  p=p.parent
 return 'fixed'
for o in bpy.data.objects:
 if o.type!='MESH':continue
 o.data.calc_loop_triangles();meshes.append({'object':o,'name':o.name,'group':group(o),'local':np.array([tuple(v.co)for v in o.data.vertices]),'triangles':[tuple(t.vertices)for t in o.data.loop_triangles]})
pairs=[(a,b)for a,b in itertools.combinations(meshes,2)if a['group']!=b['group']];contacts={};broad=0;checks=0;start=time.time()
angles=sorted(set([i/4 for i in range(481)]+[i/40 for i in range(201)]))
for i,angle in enumerate(angles):
 for side,sg in [('L',-1),('R',1)]:
  p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 bpy.context.view_layer.update();kinematics.update_linkage();snap={}
 for m in meshes:
  mat=np.array(m['object'].matrix_world);pts=m['local']@mat[:3,:3].T+mat[:3,3];snap[m['name']]={'points':pts,'min':pts.min(axis=0),'max':pts.max(axis=0),'tree':None}
 for a,b in pairs:
  aa,bb=snap[a['name']],snap[b['name']]
  if np.any(aa['max']<bb['min'])or np.any(bb['max']<aa['min']):continue
  broad+=1
  for m,ss in [(a,aa),(b,bb)]:
   if ss['tree']is None:ss['tree']=BVHTree.FromPolygons(ss['points'].tolist(),m['triangles'],all_triangles=True)
  hits=aa['tree'].overlap(bb['tree']);checks+=1
  if hits:
   key=a['name']+' / '+b['name']
   if key not in contacts:contacts[key]={'firstAngle':angle,'poses':0,'maxTrianglePairs':0};print('CONTACT',key,angle,len(hits),flush=True)
   contacts[key]['poses']+=1;contacts[key]['maxTrianglePairs']=max(contacts[key]['maxTrianglePairs'],len(hits))
 if i%15==0:print('POSE',i,'CONTACTS',len(contacts),'SECONDS',time.time()-start,flush=True)
receipt={'samples':len(angles),'angles':angles,'regularStepDegrees':.25,'nearCruiseStepDegrees':.025,'source':LABEL+'.blend','sourceBlendSha256':hashlib.sha256((OUT/(LABEL+'.blend')).read_bytes()).hexdigest(),'groups':sorted({m['group']for m in meshes}),'candidatePairs':len(pairs),'broadCandidates':broad,'surfacePairChecks':checks,'contacts':contacts,'passed':not contacts,'claimBoundary':'All meshes present, actual current transforms, same rigid wing assemblies skipped. Rotor phase/folding relative motion and closed-component containment are separate checks, not implied.'};(OUT/(LABEL+'-dense-wing-sweep-preflight.json')).write_text(json.dumps(receipt,indent=2))
