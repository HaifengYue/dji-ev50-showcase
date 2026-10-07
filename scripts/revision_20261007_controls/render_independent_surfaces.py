"""Actual native oblique control poses; image labels are added separately."""
from pathlib import Path
import os,math,json,hashlib,bpy
from mathutils import Vector,Quaternion
ROOT=Path(__file__).resolve().parents[2]
LABEL=os.environ.get('TRANSWING_CONTROLS_LABEL','candidate-inset-integrated-b-independent-controls')
OUT=ROOT.parent/'control-renders';OUT.mkdir(exist_ok=True)
source=ROOT/'qa/revision-20261007'/(LABEL+'.blend');bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene
keys=['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R']
for o in bpy.data.objects:
 if o.animation_data:o.animation_data_clear()
 if o.type in ['CAMERA','LIGHT']:o.hide_render=True
for side in ['L','R']:
 p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0)
s.render.engine='BLENDER_WORKBENCH';h=s.display.shading;h.light='STUDIO';h.color_type='MATERIAL';h.show_shadows=False;h.show_cavity=True;h.cavity_type='BOTH';h.show_specular_highlight=True;h.background_type='WORLD';s.world.color=(.68,.68,.68)
s.render.resolution_x=720;s.render.resolution_y=480;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard';s.view_settings.exposure=.6
cd=bpy.data.cameras.new('IndependentSurfaceReviewCamera');cam=bpy.data.objects.new(cd.name,cd);s.collection.objects.link(cam);s.camera=cam;cd.type='ORTHO'
axes={key:(bpy.data.objects['ControlAxisEnd_'+key].location-bpy.data.objects['ControlAxisStart_'+key].location).normalized()for key in keys}
rows=[]
for key in keys:
 for k in keys:
  p=bpy.data.objects['ControlPivot_'+k];p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0)
 bpy.context.view_layer.update();obj=bpy.data.objects['ControlSurface_'+key];points=[obj.matrix_world@v.co for v in obj.data.vertices];lo=Vector(tuple(min(p[i]for p in points)for i in range(3)));hi=Vector(tuple(max(p[i]for p in points)for i in range(3)));target=(lo+hi)/2
 side=-1 if key.startswith('L_')or key=='Tail_L'else 1
 eye=target+Vector((side*.55,1.5,1.15));cam.location=eye;cam.rotation_euler=(target-eye).to_track_quat('-Z','Y').to_euler();cd.ortho_scale=max((hi-lo).length*1.18,.65)
 for degrees in [0,12]:
  p=bpy.data.objects['ControlPivot_'+key];p.rotation_quaternion=Quaternion(axes[key],p.get('detailSign',1)*math.radians(degrees));bpy.context.view_layer.update()
  name=key+'-'+str(degrees)+'.png';s.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True)
  rows.append({'id':key,'degrees':degrees,'allOtherControlDegrees':0,'tiltDegrees':0,'file':name,'cameraEye':list(eye),'target':list(target),'orthoScale':cd.ortho_scale,'poseSource':'Actual native pivot rotation about the node axis and stored sign'})
(OUT/'INDEPENDENT_RENDER_RECEIPT.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'originalGeometryAndMaterials':True,'displayExposure':.6,'rows':rows},indent=2)+'\n')
