"""改变轴位后全机跨刚体表面扫掠初检；不复用旧运动结论。"""
from pathlib import Path
import os,hashlib,bpy,json,math,sys,time,itertools
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
import argparse
ap=argparse.ArgumentParser()
ap.add_argument('--source',required=True)
ap.add_argument('--modules',required=True)
ap.add_argument('--output',required=True)
ap.add_argument('--expected-sha',required=True)
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else[])
SOURCE=Path(args.source).resolve();OUT=Path(args.output).resolve();OUT.mkdir(parents=True,exist_ok=True)
ROOT=Path(args.modules).resolve().parent;LABEL=SOURCE.stem
SOURCE_SHA=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
assert SOURCE_SHA==args.expected_sha,'Independent expected native SHA mismatch'
sys.path.insert(0,str(Path(args.modules).resolve()))
bpy.ops.wm.open_mainfile(filepath=str(SOURCE));bpy.context.view_layer.update()

import kinematics
kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
meshes=[]
def group(o):
 p=o
 while p:
  if p.name.startswith(('BladeFold_','Prop_','WingPivot_')):return p.name
  if p.name in ['BraceRod_L','BraceRod_R']:return p.name
  if p.name=='BraceSpreader':return p.name
  p=p.parent
 return 'fixed'
for o in bpy.data.objects:
 if o.type!='MESH':continue
 o.data.calc_loop_triangles();meshes.append({'object':o,'name':o.name,'group':group(o),'local':np.array([tuple(v.co)for v in o.data.vertices]),'triangles':[tuple(t.vertices)for t in o.data.loop_triangles]})
pairs=[(a,b)for a,b in itertools.combinations(meshes,2)if a['group']!=b['group']];contacts={};broad=0;checks=0;start=time.time()
states=[(angle,fold,phase)for angle in [0,20,40,60,80,100,120]for fold in [0,.5,1]for phase in range(12)]
for i,(angle,fold,phase) in enumerate(states):
 for side,sg in [('L',-1),('R',1)]:
  p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 for pod_index,(side,end) in enumerate([(s,e)for s in ['L','R']for e in ['Front','Rear']]):
  prop=bpy.data.objects['Prop_'+side+'_'+end];prop.rotation_mode='QUATERNION';prop.rotation_quaternion=Quaternion((1,0,0),math.pi/2)@Quaternion((0,0,1),prop.get('spinSign',1)*(phase*math.pi/6+pod_index*.37))
  for leaf,sgn in [('A',-1),('B',1)]:
   leaf_pivot=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];leaf_pivot.rotation_mode='XYZ';leaf_pivot.rotation_euler=(0,sgn*math.pi/2*fold,0)
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
   if key not in contacts:contacts[key]={'firstAngle':angle,'firstFold':fold,'firstPhaseStep':phase,'poses':0,'maxTrianglePairs':0};print('CONTACT',key,angle,len(hits),flush=True)
   contacts[key]['poses']+=1;contacts[key]['maxTrianglePairs']=max(contacts[key]['maxTrianglePairs'],len(hits))
 if i%15==0:print('POSE',i,'CONTACTS',len(contacts),'SECONDS',time.time()-start,flush=True)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_SHA,'Source changed during sweep'
receipt={'samples':len(states),'states':states,'foldFractions':[0,.5,1],'rotorPhaseSteps':12,'source':LABEL+'.blend','sourceBlendSha256':SOURCE_SHA,'groups':sorted({m['group']for m in meshes}),'candidatePairs':len(pairs),'broadCandidates':broad,'surfacePairChecks':checks,'contacts':contacts,'passed':not contacts,'claimBoundary':'All meshes present, actual current transforms, same rigid wing assemblies skipped. Rotors and folding leaves treated as independent rigid groups; sampled geometry including newly moved front assemblies. Closed-component containment and continuous intervals remain separate.'};(OUT/(LABEL+'-rotor-fold-phase-preflight.json')).write_text(json.dumps(receipt,indent=2))
