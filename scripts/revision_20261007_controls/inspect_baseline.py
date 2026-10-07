from pathlib import Path
import bpy,json
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qa/revision-20261007/candidate-inset-integrated-b-edge-linkage.blend'))
rows=[]
for o in bpy.data.objects:
 if o.name.startswith(('Control','Composite_wing','Wing_blue_angular','Nacelle','Motor_','WingPivot')):
  pts=[o.matrix_basis@v.co for v in o.data.vertices] if o.type=='MESH' else [o.location]
  rows.append({'name':o.name,'parent':o.parent.name if o.parent else None,'loc':list(o.location),'bounds':[[min(p[k] for p in pts)for k in range(3)],[max(p[k] for p in pts)for k in range(3)]],'vertices':len(pts),'props':{k:o[k]for k in o.keys() if k.startswith('detail')}})
print(json.dumps(rows,ensure_ascii=False,default=list))
(ROOT/'qa/revision-20261007-controls/baseline-inventory.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2,default=list))
print('SCENE_KEYS',list(bpy.context.scene.keys()))
