import bpy,sys,math
from pathlib import Path
from mathutils import Vector
p=Path(sys.argv[sys.argv.index('--')+1]);sc=bpy.context.scene;sc.render.engine='BLENDER_WORKBENCH';sc.display.shading.light='STUDIO';sc.display.shading.studiolight_rotate_z=.45;sc.display.shading.color_type='MATERIAL';sc.display.shading.show_shadows=True;sc.display.shading.show_cavity=True;sc.display.shading.cavity_type='BOTH';sc.display.shading.curvature_ridge_factor=.65;sc.display.shading.curvature_valley_factor=.7;sc.display.shading.background_type='WORLD';sc.world.color=(.18,.20,.23);sc.display.shading.show_specular_highlight=True
cam=bpy.data.cameras.new('LinkageAuditCamera');ob=bpy.data.objects.new('LinkageAuditCamera',cam);sc.collection.objects.link(ob);sc.camera=ob;cam.type='ORTHO';cam.ortho_scale=1.75;target=Vector((.08,1.02,.025));ob.location=(2.45,1.6,1.0);ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
# Pose is the current native cruise instance, unchanged between before/after.
sc.render.resolution_x=1600;sc.render.resolution_y=950;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.filepath=str(p.resolve());bpy.ops.render.render(write_still=True)
