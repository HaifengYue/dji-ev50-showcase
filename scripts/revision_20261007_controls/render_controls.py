from pathlib import Path
import bpy,os,math
from mathutils import Vector,Quaternion
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'qa/revision-20261007-controls';out.mkdir(exist_ok=True)
label=os.environ.get('TRANSWING_CONTROLS_LABEL','candidate-inset-integrated-b-edge-linkage')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qa/revision-20261007'/(label+'.blend')))
s=bpy.context.scene
for o in bpy.data.objects:
 if o.animation_data:o.animation_data_clear()
 if o.type in ['LIGHT','CAMERA']:o.hide_render=True
s.render.engine='BLENDER_WORKBENCH';h=s.display.shading;h.light='STUDIO';h.color_type='MATERIAL';h.show_shadows=True;h.show_cavity=True;h.cavity_type='BOTH';h.show_specular_highlight=True;h.background_type='WORLD';s.world.color=(.55,.55,.55)
s.render.resolution_x=1350;s.render.resolution_y=600;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard'
d=bpy.data.cameras.new('ControlsReviewCamera');c=bpy.data.objects.new('ControlsReviewCamera',d);s.collection.objects.link(c);s.camera=c;d.type='ORTHO'
for angle in (0,12):
 if angle:
  p=bpy.data.objects['ControlPivot_L_Inboard'];q=bpy.data.objects['ControlAxisEnd_L_Inboard'].location-p.location;p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(q.normalized(),math.radians(angle))
 target=Vector((-2.71,-1.12,-.2));c.location=target+Vector((0,0,8));c.rotation_euler=(target-c.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=2.30
 s.render.filepath=str(out/(label+'-inboard-top-'+str(angle)+'.png'));bpy.ops.render.render(write_still=True)
