"""Independent static inspection of current controls against accepted native geometry.
No output asset serves as construction input; this is only a comparison gate.
"""
from pathlib import Path
import bpy,bmesh,os,sys,hashlib,json,math
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'scripts'),str(Path(__file__).parent)]
from enlarge_inboard import fingerprint,audit
LABEL=os.environ.get('TRANSWING_CONTROLS_LABEL','candidate-inset-integrated-b-independent-controls-final');QA=ROOT/'qa/revision-20261007';OUT=ROOT/'qa/revision-20261007-controls';BASE=QA/'candidate-inset-integrated-b-edge-linkage.blend';SOURCE=QA/(LABEL+'.blend')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
keys=['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R']
def xy_hull_area(o):
 pts=sorted(set((float((o.matrix_world@v.co).x),float((o.matrix_world@v.co).y))for v in o.data.vertices))
 def cross(o,a,b):return(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
 lo=[];hi=[]
 for p in pts:
  while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0:lo.pop()
  lo.append(p)
 for p in reversed(pts):
  while len(hi)>=2 and cross(hi[-2],hi[-1],p)<=0:hi.pop()
  hi.append(p)
 hull=lo[:-1]+hi[:-1];return abs(sum(a[0]*b[1]-a[1]*b[0]for a,b in zip(hull,hull[1:]+hull[:1])))/2

def read():
 bpy.context.view_layer.update();mesh={o.name:fingerprint(o)for o in bpy.data.objects if o.type=='MESH'};controls={}
 for key in keys:
  p=bpy.data.objects['ControlPivot_'+key];a=bpy.data.objects['ControlAxisStart_'+key];b=bpy.data.objects['ControlAxisEnd_'+key];o=bpy.data.objects['ControlSurface_'+key]
  controls[key]={'parent':p.parent.name if p.parent else None,'axisStart':list(a.location),'axisEnd':list(b.location),'axis':list((b.location-a.location).normalized()),'detailAxis':list(p['detailAxis']),'detailSign':p['detailSign'],'detailRange':list(p['detailRange']),'worldStart':list(a.matrix_world.translation),'worldEnd':list(b.matrix_world.translation),'span':(b.location-a.location).length,'surfaceParent':o.parent.name,'surfaceVolume':audit(o)['signedVolume'],'projectedConvexXYArea':xy_hull_area(o)}
 return mesh,controls
bpy.ops.wm.open_mainfile(filepath=str(BASE));before,old=read();bpy.ops.wm.open_mainfile(filepath=str(SOURCE));after,new=read()
construction=json.loads((OUT/(LABEL+'-construction.json')).read_text());assert construction['sourceSha256']==sha(SOURCE)
allowed=set(construction['receipt']['changedMeshNodes'])|set(construction['shellDetails']['changedNodes']);changed=[n for n in before if before[n]!=after.get(n)];assert set(changed)==allowed,(set(changed)-allowed,allowed-set(changed));assert before.keys()==after.keys()
rows=[]
for key in keys:
 a,b=old[key],new[key]
 for field in ['parent','surfaceParent','detailAxis','detailSign','detailRange','axisEnd','worldEnd']:assert a[field]==b[field],(key,field)
 if key.endswith('Inboard'):
  assert abs(b['span']/a['span']-1.5)<1e-6
  assert Vector(a['axis']).cross(Vector(b['axis'])).length<1e-6
  assert (Vector(b['axisStart'])-Vector(a['axisStart'])).cross(Vector(a['axis'])).length<1e-6
 else:assert a==b,key
 shell={stem:audit(bpy.data.objects[stem+key])for stem in ['ControlSurface_','ControlFlexureMoving_','ControlFlexureFixed_','ControlHingeMoving_','ControlHingeFixed_']}
 for name,r in shell.items():assert r['nonManifoldEdges']==0 and r['zeroAreaFaces']==0 and r['signedVolume']>0,(key,name,r)
 rows.append({'key':key,'before':a,'after':b,'spanRatio':b['span']/a['span'],'projectedXYAreaRatio':b['projectedConvexXYArea']/a['projectedConvexXYArea'],'nativeClosedParts':shell})
report={'schema':'transwing.enlarged-controls.static-native-gate.v1','sourceBlendSha256':sha(SOURCE),'baselineSha256':sha(BASE),'controlRows':rows,'changedMeshNodes':changed,'unaffectedMeshCount':len(before)-len(changed),'allUnaffectedWorldGeometryExact':True,'twoHingeLinesAndOuterEndpointsUnchanged':True,'sixControlIdsAndParentsPreserved':True,'passed':True,'claimBoundary':'Static closed native geometry, exact world-coordinate comparison outside named changes, and control semantics only; independent full-motion material sweeps are separate.'}
(OUT/(LABEL+'-geometry-check.json')).write_text(json.dumps(report,indent=2)+'\n');print('STATIC_CONTROL_GATE',json.dumps({'passed':True,'source':report['sourceBlendSha256'],'changed':len(changed),'unaffected':report['unaffectedMeshCount'],'ratios':{r['key']:r['projectedXYAreaRatio']for r in rows}}),flush=True)
