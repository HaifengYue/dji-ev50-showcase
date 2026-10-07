"""改变轴位后全机跨刚体表面扫掠初检；不复用旧运动结论。"""
from pathlib import Path
import os,hashlib,bmesh,bpy,json,math,sys,time,itertools
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap()
ROOT=Q.project;OUT=Q.output;CANDIDATE=Q.candidate;LABEL=CANDIDATE.stem;bpy.ops.wm.open_mainfile(filepath=str(CANDIDATE));bpy.context.view_layer.update()
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
contained={};unresolved={}
pairs=[(a,b)for a,b in itertools.combinations(meshes,2)if a['group']!=b['group']];contacts={};broad=0;checks=0;start=time.time()
angles=sorted(set([0,.025,.05,.1,.25,.5,1,1.25,1.5,2,3,5]+[5*i for i in range(2,25)]))
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
  if not hits:
   for inside,container,si,sc in [(a,b,aa,bb),(b,a,bb,aa)]:
    if not container['closed']:continue
    for component,idx in enumerate(inside['components']):
     point=si['points'][idx]
     component_points=si['points'][inside['componentVertices'][component]]
     # A whole component cannot be contained if its actual AABB is not contained.
     # This is only containment pruning; triangle intersections were already checked.
     if np.any(component_points.min(axis=0)<sc['min'])or np.any(component_points.max(axis=0)>sc['max']):continue
     if np.any(point<sc['min'])or np.any(point>sc['max']):continue
     result=classify_inside(sc['tree'],point,sc['points'],container['triangles'])
     if result=='outside':continue
     key=inside['name']+' inside '+container['name']+' / '+str(component)
     target=contained if result=='inside'else unresolved
     if key not in target:target[key]={'angle':angle,'classification':result,'witness':point.tolist()};print('CONTAINMENT',key,angle,result,flush=True)
  if hits:
   key=a['name']+' / '+b['name']
   if key not in contacts:contacts[key]={'firstAngle':angle,'poses':0,'maxTrianglePairs':0};print('CONTACT',key,angle,len(hits),flush=True)
   contacts[key]['poses']+=1;contacts[key]['maxTrianglePairs']=max(contacts[key]['maxTrianglePairs'],len(hits))
 if i%15==0:print('POSE',i,'CONTACTS',len(contacts),'SECONDS',time.time()-start,flush=True)
receipt={'samples':len(angles),'angles':angles,'regularStepDegrees':5,'nearCruiseStepDegrees':None,'source':LABEL+'.blend','sourceBlendSha256':hashlib.sha256((CANDIDATE).read_bytes()).hexdigest(),'groups':sorted({m['group']for m in meshes}),'candidatePairs':len(pairs),'broadCandidates':broad,'surfacePairChecks':checks,'contacts':contacts,'containedComponents':contained,'unresolvedContainment':unresolved,'passed':not contacts and not contained and not unresolved,'claimBoundary':'All meshes present, actual current transforms, same rigid wing assemblies skipped. All closed-component containment candidates checked with three ray directions and solid-angle fallback; rigid-group skips are explicit. Rotor phase/folding has a separate report.'};(OUT/(LABEL+'-dense-wing-material-check.json')).write_text(json.dumps(receipt,indent=2))
