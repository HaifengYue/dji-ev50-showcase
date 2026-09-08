import bpy,math,sys,json,random
from pathlib import Path
from mathutils import Vector,Euler
P=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(P/'models/v05/ev50_v05.blend'))
sc=bpy.context.scene;root=bpy.data.objects['EV50_Root']
data=json.loads((P/'threejs/public/flight.json').read_text());frames=data['frames']
sc.frame_start=1;sc.frame_end=1800;sc.render.fps=30
for o in root.children_recursive:o.animation_data_clear()
root.rotation_mode='ZXY'
for i,f in enumerate(frames):
 x,h,z=f['position'];root.location=(x,-z,h);root.rotation_euler=(f['pitch'],-f['roll'],f['yaw'])
 root.keyframe_insert('location',frame=i+1);root.keyframe_insert('rotation_euler',frame=i+1)
root.animation_data.action.name='EV50_Flight_60s'
def mat(n,c,rough=1):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;return m
groundmat=mat('Highland_Grass',(.12,.19,.15));padmat=mat('Landing_Concrete',(.22,.26,.25));line=mat('Landing_Marking',(.8,.82,.61))
def addmesh(n,v,f,m):
 d=bpy.data.meshes.new(n);d.from_pydata(v,[],f);d.update();o=bpy.data.objects.new(n,d);sc.collection.objects.link(o);o.data.materials.append(m);return o
bpy.ops.mesh.primitive_plane_add(size=1600,location=(0,0,-.08));bpy.context.object.data.materials.append(groundmat);bpy.context.object.name='Highland_Ground'
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=6,depth=.09,location=(0,0,-.035));bpy.context.object.name='Landing_Pad';bpy.context.object.data.materials.append(padmat)
def ring(name,rad,width,z):
 v=[];f=[]
 for i in range(96):
  t=i*2*math.pi/96
  for r in [rad,rad+width]:v.append((r*math.cos(t),r*math.sin(t),z))
 for i in range(96):a=i*2;b=((i+1)%96)*2;f.append((a,a+1,b+1,b))
 return addmesh(name,v,f,line)
ring('Pad_Ring',4.8,.10,.013)
for loc,scale in [((-1,0,.015),(.14,2,.015)),((1,0,.015),(.14,2,.015)),((0,0,.015),(1.1,.12,.015))]:
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name='Pad_H';o.scale=scale;o.data.materials.append(line)
# Broad encircling ridges leave the entire flight corridor clear.
random.seed(50)
for k in range(3):
 m=mat('Ridge_'+str(k),[(.17,.23,.23),(.24,.32,.35),(.33,.43,.49)][k]);v=[];faces=[];N=160
 for j in range(N+1):
  for i in range(N+1):
   a=i*2*math.pi/N;r=300+k*100+j*1.3;x=r*math.cos(a);y=r*math.sin(a)
   h=(42+46*math.sin(a*3+k*1.3)**2+26*math.sin(a*7+k)**2+10*math.sin(a*17+r*.038)+5*math.sin(a*41+r*.18))
   h*=math.sin(math.pi*j/N)**.7;h+=k*8
   v.append((x,y,h))
 for j in range(N):
  for i in range(N):a=j*(N+1)+i;faces.extend([(a,a+1,a+N+2),(a,a+N+2,a+N+1)])
 ridge=addmesh('Mountain_Range_'+str(k),v,faces,m)
 for poly in ridge.data.polygons:poly.use_smooth=True
# Scattered local rocks use instanced geometry.
rockmat=mat('Basalt',(.18,.21,.20))
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1);base=bpy.context.object;base.name='Rock_000';base.data.materials.append(rockmat)
for i in range(90):
 o=base if i==0 else bpy.data.objects.new('Rock_'+str(i),base.data)
 if i:sc.collection.objects.link(o)
 a=random.uniform(0,2*math.pi);r=random.uniform(8,85);o.location=(r*math.cos(a),r*math.sin(a),.03);s=random.uniform(.12,.45);o.scale=(s,s*.7,s*.45)
# Fine procedural terrain shading and layered conifer instances.
for m in [groundmat,rockmat]+[bpy.data.materials['Ridge_'+str(k)] for k in range(3)]:
 nodes=m.node_tree.nodes;links=m.node_tree.links;bs=nodes.get('Principled BSDF')
 tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=7;tex.inputs['Detail'].default_value=4
 ramp=nodes.new('ShaderNodeValToRGB');base=tuple(m.diffuse_color[:3]);ramp.color_ramp.elements[0].color=(*(c*.60 for c in base),1);ramp.color_ramp.elements[1].color=(*(min(1,c*1.35) for c in base),1)
 links.new(tex.outputs['Fac'],ramp.inputs['Fac']);links.new(ramp.outputs['Color'],bs.inputs['Base Color'])
 bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.23;bump.inputs['Distance'].default_value=.08;links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bs.inputs['Normal'])
foliage=mat('Pine_Needles',(.065,.115,.073));bark=mat('Pine_Bark',(.13,.095,.063))
# Share the same layered mesh between all trees.
parts=[]
for rad,depth,z in [(1.35,2.9,2.4),(1.05,2.7,3.7),(.65,2.1,4.85)]:
 bpy.ops.mesh.primitive_cone_add(vertices=9,radius1=rad,depth=depth,location=(0,0,z));o=bpy.context.object;o.data.materials.append(foliage);parts.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();tree=parts[0]
bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
for i in range(350):
 o=tree if i==0 else bpy.data.objects.new('Pine_'+str(i),tree.data)
 if i:sc.collection.objects.link(o)
 a=random.uniform(0,math.tau);r=random.uniform(30,230);o.location=(r*math.cos(a),r*math.sin(a),-.04);s=random.uniform(.65,1.1);o.scale=(s,s,s);o.rotation_euler.z=random.uniform(0,math.tau)
