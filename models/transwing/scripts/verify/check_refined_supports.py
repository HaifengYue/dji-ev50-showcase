from pathlib import Path
import bpy,bmesh,sys,json,math,hashlib,time
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
import argparse
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--expected-sha');p.add_argument('--baseline',type=Path);p.add_argument('--contract',type=Path,default=Path(__file__).with_name('current-linkage-qa-contract.json'));opts=p.parse_args(args)
SRC=opts.source.resolve();source_hash=hashlib.sha256(SRC.read_bytes()).hexdigest()
if opts.expected_sha and source_hash!=opts.expected_sha:raise ValueError('Candidate SHA mismatch')
contract=json.loads(opts.contract.read_text());assert contract['schema']=='transwing.current-linkage-qa-contract.v1'
sys.path.insert(0,str(Path(__file__).resolve().parent));import native_contract_qa as kinematics
bpy.ops.wm.open_mainfile(filepath=str(SRC))
assert len(bpy.data.objects)==contract['nodeCount'] and sum(o.type=='MESH'for o in bpy.data.objects)==contract['meshCount']
kinematics.configure(contract)
for o in bpy.data.objects:o.animation_data_clear()
for s in ['L','R']:bpy.data.objects['WingPivot_'+s].rotation_quaternion=Quaternion((1,0,0,0))
kinematics.hydrate_final_mechanism();bpy.context.view_layer.update();kinematics.update_linkage();receipt=json.loads(bpy.context.scene['annotationLinkageRefinementJSON'])
def snap(o):
 o.data.calc_loop_triangles();v=[o.matrix_world@p.co for p in o.data.vertices];t=[tuple(t.vertices)for t in o.data.loop_triangles];return {'o':o,'v':v,'t':t,'tree':BVHTree.FromPolygons(v,t,all_triangles=True),'lo':[min(p[k]for p in v)for k in range(3)],'hi':[max(p[k]for p in v)for k in range(3)]}
def components(o):
 p=list(o.data.vertices);adj={v.index:set()for v in p}
 for e in o.data.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
 left=set(adj);out=[]
 while left:
  q=[left.pop()];row=[]
  while q:
   i=q.pop();row.append(i)
   for j in adj[i]:
    if j in left:left.remove(j);q.append(j)
  out.append(row)
 return out
body=snap(bpy.data.objects['Fuselage']);dirs=[Vector((1,.113,.271)).normalized(),Vector((-.183,1,.419)).normalized(),Vector((.317,-.157,1)).normalized()]
def inside(p):
 states=[]
 for d in dirs:
  q=p.copy();cnt=0
  for i in range(100):
   hit,n,idx,dis=body['tree'].ray_cast(q,d,100)
   if hit is None:break
   cnt+=1;q=hit+d*1e-6
  states.append(cnt%2)
 return states
names=sorted(contract['requiredClearPowertrainOwners']);rows=[];topology={};fail=[]
for n in names:
 o=bpy.data.objects[n];m=snap(o);hits=m['tree'].overlap(body['tree']);cs=components(o);witnesses=[]
 for c in cs:
  p=m['v'][c[0]];states=inside(p);witnesses.append({'componentVertex':c[0],'point':list(p),'parity':states})
  if any(states):fail.append([n,'containment',states])
 if hits:fail.append([n,'surface',len(hits)])
 rows.append({'node':n,'bodySurfaceTrianglePairs':len(hits),'componentCount':len(cs),'componentMaterialParity':witnesses})
for n in names+['Fuselage','BraceWingSeat_L','BraceWingSeat_R','Drive_FrontFoot_L','Drive_FrontFoot_R','Drive_MotorFoot_L','Drive_MotorFoot_R']:
 o=bpy.data.objects[n];bm=bmesh.new();bm.from_mesh(o.data);topology[n]={'components':len(components(o)),'nonmanifoldEdges':sum(not e.is_manifold for e in bm.edges),'volume':bm.calc_volume(signed=True)};bm.free()
 if topology[n]['nonmanifoldEdges']or topology[n]['volume']<=0:fail.append([n,'invalidTopology'])
feet=[]
for label,top,host in [('Front',.051,'Drive_FrontSupport'),('Motor',.034,'Drive_MotorMount')]:
 for s in ['L','R']:
  n='Drive_'+label+'Foot_'+s;o=bpy.data.objects[n];m=snap(o);hp=snap(bpy.data.objects[host]);foot_body=m['tree'].overlap(body['tree']);foot_host=m['tree'].overlap(hp['tree']);em=[]
  for p in m['v']:
   if p.z<top-1e-5:
    h=body['tree'].ray_cast(Vector((p.x,p.y,.08)),Vector((0,0,-1)),1);assert h[0] is not None;em.append(h[0].z-p.z)
  feet.append({'node':n,'host':host,'bodyTrianglePairs':len(foot_body),'hostTrianglePairs':len(foot_host),'floorEmbedMin':min(em),'floorEmbedMax':max(em),'finiteFootprintSamples':len(em),'contactClassification':'Only the measured .0006 finite floor-attachment depth at this specific foot is intended material overlap'})
  if not foot_body or not foot_host or min(em)<.00059 or max(em)>.00061:fail.append([n,'foot'])
