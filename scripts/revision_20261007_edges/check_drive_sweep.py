import bpy,sys,os,json,math,time,hashlib,itertools
from pathlib import Path
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007-inset/edge-linkage-checks';OUT.mkdir(parents=True,exist_ok=True);sys.path.insert(0,str(ROOT/'scripts'));import kinematics
LABEL=os.environ.get('VERIFY_LABEL','candidate-detail-inset-skin-h');STEP=float(os.environ.get('VERIFY_STEP','.1'));source=ROOT/'qa/revision-20261007'/(LABEL+'.blend');bpy.ops.wm.open_mainfile(filepath=str(source));kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
repair=None
if os.environ.get('VERIFY_REPAIR')=='1':
 from revision_20261007_inset.repair_drive_phase import synchronize_lead_screw_phase
 repair=synchronize_lead_screw_phase();print('REPAIR',json.dumps(repair),flush=True)
 LABEL+='-phase-fixed-in-memory'
def group(o):
 p=o
 while p:
  if p.name.startswith('WingPivot_'):return p.name
  if p.name in ['BraceRod_L','BraceRod_R','BraceSpreader','Drive_ScrewRotor','Drive_MotorRotor'] or p.name.startswith('Drive_PlanetRotor_'):return p.name
  p=p.parent
 return 'fixed'
meshes={}
for o in bpy.data.objects:
 if o.type!='MESH':continue
 g=group(o)
 if g.startswith('WingPivot_'):continue
 o.data.calc_loop_triangles();meshes[o.name]={'o':o,'group':g,'local':np.array([tuple(v.co)for v in o.data.vertices]),'tri':[tuple(t.vertices)for t in o.data.loop_triangles]}
moving=[n for n,m in meshes.items()if m['group']in ['BraceSpreader','BraceRod_L','BraceRod_R']]
pairs=[(a,b)for a,b in itertools.combinations(meshes,2)if (a in moving or b in moving)and meshes[a]['group']!=meshes[b]['group']]
print('SCOPE',len(meshes),len(moving),len(pairs),flush=True)
static={};contacts={};angles=np.linspace(0,120,round(120/STEP)+1).tolist();start=time.time();broad=0;minimum={};poses=[]
def snapshot(m):
 mat=np.array(m['o'].matrix_world);p=m['local']@mat[:3,:3].T+mat[:3,3];return {'pts':p,'min':p.min(axis=0),'max':p.max(axis=0),'tree':None}
def tree(n,s):
 if s['tree'] is None:s['tree']=BVHTree.FromPolygons(s['pts'].tolist(),meshes[n]['tri'],all_triangles=True)
 return s['tree']
for i,angle in enumerate(angles):
 for side,sg in [('L',-1),('R',1)]:
  o=bpy.data.objects['WingPivot_'+side];o.rotation_mode='QUATERNION';o.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 bpy.context.view_layer.update();kinematics.update_linkage();snap={}
 for n,m in meshes.items():
  if m['group']=='fixed':
   if n not in static:static[n]=snapshot(m)
   snap[n]=static[n]
  else:snap[n]=snapshot(m)
 for a,b in pairs:
  aa,bb=snap[a],snap[b]
  if np.any(aa['max']<bb['min'])or np.any(bb['max']<aa['min']):continue
  broad+=1;hits=tree(a,aa).overlap(tree(b,bb))
  if hits:
   key=a+' / '+b
   if key not in contacts:contacts[key]={'firstAngle':angle,'lastAngle':angle,'poses':0,'maxTrianglePairs':0,'maximumAtAngle':angle};print('CONTACT',key,angle,len(hits),flush=True)
   c=contacts[key];c['lastAngle']=angle;c['poses']+=1
   if len(hits)>c['maxTrianglePairs']:c['maxTrianglePairs']=len(hits);c['maximumAtAngle']=angle
 y=bpy.data.objects['BraceSpreader'].location.y
 for side in ['L','R']:
  bush=snap['Drive_GuideBushing_'+side];front=snap['Drive_FrontTravelStop_'+side];rear=snap['Drive_RearTravelStop_'+side];rail=snap['Drive_GuideRail_'+side]
  for key,val in [('frontStopGap_'+side,bush['min'][1]-front['max'][1]),('rearStopGap_'+side,rear['min'][1]-bush['max'][1]),('guideFrontEngagementMargin_'+side,bush['min'][1]-rail['min'][1]),('guideRearEngagementMargin_'+side,rail['max'][1]-bush['max'][1])]:
   if key not in minimum or val<minimum[key]['value']:minimum[key]={'value':float(val),'angle':angle}
 female=snap['Drive_NutInternalThread'];male=snap['Drive_LeadScrewThread']
 for key,val in [('threadFrontAxialMargin',female['min'][1]-male['min'][1]),('threadRearAxialMargin',male['max'][1]-female['max'][1])]:
  if key not in minimum or val<minimum[key]['value']:minimum[key]={'value':float(val),'angle':angle}
 if i%100==0:print('POSE',i,angle,'Y',y,'CONTACTS',len(contacts),'SECONDS',time.time()-start,flush=True)
 if i%100==0 or i==len(angles)-1:poses.append({'angle':angle,'sliderY':y})
result={'phaseRepair':repair,'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scope':'Actual world meshes; all BraceSpreader and BraceRod descendants versus every non-wing mesh of different rigid group. Same rigid body pairs omitted. Rotor meshes included as dynamic obstacles. Wing mesh sweep independently assessed elsewhere.','stepDegrees':STEP,'sampleCount':len(angles),'minimumMeasuredAxialMargins':minimum,'surfaceIntersections':contacts,'movingMeshes':moving,'obstacleMeshes':list(meshes),'pairCount':len(pairs),'broadPhaseCandidates':broad,'keyPoses':poses,'seconds':time.time()-start,'caveats':'BVH intersections prove surfaces intersect, not by themselves solid penetration. Intentional ball/socket interfaces and functional threads require separate evidence. Absence at samples is not a blanket continuous-motion certificate.'};(OUT/(LABEL+'-sweep.json')).write_text(json.dumps(result,indent=2));print('DONE',json.dumps(result['minimumMeasuredAxialMargins']),flush=True)

assert not contacts, 'Actual cross-body drive intersections detected'
assert all(row['value']>0 for row in minimum.values()), 'Drive axial margin exhausted'
