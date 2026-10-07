from pathlib import Path
import bpy,sys,json,hashlib
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap(require_baseline=False)
R=Q.project.parent.parent;W=Q.output;P=Q.project/'scripts';CANDIDATE=Q.candidate;BASELINE=Q.baseline
from rebuild_rear_corner_flat import _tree
bpy.ops.wm.open_mainfile(filepath=str(CANDIDATE));rows=[]
for side,sg,y in [('L',-1,-1.795),('R',1,-1.7925)]:
 tree=_tree(bpy.data.objects['Composite_wing_'+side])
 for dx in [-1e-5,-1e-6,0,1e-6,1e-5,.0001]:
  x=.765+dx;z=-1;hits=[]
  for k in range(12):
   p,n,idx,d=tree.ray_cast(Vector((sg*x,y,z)),Vector((0,0,1)),2)
   if p is None:break
   hits.append({'z':p.z,'normalZ':n.z,'face':idx});z=p.z+2e-6
  rows.append({'side':side,'absX':x,'y':y,'dx':dx,'hits':hits});print(side,dx,[(round(h['z'],8),round(h['normalZ'],5))for h in hits],flush=True)
(W/'boundary-columns.json').write_text(json.dumps({'candidateSha256':hashlib.sha256((CANDIDATE).read_bytes()).hexdigest(),'rows':rows},indent=2))
