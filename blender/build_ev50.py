import bpy
# Run inside Blender: blender -b --python build_ev50.py
bpy.ops.wm.read_factory_settings(use_empty=True)
def cube(n,loc,scale,mat=None):
 bpy.ops.mesh.primitive_cube_add(location=loc); o=bpy.context.object; o.name=n; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return o
def cyl(n,loc,r,d):
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=d,location=loc,rotation=(0,1.5708,0)); o=bpy.context.object; o.name=n; return o
body=cube('EV50_Fuselage',(0,0,1.8),(2.8,1.15,.7)); cargo=cube('Cargo_Bay',(0,0,1.45),(1.5,1.05,.35));
for s in (-1,1):
 w=cube(('Left' if s<0 else 'Right')+'_Main_Wing',(s*3.5,0,1.9),(1.8,.18,.12)); w.rotation_euler[2]=s*0.12
 for y in (-.78,.78):
  arm=cyl(('L' if s<0 else 'R')+'_Lift_Motor_'+str(y),(s*3.9,y,2.15),.18,.25); cyl(('L' if s<0 else 'R')+'_Lift_Rotor_'+str(y),(s*3.9,y,2.35),.75,.05)
for y in (-.65,.65): cube('Tail_Vertical_'+str(y),( -3.0,y,2.5),(.55,.12,1.0))
cyl('Cruise_Propulsion',(-3.25,0,1.8),.45,.35)
for x in (1.8,-1.8): cube('Landing_Gear_'+str(x),(x,0,.65),(.12,.12,.7))
bpy.ops.wm.save_as_mainfile(filepath='../models/dji_ev50_lowpoly.blend')
