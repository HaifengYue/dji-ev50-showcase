"""改变轴位后全机跨刚体表面扫掠初检；不复用旧运动结论。"""
from pathlib import Path
import os,hashlib,bmesh,bpy,json,math,sys,time,itertools
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
  if p.name.startswith(('ControlPivot_','BladeFold_','Prop_','WingPivot_')):return p.name
  if p.name in ['BraceRod_L','BraceRod_R']:return p.name
  if p.name=='BraceSpreader':return p.name
  p=p.parent
 return 'fixed'
for o in bpy.data.objects:
 if o.type!='MESH':continue
 o.data.calc_loop_triangles();meshes.append({'object':o,'name':o.name,'group':group(o),'local':np.array([tuple(v.co)for v in o.data.vertices]),'triangles':[tuple(t.vertices)for t in o.data.loop_triangles]})
for m in meshes:
 bm=bmesh.new();bm.from_mesh(m['object'].data);bm.verts.ensure_lookup_table();bm.verts.index_update();m['closed']=all(e.is_manifold for e in bm.edges);adj={v:set()for v in bm.verts if v.link_faces}
 for e in bm.edges:
  a,b=e.verts
  if a in adj and b in adj:adj[a].add(b);adj[b].add(a)
 unseen=set(adj);m['components']=[];m['componentVertices']=[]
 while unseen:
  first=unseen.pop();m['components'].append(first.index);component_vertices=[first.index];stack=[first]
  while stack:
   for v in adj[stack.pop()]:
    if v in unseen:unseen.remove(v);stack.append(v);component_vertices.append(v.index)
  m['componentVertices'].append(component_vertices)
 bm.free()
def classify_inside(tree,point,points,triangles):
 point=Vector(point);nearest=tree.find_nearest(point)
 if nearest[3]<1e-6:return 'boundary-unresolved'
 states=[]
 for direction in [Vector((1,.234,.456)).normalized(),Vector((.321,1,.789)).normalized(),Vector((.137,.249,1)).normalized()]:
  origin=point.copy();hits=0
  for _ in range(128):
   hit=tree.ray_cast(origin,direction,100)
   if hit[0]is None:break
   hits+=1;origin=hit[0]+direction*1e-6
  else:return 'ray-overflow-unresolved'
  states.append(hits%2==1)
 if len(set(states))!=1:
  tri=points[np.asarray(triangles,dtype=int)]-np.asarray(tuple(point));lengths=np.linalg.norm(tri,axis=2);numerator=np.einsum('ij,ij->i',tri[:,0],np.cross(tri[:,1],tri[:,2]));denominator=lengths.prod(axis=1)+np.einsum('ij,ij->i',tri[:,0],tri[:,1])*lengths[:,2]+np.einsum('ij,ij->i',tri[:,1],tri[:,2])*lengths[:,0]+np.einsum('ij,ij->i',tri[:,2],tri[:,0])*lengths[:,1];winding=float(np.arctan2(numerator,denominator).sum()/(2*math.pi))
  if abs(winding-round(winding))<1e-6:return 'inside'if abs(round(winding))>=1 else'outside'
  return 'ray-and-winding-disagreement-unresolved'
 return 'inside'if states[0]else'outside'
# Distinct moving control owners are checked against every other rigid group.
# Other whole-airframe motion pairs remain covered by separate bound sweeps.
control_names=['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R']
control_group=lambda m:m['group'].startswith('ControlPivot_')
pairs=[(a,b)for a,b in itertools.combinations(meshes,2)if a['group']!=b['group']and(control_group(a)or control_group(b))]
axes={key:(bpy.data.objects['ControlAxisEnd_'+key].location-bpy.data.objects['ControlAxisStart_'+key].location).normalized()for key in control_names}
mode=os.environ.get('SKYTRANS_CONTROL_SWEEP','quick')
tilts=sorted(set([0,.25,.5,1,2,5]+list(range(10,121,10))+[116.4]))
if mode=='quick':
 states=[(0,0,0,[0]*6)]
 for j in range(6):
  for deg in [-12,12]:v=[0]*6;v[j]=deg;states.append((0,0,0,v))
elif mode=='local':
 states=[]
 for j in range(6):
  for deg in range(-12,13):v=[0]*6;v[j]=deg;states.append((0,0,0,v))
elif mode=='combined':
 states=[(angle,fold,phase,list(corner))for angle in tilts for fold in [0,.5,1]for phase in range(4)for corner in itertools.product([-12,12],repeat=6)]
