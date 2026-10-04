"""只重建独立电机/电调功能资产，不触碰主机GLB或Blender源。
从同一生成器读取公用几何函数定义，避免维护两套几何实现。
"""
import bpy,bmesh,math,os,json,sys,ast
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));MODELS=ROOT+'/public/models'
sys.path.insert(0,ROOT+'/scripts')
# 只执行纯函数定义；不会执行主生成器的场景删除、建模或导出步骤。
source=ast.parse(open(ROOT+'/scripts/generate_transwing.py').read())
wanted={'material','mesh_object','empty','line','plate','ring_axis','cylinder_between'}
functions=ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name in wanted],type_ignores=[])
exec(compile(functions,'generate_transwing.py:geometry-helpers','exec'),globals())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
body=material('Concept Pearl Composite',(.63,.67,.70),.12,.37)
carbon=material('Concept Black Enclosure',(.012,.016,.023),.18,.27)
metal=material('Concept Alloy Hardware',(.36,.40,.43),.7,.3)
import airframe_accessories
for name in ('bpy','bmesh','math','os','Vector','Matrix','ROOT','MODELS','material','mesh_object','empty','line','plate','ring_axis','cylinder_between','body','carbon','metal'):
 setattr(airframe_accessories,name,globals()[name])
airframe_accessories.CONCEPT_KEEP=True
info=airframe_accessories.make_concept_module();print(info)
manifest_path=MODELS+'/manifest.json'
if os.path.exists(manifest_path):
    manifest=json.load(open(manifest_path));manifest.setdefault('airframeDetails',{})['conceptModule']=info
    json.dump(manifest,open(manifest_path,'w'),ensure_ascii=False,indent=2)
os.makedirs(ROOT+'/assets/blender/v10',exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/blender/nacelle-system-concept.blend')
import shutil
shutil.copy2(ROOT+'/assets/blender/nacelle-system-concept.blend',ROOT+'/assets/blender/v10/nacelle-system-concept.blend')
shutil.copy2(MODELS+'/nacelle-system-concept.glb',ROOT+'/assets/blender/v10/nacelle-system-concept-source.glb')
