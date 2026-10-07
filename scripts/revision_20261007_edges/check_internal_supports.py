from pathlib import Path
import bpy,bmesh,sys,json,math,hashlib,itertools
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007-inset/edge-linkage-checks';OUT.mkdir(parents=True,exist_ok=True);sys.path[:0]=[str(ROOT/'scripts'),str(Path(__file__).parent)]
import kinematics
from apply_linkage_inset import apply_revised_linkage
from revision_20261007_inset.repair_drive_phase import _helix_phase
import os
LABEL=os.environ.get('TRANSWING_EDGE_LABEL','candidate-inset-integrated-b-edge-linkage')
SOURCE=ROOT/'qa/revision-20261007'/(LABEL+'.blend')
from native_snapshot import snapshot
current_rows=snapshot(SOURCE);baseline_rows=json.loads((ROOT/'REVISION_INSET_GEOMETRY_REFERENCE.json').read_text())['rows']
def mesh(o):
 o.data.calc_loop_triangles();v=[o.matrix_world@v.co for v in o.data.vertices];t=[tuple(t.vertices)for t in o.data.loop_triangles];return {'v':v,'t':t,'tree':BVHTree.FromPolygons(v,t,all_triangles=True),'min':Vector(tuple(min(p[k]for p in v)for k in range(3))),'max':Vector(tuple(max(p[k]for p in v)for k in range(3)))}
def group(o):
 while o:
  if o.name.startswith('WingPivot_') or o.name in ['BraceRod_L','BraceRod_R','BraceSpreader','Drive_ScrewRotor','Drive_MotorRotor'] or o.name.startswith('Drive_PlanetRotor_'):return o.name
  o=o.parent
 return 'fixed'
def digest(o):return hashlib.sha256(str(([tuple(v.co)for v in o.data.vertices],[tuple(p.vertices)for p in o.data.polygons],[[float(v)for v in r]for r in o.matrix_basis])).encode()).hexdigest()
protected=[o.name for o in bpy.data.objects if o.type=='MESH' and (o.name.startswith(('Drive_Rear','Drive_Motor','Drive_Reduction','Drive_OutputCoupling','Drive_LeadScrewCore','ActuatorSideSlot_')))]
pre={n:baseline_rows[n]for n in protected};kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();receipt=json.loads((ROOT/'qa/revision-20261007-inset'/(LABEL+'-construction.json')).read_text())['receipts']['linkageInset'];post={n:current_rows[n]for n in protected};assert pre==post
(OUT/'APPLY_REVISED_LINKAGE_RECEIPT.json').write_text(json.dumps(receipt,indent=2))
changed=receipt['driveExtension']['frontSupportNames']+['Drive_FrontFoot_L','Drive_FrontFoot_R','Drive_GuideRail_L','Drive_GuideRail_R','Drive_LeadScrewThread','Drive_FrontTravelStop_L','Drive_FrontTravelStop_R','BraceWingSeat_L','BraceWingSeat_R','Fuselage'];topology={}
for n in changed:
 o=bpy.data.objects[n];bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();unseen=set(bm.verts);count=0
 while unseen:
  stack=[unseen.pop()];count+=1
  while stack:
   for ed in stack.pop().link_edges:
    for v in ed.verts:
     if v in unseen:unseen.remove(v);stack.append(v)
 topology[n]={'nonmanifoldEdges':sum(not e.is_manifold for e in bm.edges),'looseEdges':sum(not e.link_faces for e in bm.edges),'components':count,'signedVolume':bm.calc_volume(signed=True)};bm.free()
static={o.name:mesh(o)for o in bpy.data.objects if o.type=='MESH'and group(o)=='fixed'};front=set(changed)-{'Fuselage','BraceWingSeat_L','BraceWingSeat_R','Drive_LeadScrewThread'}
base=json.loads((ROOT/'assets/baseline-v25-20261007/manifest.json').read_text());allowed={frozenset(c['pair'])for c in base['internalDrive']['fixedAttachmentInterfaces']};static_contacts={};unexpected={}
for a,b in itertools.combinations(static,2):
 if a not in front and b not in front:continue
 aa,bb=static[a],static[b]
 if any(aa['max'][k]<bb['min'][k]or bb['max'][k]<aa['min'][k]for k in range(3)):continue
 hits=aa['tree'].overlap(bb['tree'])
 if hits:
  key=a+' / '+b;static_contacts[key]={'trianglePairs':len(hits),'originalAttachmentPair':frozenset((a,b))in allowed}
  if frozenset((a,b))not in allowed:unexpected[key]=static_contacts[key]
