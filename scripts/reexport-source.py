"""重新导出已保存的Blender源；核验阶段不重建、不重新烘焙。"""
import bpy,os,runpy
root=os.getcwd();bpy.ops.wm.open_mainfile(filepath=os.path.join(root,'assets/blender/xp4.blend'))
assert 'BraceSpreader' in bpy.data.objects and 'WingPivot_L' in bpy.data.objects
ns=runpy.run_path(os.path.join(root,'scripts/export-transition.py'),run_name='qa_export')
ns['export_transition'](os.path.join(root,'qa/current/author/source-reexport.glb'))
