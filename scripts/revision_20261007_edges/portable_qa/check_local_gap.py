from pathlib import Path
import bpy,sys,json,hashlib,numpy as np
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from qa_context import bootstrap
C=bootstrap();from rebuild_rear_corner_flat import _tree
bpy.ops.wm.open_mainfile(filepath=str(C.candidate));rows=[]
for side,sg in [('L',-1),('R',1)]:
 mt=_tree(bpy.data.objects['Composite_wing_'+side]);ft=_tree(bpy.data.objects['Fixed_root_'+side]);samples=[]
 for x in np.arange(.665,.751,.001):
  for y in np.arange(-1.04,-.965,.001):
   m=mt.ray_cast(Vector((sg*x,y,1)),Vector((0,0,-1)),2);f=ft.ray_cast(Vector((sg*x,y,-1)),Vector((0,0,1)),2);up=ft.ray_cast(Vector((sg*x,y,1)),Vector((0,0,-1)),2)
   if m[0] is None or f[0] is None:continue
   samples.append({'x':sg*float(x),'y':float(y),'gap':f[0].z-m[0].z,'fixedVerticalWall':up[0].z-f[0].z,'movingTop':m[0].z,'fixedBottom':f[0].z})
 rows.append({'side':side,'samples':len(samples),'minimumGap':min(samples,key=lambda r:r['gap']),'below003Count':sum(r['gap']<.003 for r in samples),'lowestWitnesses':sorted(samples,key=lambda r:r['gap'])[:12]})
report={'schema':'transwing.local-rear-static-layer-gap.v1','sourceSha256':hashlib.sha256(C.candidate.read_bytes()).hexdigest(),'rows':rows,'passed':all(r['below003Count']==0 for r in rows),'scope':'Finite 0.001u XY grid of vertical separation in the modified rear overlap region; not a global Euclidean or continuous-motion certificate'}
(C.output/'static-rear-gap.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));assert report['passed']
