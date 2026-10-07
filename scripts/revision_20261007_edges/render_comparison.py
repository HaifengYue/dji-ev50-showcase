"""Same-camera native Blender inspection; no synthetic engineering imagery."""
from pathlib import Path
import bpy,sys,os,math
from mathutils import Vector,Quaternion
ROOT=Path(__file__).resolve().parents[2];OUT=Path(os.environ.get('TRANSWING_EDGE_RENDER_OUT',str(ROOT.parent/'renders')));OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'scripts'));import kinematics
LABEL=os.environ.get('TRANSWING_EDGE_LABEL','candidate-inset-integrated-b-edge-linkage')
for kind,label in [('before','candidate-inset-integrated-b'),('after',LABEL)]:
    if kind not in os.environ.get('TRANSWING_EDGE_RENDER_KINDS','before,after').split(','):continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'qa/revision-20261007'/(label+'.blend')))
    scene=bpy.context.scene
    for obj in bpy.data.objects:
        if obj.animation_data:obj.animation_data_clear()
        if obj.type in ['CAMERA','LIGHT']:obj.hide_render=True
    scene.render.engine='BLENDER_WORKBENCH';shade=scene.display.shading
    shade.light='STUDIO';shade.color_type='MATERIAL';shade.show_shadows=True;shade.show_cavity=True;shade.cavity_type='BOTH';shade.show_specular_highlight=True;shade.background_type='WORLD';scene.world.color=(.55,.55,.55)
    scene.render.resolution_x=1200;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard'
    cam_data=bpy.data.cameras.new('EngineeringReviewCamera');cam=bpy.data.objects.new('EngineeringReviewCamera',cam_data);scene.collection.objects.link(cam);scene.camera=cam;cam_data.type='ORTHO'
    kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
    views=[('hover-root-flat',120,(8,-1.8,.2),(1.37,-1.8,-.15),1.65,'MATERIAL'),('hover-root-side',120,(8,-3.5,1.5),(1.37,-1.75,-.15),1.65,'MATERIAL'),('cruise-top',0,(0,-1.35,8),(0,-1.35,0),4.3,'MATERIAL'),('hover-root-gray',120,(8,-1.8,.2),(1.37,-1.8,-.15),1.65,'SINGLE'),('under-conversion',30,(2,-3,-3),(1.05,-1.37,-.19),2.3,'SINGLE')]
    if kind=='after':views.append(('internal-drive',120,(1.5,2.7,1.4),(0,1.05,0),1.6,'MATERIAL'))
    for name,angle,loc,target,scale,color in views:
        shade.color_type=color;shade.single_color=(.65,.65,.65)
        for side,sg in [('L',-1),('R',1)]:
            pivot=bpy.data.objects['WingPivot_'+side];pivot.rotation_mode='QUATERNION';pivot.rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
            for end in ['Front','Rear']:
                for leaf,fs in [('A',-1),('B',1)]:
                    prop=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];prop.rotation_mode='XYZ';prop.rotation_euler=(0,fs*math.pi/2 if angle==120 else 0,0)
        if name=='internal-drive':
            for obj in bpy.data.objects:
                if obj.type=='MESH' and not obj.name.startswith(('Drive_','Brace')):obj.hide_render=True
        bpy.context.view_layer.update();kinematics.update_linkage()
        cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam_data.ortho_scale=scale
        scene.render.filepath=str(OUT/(kind+'-'+name+'.png'));bpy.ops.render.render(write_still=True)