else:raise ValueError(mode)
contacts={};contained={};unresolved={};checks=0;broad=0;start=time.time()
mesh_indices={m['name']:i for i,m in enumerate(meshes)}
pair_indices=np.asarray([(mesh_indices[a['name']],mesh_indices[b['name']])for a,b in pairs],dtype=np.int64)
# Multiple exact world matrices recur in independent-control corner combinations.
# Cache is keyed by all matrix bytes; no nearby poses are merged.
cache={m['name']:{}for m in meshes};first_pose_broadphase_equivalence=False
safe_pair_cache=set();safe_pair_cache_hits=0
for i,(angle,fold,phase,values)in enumerate(states):
 for side,sg in [('L',-1),('R',1)]:
  p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 for key,deg in zip(control_names,values):
  pivot=bpy.data.objects['ControlPivot_'+key];pivot.rotation_mode='QUATERNION';pivot.rotation_quaternion=Quaternion(axes[key],pivot.get('detailSign',1)*math.radians(deg))
 for pod_index,(side,end)in enumerate([(s,e)for s in ['L','R']for e in ['Front','Rear']]):
  prop=bpy.data.objects['Prop_'+side+'_'+end];prop.rotation_mode='QUATERNION';prop.rotation_quaternion=Quaternion((1,0,0),math.pi/2)@Quaternion((0,0,1),prop.get('spinSign',1)*(phase*math.pi/2+pod_index*.37))
  for leaf,sgn in [('A',-1),('B',1)]:
   p=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];p.rotation_mode='XYZ';p.rotation_euler=(0,sgn*math.pi/2*fold,0)
 bpy.context.view_layer.update();kinematics.update_linkage();snap={}
 for m in meshes:
  mat=np.array(m['object'].matrix_world);key=mat.tobytes();data=cache[m['name']].get(key)
  if data is None:
   pts=m['local']@mat[:3,:3].T+mat[:3,3];data={'points':pts,'min':pts.min(axis=0),'max':pts.max(axis=0),'tree':None};cache[m['name']][key]=data
  snap[m['name']]=data
 lo=np.asarray([snap[m['name']]['min']for m in meshes]);hi=np.asarray([snap[m['name']]['max']for m in meshes]);assert np.all(np.isfinite(lo))and np.all(np.isfinite(hi))
 keep=np.all(hi[pair_indices[:,0]]>=lo[pair_indices[:,1]],axis=1)&np.all(hi[pair_indices[:,1]]>=lo[pair_indices[:,0]],axis=1)
 if i==0:
  old_keep=np.asarray([not(np.any(snap[a['name']]['max']<snap[b['name']]['min'])or np.any(snap[b['name']]['max']<snap[a['name']]['min']))for a,b in pairs]);assert np.array_equal(keep,old_keep);first_pose_broadphase_equivalence=True
 for pair_index in np.flatnonzero(keep):
  a,b=pairs[int(pair_index)];aa,bb=snap[a['name']],snap[b['name']];broad+=1
  pair_key=(int(pair_index),id(aa),id(bb))
  if pair_key in safe_pair_cache:safe_pair_cache_hits+=1;continue
  safe_pair=True
  for m,ss in [(a,aa),(b,bb)]:
   if ss['tree']is None:ss['tree']=BVHTree.FromPolygons(ss['points'].tolist(),m['triangles'],all_triangles=True)
  hits=aa['tree'].overlap(bb['tree']);checks+=1
  state={'index':i,'tiltDegrees':angle,'foldFraction':fold,'phaseQuarter':phase,'controlDegrees':dict(zip(control_names,values))}
  if hits:
   safe_pair=False
   k=a['name']+' / '+b['name']
   if k not in contacts:contacts[k]={'firstState':state,'poses':0,'maxTrianglePairs':0};print('CONTACT',k,state,len(hits),flush=True)
   contacts[k]['poses']+=1;contacts[k]['maxTrianglePairs']=max(contacts[k]['maxTrianglePairs'],len(hits))
  else:
   for inside,container,si,sc in [(a,b,aa,bb),(b,a,bb,aa)]:
    if not container['closed']:continue
    for component,idx in enumerate(inside['components']):
     cp=si['points'][inside['componentVertices'][component]]
     if np.any(cp.min(axis=0)<sc['min'])or np.any(cp.max(axis=0)>sc['max']):continue
     point=si['points'][idx];result=classify_inside(sc['tree'],point,sc['points'],container['triangles'])
     if result=='outside':continue
     safe_pair=False
     k=inside['name']+' inside '+container['name']+' / '+str(component);target=contained if result=='inside'else unresolved
     if k not in target:target[k]={'firstState':state,'classification':result,'witness':point.tolist()};print('CONTAINMENT',k,result,flush=True)
  if safe_pair:safe_pair_cache.add(pair_key)
 if i%64==0:print('POSE',i,'CONTACTS',len(contacts),'SECONDS',time.time()-start,flush=True)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_SHA,'Source candidate changed during sweep'
receipt={'schema':'transwing.independent-control-combination-sweep.v1','mode':mode,'samples':len(states),'sourceBlendSha256':SOURCE_SHA,'controlIds':control_names,'sampledDegrees':[-12,12]if mode=='combined'else list(range(-12,13))if mode=='local'else[-12,0,12],'tiltAngles':tilts if mode=='combined'else[0],'foldFractions':[0,.5,1]if mode=='combined'else[0],'rotorPhaseQuarterSteps':4 if mode=='combined'else 1,'all64IndependentControlLimitCorners':mode=='combined','candidatePairs':len(pairs),'surfacePairChecks':checks,'contacts':contacts,'containedComponents':contained,'unresolvedContainment':unresolved,'passed':not contacts and not contained and not unresolved,'seconds':time.time()-start,'firstPoseBroadphaseComparedExactly':first_pose_broadphase_equivalence,'cacheUsesExactWorldMatrixBytes':True,'safePairCacheHits':safe_pair_cache_hits,'safePairCacheScope':'Only exactly repeated object matrices and fixed mesh data after both surface and containment predicates returned clear; problematic pairs never cached','claimBoundary':'All pairs with at least one independently moving control owner, excluding only same control rigid group. Exact sampled transforms with closed-component containment. Same-rigid attachments and non-control motion pairs require separate reviews; finite states do not certify continuous geometry.'}
(OUT/(LABEL+'-controls-'+mode+'-check.json')).write_text(json.dumps(receipt,indent=2)+'\n');assert receipt['passed'],'Control material/containment sweep failed'