body=static['Fuselage'];contain=[];checked=0;minNear={'distance':100};phase=[];dirs=[Vector((1,.113,.271)).normalized(),Vector((-.183,1,.419)).normalized(),Vector((.317,-.157,1)).normalized()]
moving=[o for o in bpy.data.objects if o.type=='MESH'and group(o)in ['BraceSpreader','BraceRod_L','BraceRod_R']]
for angle in range(0,121,10):
 for side,sg in [('L',-1),('R',1)]:bpy.data.objects['WingPivot_'+side].rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 bpy.context.view_layer.update();kinematics.update_linkage()
 rotor=bpy.data.objects['Drive_ScrewRotor'];inv=rotor.matrix_world.inverted();ma,ms=_helix_phase(bpy.data.objects['Drive_LeadScrewThread'],inv);fe,fs=_helix_phase(bpy.data.objects['Drive_NutInternalThread'],inv);phase.append({'angle':angle,'residual':math.remainder(fe-ma-math.pi,2*math.pi),'scatter':max(ms,fs)})
 for o in moving:
  for v in o.data.vertices:
   p=o.matrix_world@v.co;checked+=1;near,norm,idx,dist=body['tree'].find_nearest(p)
   if dist<minNear['distance']:minNear={'distance':dist,'angle':angle,'node':o.name,'vertex':v.index,'point':list(p),'nearest':list(near)}
   if (p-near).dot(norm)>=-1e-7:continue
   states=[]
   for dr in dirs:
    q=p.copy();cnt=0
    for i in range(150):
     hit,n,idx,ds=body['tree'].ray_cast(q,dr,100)
     if hit is None:break
     cnt+=1;q=hit+dr*1e-6
    states.append(cnt%2)
   if all(states):contain.append({'angle':angle,'node':o.name,'vertex':v.index,'point':list(p),'nearestDistance':dist})
 print('CONTAIN',angle,checked,len(contain),flush=True)
feet=[]
for side,sg in [('L',-1),('R',1)]:
 o=bpy.data.objects['Drive_FrontFoot_'+side];v=[o.matrix_world@v.co for v in o.data.vertices];bottom=[p for p in v if p.z<.05];embed=[]
 for p in bottom:
  hit=body['tree'].ray_cast(Vector((p.x,p.y,.08)),Vector((0,0,-1)),1);assert hit[0] is not None;embed.append(hit[0].z-p.z)
 foot=static[o.name];support=static['Drive_FrontSupport'];feet.append({'side':side,'minimumFootEmbedding':min(embed),'maximumFootEmbedding':max(embed),'footToFloorTrianglePairs':len(foot['tree'].overlap(body['tree'])),'footToSupportTrianglePairs':len(foot['tree'].overlap(support['tree'])),'minimumFootFiniteHeight':.051-max(p.z for p in bottom)})
# Sample the two lower-skin intersections immediately outside the extended
# opening, not the distant upper fuselage shell. This is finite vertical
# thickness evidence, not a global normal-thickness certificate.
outline=[Vector(p)for p in receipt['slotRelief']['cutters'][1]['xyOutline']];wall=[]
for a,b in zip(outline,outline[1:]+outline[:1]):
 dr=b-a
 if dr.length<1e-8:continue
 for t in [i/8 for i in range(9)]:
  p=a.lerp(b,t)
  for sign in [-1,1]:
   q=p+Vector((-dr.y,dr.x)).normalized()*.0003*sign;origin=Vector((q.x,q.y,.105));hits=[]
   for j in range(5):
    hit,n,idx,d=body['tree'].ray_cast(origin,Vector((0,0,-1)),.3)
    if hit is None:break
    hits.append(hit.z);origin=hit+Vector((0,0,-1e-6))
   if len(hits)==2 and hits[0]>-.08 and hits[1]>-.10:wall.append({'xy':list(q),'verticalThickness':hits[0]-hits[1]})
result={'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'protectedMeshAndLocalTransformIdentities':{'nodes':protected,'passed':pre==post},'topology':topology,'staticAttachmentContacts':static_contacts,'unexpectedStaticContacts':unexpected,'feet':feet,'fuselageContainment':{'poses':13,'movingVerticesChecked':checked,'strictInside':contain,'nearestSampledMovingVertex':minNear,'note':'A sampled vertex distance is an upper bound on mesh minimum separation, not a global lower bound'},'threadPhase':phase,'localSlotRemainingWallVerticalSamples':{'samples':len(wall),'minimum':min(wall,key=lambda r:r['verticalThickness']) if wall else None,'maximum':max(wall,key=lambda r:r['verticalThickness']) if wall else None,'notGlobalOrNormalThickness':True},'passedLimitedChecks':not unexpected and not contain and all(v['nonmanifoldEdges']==0 and v['signedVolume']>0 for v in topology.values()) and pre==post and max(abs(p['residual'])for p in phase)<1e-5}
(OUT/'SUPPORT_SLOT_CONTAINMENT_CHECK.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2),flush=True)
assert result['passedLimitedChecks'], 'Current limited internal support/containment check failed'
