from pathlib import Path
import bpy,sys,math,json,os
from mathutils import Vector,Quaternion
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap()
BASE=Q.project;OUT=Q.output;CANDIDATE=Q.candidate
bpy.ops.wm.open_mainfile(filepath=str(CANDIDATE));s=bpy.context.scene;s.frame_set(99)
for o in bpy.data.objects:
 if o.animation_data:o.animation_data_clear()
 if o.type in ['CAMERA','LIGHT']:o.hide_render=True
s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL';s.display.shading.show_shadows=True;s.display.shading.show_cavity=True;s.display.shading.cavity_type='BOTH';s.display.shading.show_specular_highlight=True;s.display.shading.background_type='WORLD';s.world.color=(.55,.55,.55)
s.render.resolution_x=1200;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard'
c=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',c);s.collection.objects.link(cam);s.camera=cam;c.type='ORTHO'
import kinematics
kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
for side,sg in [('L',-1),('R',1)]:
 p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(120))
 for end in ['Front','Rear']:
  for leaf,fs in [('A',-1),('B',1)]:
   prop=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];prop.rotation_mode='XYZ';prop.rotation_euler=(0,fs*math.pi/2,0)
bpy.context.view_layer.update();kinematics.update_linkage()
for label,loc,target,scale in [('hover-root-side',(8,-3.5,1.5),(1.37,-1.75,-.15),1.65),('hover-root-flat',(8,-1.8,.2),(1.37,-1.8,-.15),1.65)]:
 cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();c.ortho_scale=scale;s.render.filepath=str(OUT/('candidate-'+label+'.png'));bpy.ops.render.render(write_still=True)
print('ROOTVERTS',json.dumps({side:[list(bpy.data.objects['Composite_wing_'+side].matrix_world@v.co) for v in bpy.data.objects['Composite_wing_'+side].data.vertices if abs((bpy.data.objects['Composite_wing_'+side].matrix_world@v.co).y+1.415)<.01][:5] for side in ['L','R']}))