core=snap(bpy.data.objects['Drive_LeadScrewCore']);core_connections=[]
for n in ['Drive_LeadScrewThread','Drive_OutputCoupling','Drive_PlanetCarrier']:
 m=snap(bpy.data.objects[n]);pairs=core['tree'].overlap(m['tree']);core_connections.append({'node':n,'trianglePairs':len(pairs),'intendedRigidAttachment':True})
 if not pairs:fail.append([n,'disconnectedCore'])
from native_contract_qa import _helix_phase
phase=[];thread_contacts=[];mins={};slot_contacts=[]
for i in range(241):
 angle=i*.5
 for s,sg in [('L',-1),('R',1)]:bpy.data.objects['WingPivot_'+s].rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 bpy.context.view_layer.update();kinematics.update_linkage();male=snap(bpy.data.objects['Drive_LeadScrewThread']);female=snap(bpy.data.objects['Drive_NutInternalThread']);core=snap(bpy.data.objects['Drive_LeadScrewCore']);nut=snap(bpy.data.objects['Drive_NutCarriage']);inv=bpy.data.objects['Drive_ScrewRotor'].matrix_world.inverted();mp,ms=_helix_phase(male['o'],inv);fp,fs=_helix_phase(female['o'],inv);phase.append({'angle':angle,'residual':math.remainder(fp-mp-math.pi,2*math.pi),'scatter':max(ms,fs)})
 for a,b,label in [(male,female,'male/female functional threads'),(core,female,'core/female bore'),(male,nut,'male/nut outer carriage')]:
  pairs=a['tree'].overlap(b['tree'])
  if pairs:thread_contacts.append({'angle':angle,'pair':label,'trianglePairs':len(pairs)})
 for label,val in [('threadFront',female['lo'][1]-male['lo'][1]),('threadRear',male['hi'][1]-female['hi'][1])]:
  if label not in mins or val<mins[label]['value']:mins[label]={'value':val,'angle':angle}
 for s in ['L','R']:
  bush=snap(bpy.data.objects['Drive_GuideBushing_'+s]);rail=snap(bpy.data.objects['Drive_GuideRail_'+s]);stop=snap(bpy.data.objects['Drive_FrontTravelStop_'+s]);bearing=snap(bpy.data.objects['Drive_FrontScrewBearing'])
  for label,val in [('bushingGuideFront_'+s,bush['lo'][1]-rail['lo'][1]),('frontStopGap_'+s,bush['lo'][1]-stop['hi'][1]),('nutBearingGap_'+s,nut['lo'][1]-bearing['hi'][1])]:
   if label not in mins or val<mins[label]['value']:mins[label]={'value':val,'angle':angle}
 for o in bpy.data.objects:
  if o.type=='MESH'and o.parent and o.parent.name in ['BraceRod_R','BraceRod_L','BraceSpreader']:
   m=snap(o);pairs=m['tree'].overlap(body['tree'])
   if pairs:slot_contacts.append({'node':o.name,'angle':angle,'trianglePairs':len(pairs)})
 if i%60==0:print('POSE',angle,'functionalContacts',len(thread_contacts),'slotContacts',len(slot_contacts),flush=True)
wall=[];outline=receipt['slotRelief']['outlineRightXY']
for a,b in zip(outline,outline[1:]+outline[:1]):
 a,b=Vector(a),Vector(b);d=b-a
 if d.length<1e-8:continue
 for t in [i/4 for i in range(5)]:
  p=a.lerp(b,t)+Vector((d.y,-d.x)).normalized()*.0003;origin=Vector((p.x,p.y,.105));hs=[]
  for j in range(5):
   hit,no,ix,ds=body['tree'].ray_cast(origin,Vector((0,0,-1)),.3)
   if hit is None:break
   hs.append(hit.z);origin=hit+Vector((0,0,-1e-6))
  if len(hs)==2 and all(-.15<z<.106 for z in hs):wall.append({'xy':list(p),'verticalThickness':hs[0]-hs[1]})
res={'sourceSha256':source_hash,'actualMovedPowertrainAgainstHull':rows,'topology':topology,'feet':feet,'coreAttachments':core_connections,'phase':phase,'threadFunctionalContacts':thread_contacts,'actualSweepHullContacts':slot_contacts,'minimumAxialMargins':mins,'slotBoundaryVerticalWallSamples':{'count':len(wall),'min':min(wall,key=lambda r:r['verticalThickness'])if wall else None,'max':max(wall,key=lambda r:r['verticalThickness'])if wall else None,'scope':'Finite vertical samples outside new slot only, not normal wall certification'},'failures':fail,'passedLimitedChecks':not fail and not thread_contacts and not slot_contacts and max(abs(r['residual'])for r in phase)<1e-5,'scope':'Every moved powertrain mesh against actual hull surfaces plus every connected component material parity; intended foot and rigid shaft attachments separately measured. Actual male/female mesh zero intersections at 241 poses with no functional-thread exception. Finite tests, independent complete airframe QA remains required.'};opts.output.parent.mkdir(parents=True,exist_ok=True);res['contractSha256']=hashlib.sha256(opts.contract.read_bytes()).hexdigest();res['contractPath']=str(opts.contract.resolve());res['baselineRequired']=False;opts.output.write_text(json.dumps(res,indent=2));print(json.dumps({k:v for k,v in res.items()if k not in ['phase','actualMovedPowertrainAgainstHull','topology']},indent=2),flush=True)

if not res['passedLimitedChecks']:raise SystemExit('Current native linkage checks failed')
