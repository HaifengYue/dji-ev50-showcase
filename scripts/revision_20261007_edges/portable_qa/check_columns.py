from pathlib import Path
import bpy,sys,json,hashlib
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap(require_baseline=True)
R=Q.project.parent.parent;W=Q.output;P=Q.project/'scripts';CANDIDATE=Q.candidate;BASELINE=Q.baseline
from rebuild_rear_corner_flat import _tree
out=[]
for label,path in [('candidate',CANDIDATE),('baseline',BASELINE)]:
 bpy.ops.wm.open_mainfile(filepath=str(path))
 for side,sg in [('L',-1),('R',1)]:
  tree=_tree(bpy.data.objects['Composite_wing_'+side]);count=0;bad=[];short=[]
  for i in range(101):
   x=.65+.005*i
   for j in range(80):
    y=-1.795+.0025*j;z=-1;hits=[]
    for k in range(8):
     p,n,idx,d=tree.ray_cast(Vector((sg*x,y,z)),Vector((0,0,1)),2)
     if p is None:break
     hits.append({'z':p.z,'normalZ':n.z,'triangle':idx});z=p.z+2e-6
    if not hits:continue
    count+=1;signs=[1 if h['normalZ']>1e-5 else -1 if h['normalZ']<-1e-5 else 0 for h in hits]
    if len(signs)%2 or any(v!=(-1 if q%2==0 else 1)for q,v in enumerate(signs)):bad.append({'x':x,'y':y,'hits':hits,'signs':signs})
    if len(hits)>1 and hits[1]['z']-hits[0]['z']<.010:short.append({'x':x,'y':y,'lowestVerticalMaterial':hits[1]['z']-hits[0]['z'],'hits':hits})
  row={'label':label,'side':side,'columnsIntersecting':count,'nonalternatingColumnCount':len(bad),'nonalternatingWitnesses':bad[:20],'lowerVerticalSegmentsUnder010':len(short),'shortestVerticalWitnesses':sorted(short,key=lambda r:r['lowestVerticalMaterial'])[:20]};out.append(row);print('COLUMNS',label,side,count,len(bad),len(short),flush=True)
(W/'columns.json').write_text(json.dumps({'candidateSha256':hashlib.sha256((CANDIDATE).read_bytes()).hexdigest(),'rays':out,'boundary':'Finite vertical rays with 2e-6 start advance and 1e-5 normal-z classification. All initial face orientations retained, no primary-wall filtering.'},indent=2))
