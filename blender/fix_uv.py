import bpy
from pathlib import Path
P=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(P/'models/v05/ev50_v05.blend'))
root=bpy.data.objects['EV50_Root']
for o in root.children_recursive:
 if o.type=='MESH' and not o.data.uv_layers:
  uv=o.data.uv_layers.new(name='Surface_UV')
  for poly in o.data.polygons:
   for li in poly.loop_indices:
    co=o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=(co.x*12+co.z*12,co.y*12)
bpy.ops.wm.save_as_mainfile(filepath=str(P/'models/v05/ev50_v05.blend'))
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for o in root.children_recursive:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(P/'models/v05/ev50_v05.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True)