# A winding stream and its gravel banks occupy the western side of the valley.
for width,material in [(5.5,mat('Stream_Gravel',(.28,.29,.24))),(3.2,mat('Stream_Water',(.08,.20,.22),.20))]:
 v=[];f=[]
 for i in range(241):
  y=-360+i*3;x=-42+12*math.sin(y*.018)+5*math.sin(y*.042)
  v.extend([(x-width,y,-.045),(x+width,y,-.045)])
  if i<240:a=i*2;f.append((a,a+1,a+3,a+2))
 addmesh('Stream',v,f,material)
# Lighting and atmospheric background.
for o in list(sc.objects):
 if o.type=='LIGHT':bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.object.light_add(type='SUN',location=(0,0,40));sun=bpy.context.object;sun.name='Afternoon_Sun';sun.rotation_euler=(.45,-.55,-.6);sun.data.energy=2.3;sun.data.angle=.12
bpy.ops.object.light_add(type='SUN');fill=bpy.context.object;fill.name='Sky_Fill';fill.rotation_euler=(.3,.7,2.8);fill.data.energy=.65;fill.data.use_shadow=False
sc.world.use_nodes=True;bg=sc.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.30,.46,.62,1);bg.inputs[1].default_value=.6
cam=sc.camera;cam.data.type='PERSP';cam.data.lens=40;cam.data.clip_end=2000
# Rotor motion blur discs fade in; their meshes never change per frame.
blurmat=mat('Rotor_Blur',(.14,.17,.19));bs=blurmat.node_tree.nodes.get('Principled BSDF');bs.inputs['Alpha'].default_value=.18
if hasattr(blurmat,'surface_render_method'):blurmat.surface_render_method='DITHERED'
rotors=[]
for o in list(root.children_recursive):
 if o.name.startswith(('LiftRotor_','CruiseRotor_')):
  radius=.58 if o.name.startswith('Lift') else .25
  bpy.ops.mesh.primitive_circle_add(vertices=64,radius=radius,fill_type='NGON');disc=bpy.context.object;disc.name='Blur_'+o.name;disc.parent=o;disc.location=(0,0,0);disc.data.materials.append(blurmat)
  parts=[c for c in o.children if 'Blade' in c.name or 'Tip' in c.name]
  rotors.append((o,disc,parts,o.rotation_euler.copy()))
def frame_update(scene):
 idx=min(1800,max(0,scene.frame_current-1));f=frames[idx];t=f['t'];p=root.location.copy();a=f['yaw']
 # Smoothly move from front three-quarter to side and distant flyover and back.
 wide=math.sin(math.pi*max(0,min(1,(t-24)/18)))**2 if 24<t<42 else 0
 dist=12+12*wide;az=a+(.68+.4*math.sin(t*.1));offset=Vector((math.sin(az)*dist,-math.cos(az)*dist,1.4+.4*wide))
 cam.location=p+offset+Vector((0,0,.6));cam.rotation_euler=(p+Vector((0,0,.7))-cam.location).to_track_quat('-Z','Y').to_euler()
 for o,disc,parts,base in rotors:
  power=f['lift'] if o.name.startswith('Lift') else f['cruise'];o.rotation_euler=base.copy();o.rotation_euler.z=(t*28*o.get('spin_sign',1)) if power>.04 else 0
  disc.hide_render=power<.18
  for part in parts:part.hide_render=power>=.18
bpy.app.handlers.frame_change_post.clear();bpy.app.handlers.frame_change_post.append(frame_update)
sc.render.engine='BLENDER_EEVEE';sc.render.resolution_x=1920;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
if hasattr(sc,'eevee') and hasattr(sc.eevee,'taa_render_samples'):sc.eevee.taa_render_samples=64
sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGB';sc.render.image_settings.compression=15
(P/'renders/flight_sequence_v03').mkdir(parents=True,exist_ok=True)
# Bake the camera, rotors and blur visibility so the saved .blend plays independently.
for i in range(0,1801,5):
 sc.frame_set(i+1);frame_update(sc)
 cam.keyframe_insert('location',frame=i+1);cam.keyframe_insert('rotation_euler',frame=i+1)
 for o,disc,parts,base in rotors:
  o.keyframe_insert('rotation_euler',frame=i+1);disc.keyframe_insert('hide_render',frame=i+1)
  disc.hide_viewport=disc.hide_render;disc.keyframe_insert('hide_viewport',frame=i+1)
  for part in parts:
   part.keyframe_insert('hide_render',frame=i+1);part.hide_viewport=part.hide_render;part.keyframe_insert('hide_viewport',frame=i+1)
sc.frame_set(1);frame_update(sc);sc.render.filepath=str(P/'renders/flight_sequence_v03/frame_')
bpy.ops.wm.save_as_mainfile(filepath=str(P/'models/ev50_flight_scene_v03.blend'))
# Render proof frames first; sequence mode can be resumed with --start N --end M.
if '--sequence' in sys.argv:
 start=int(sys.argv[sys.argv.index('--start')+1]) if '--start' in sys.argv else 1
 end=int(sys.argv[sys.argv.index('--end')+1]) if '--end' in sys.argv else 1800
 for i in range(start,end+1):
  target=P/'renders/flight_sequence_v03'/f'frame_{i:04d}.png'
  if target.exists():continue
  sc.frame_set(i);sc.render.filepath=str(target);bpy.ops.render.render(write_still=True)
else:
 for i in [1,301,601,961,1651]:
  sc.frame_set(i);sc.render.filepath=str(P/'previews'/f'flight_v03_{i:04d}.png');bpy.ops.render.render(write_still=True)
print('FLIGHT_RENDER_SUCCESS')

