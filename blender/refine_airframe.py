"""Reference-led taildragger correction. Blender -b --python blender/refine_airframe.py."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

P=Path(__file__).resolve().parents[1]
OUT=P/'models/v12'; PRE=P/'previews/v12'
OUT.mkdir(parents=True,exist_ok=True); PRE.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(P/'models/v09/ev50_v09.blend'))
sc=bpy.context.scene;sc.frame_set(1);root=bpy.data.objects['EV50_Root']
root['visual_asset_version']='v12';root['landing_gear_layout']='taildragger: two forward mains and one central tail wheel'
carbon=bpy.data.materials['Composite_Carbon'];metal=bpy.data.materials['Motor_Anodized_Aluminium'];rubber=bpy.data.materials['Rubber_Shoes']
for node in carbon.node_tree.nodes:
 if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.12
for o in list(root.children_recursive):
 if o.name.startswith(('Gear_','Cooling_Ring_')):bpy.data.objects.remove(o,do_unlink=True)

def mesh(name,verts,faces,mat):
 data=bpy.data.meshes.new(name+'_Mesh');data.from_pydata(verts,[],faces);data.update()
 obj=bpy.data.objects.new(name,data);sc.collection.objects.link(obj);obj.parent=root;data.materials.append(mat)
 # Non-degenerate planar UVs for the original carbon weave.
 uv=data.uv_layers.new(name='Surface_UV')
 for poly in data.polygons:
  for li in poly.loop_indices:
   co=data.vertices[data.loops[li].vertex_index].co;uv.data[li].uv=(co.x*8+co.z*5,co.y*8+co.z*3)
 import bmesh
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
 return obj

def ribbon(name,points,width,thickness,mat):
 verts=[]
 for x,y,z in points:
  verts.extend([(x,y-width/2,z-thickness/2),(x,y+width/2,z-thickness/2),(x,y+width/2,z+thickness/2),(x,y-width/2,z+thickness/2)])
 faces=[(3,2,1,0)]
 for j in range(len(points)-1):
  for i in range(4):a=j*4+i;b=j*4+(i+1)%4;faces.append((a,b,b+4,a+4))
 faces.append(tuple(range(len(verts)-4,len(verts))))
 o=mesh(name,verts,faces,mat);mod=o.modifiers.new('Soft_Moulded_Edges','BEVEL');mod.width=.004;mod.segments=3
 o.modifiers.new('Weighted_Normals','WEIGHTED_NORMAL');return o

def cylinder(name,center,radius,depth,mat):
 bpy.ops.mesh.primitive_cylinder_add(vertices=40,radius=radius,depth=depth,location=center,rotation=(0,math.pi/2,0))
 o=bpy.context.object;o.name=name;o.parent=root;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Machined_Edge','BEVEL');mod.width=.002;mod.segments=3
 o.modifiers.new('Weighted_Normals','WEIGHTED_NORMAL');return o

def wheel(name,center,radius,width):
 # Axle is Blender X / glTF X; three tyre contacts share z=0 exactly.
 bpy.ops.object.empty_add(location=center);pivot=bpy.context.object;pivot.name=name;pivot.parent=root
 pivot['part']='landing_wheel';pivot['radius_m']=radius;pivot['axle']='local_X'
 bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=16,major_radius=radius*.76,minor_radius=radius*.24,location=center,rotation=(0,math.pi/2,0))
 tyre=bpy.context.object;tyre.name=name+'_Tyre';tyre.scale.z=width/(radius*.48);tyre.data.materials.append(rubber)
 for p in tyre.data.polygons:p.use_smooth=True
 tyre.parent=pivot;tyre.matrix_parent_inverse=pivot.matrix_world.inverted()
 hub=cylinder(name+'_Hub',center,radius*.55,width*.8,metal);hub.parent=pivot;hub.matrix_parent_inverse=pivot.matrix_world.inverted()
 for side in [-1,1]:
  cap=cylinder(name+'_AxleCap_'+str(side),(center[0]+side*width*.46,center[1],center[2]),radius*.17,.008,metal);cap.parent=pivot;cap.matrix_parent_inverse=pivot.matrix_world.inverted()
 return pivot

for sign,side in [(-1,'Left'),(1,'Right')]:
 ribbon('Gear_Main_'+side+'_Spring',[(sign*.27,-.97,.29),(sign*.41,-.97,.20),(sign*.57,-.99,.16),(sign*.66,-1,.14)],.12,.023,carbon)
 cylinder('Gear_Main_'+side+'_Axle',(sign*.66,-1,.105),.023,.115,metal)
 wheel('Gear_Main_'+side,(sign*.69,-1,.105),.105,.068)
# Central aft-body attachment, intentionally simple because references occlude this region.
ribbon('Gear_Tail_Spring',[(0,.57,.43),(0,.61,.30),(0,.72,.17),(0,.82,.09)],.055,.026,carbon)
for sign in [-1,1]:
 ribbon('Gear_Tail_Fork_'+str(sign),[(sign*.036,.78,.14),(sign*.036,.84,.065)],.027,.012,metal)
wheel('Gear_Tail',(0,.84,.065),.065,.046)

# Smooth interpolated hull: remove the old superellipse-axis pinching and coarse ring shading.
old=bpy.data.objects['Fuselage_Shell'];paint=old.data.materials[0];bpy.data.objects.remove(old,do_unlink=True)
rings=[(-1.82,.003,.48,.004),(-1.73,.20,.48,.15),(-1.48,.38,.52,.25),(-1.05,.48,.56,.31),(-.55,.50,.58,.34),(0,.47,.60,.32),(.38,.42,.64,.26),(.75,.30,.69,.19),(1.1,.20,.74,.12),(1.52,.08,.80,.06),(1.66,.003,.81,.004)]
sample=[]
for j in range(len(rings)-1):
 p0=rings[max(0,j-1)];p1=rings[j];p2=rings[j+1];p3=rings[min(len(rings)-1,j+2)]
 for step in range(8):
  t=step/8
  sample.append(tuple(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t) for a,b,c,d in zip(p0,p1,p2,p3)))
sample.append(rings[-1]);verts=[];N=64
for y,w,z,h in sample:
 for i in range(N):
  a=2*math.pi*i/N;verts.append((max(.003,w)*1.08*math.cos(a),y,z+max(.004,h)*math.sin(a)))
faces=[tuple(range(N-1,-1,-1))]
for j in range(len(sample)-1):
 for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
faces.append(tuple(range((len(sample)-1)*N,len(sample)*N)))
hull=mesh('Fuselage_Shell',verts,faces,paint)
for f in hull.data.polygons:f.use_smooth=True
sub=hull.modifiers.new('Continuous_Shell_Surface','SUBSURF');sub.levels=1;sub.render_levels=2
for light in bpy.data.objects:
 if light.type=='LIGHT':light.data.use_shadow=False
bpy.context.view_layer.update()
for o in root.children_recursive:
 if o.name=='Cargo_Hatch_Outline':
  for pt in o.data.splines[0].points:
   hit,co,normal,index=hull.ray_cast(Vector((pt.co.x,pt.co.y,2)),Vector((0,0,-1)))
   if hit:pt.co.z=co.z+.0018
 if '_Cargo_Latch_' in o.name:
  sign=1 if o.location.x>0 else -1
  hit,co,normal,index=hull.ray_cast(Vector((sign*2,o.location.y,o.location.z)),Vector((-sign,0,0)))
  if hit:o.location.x=co.x

# Replace spherical-ended pods with smooth tapered cowls, retaining motor/rotor origins.
for o in list(root.children_recursive):
 if not o.name.endswith('_Motor_Pod'):continue
 name=o.name;x,y,z=o.location; bpy.data.objects.remove(o,do_unlink=True)
 verts=[];N=32
 for dy,w,h in [(-.36,.015,.025),(-.30,.09,.065),(-.16,.137,.099),(0,.143,.104),(.17,.104,.083),(.31,.041,.043),(.36,.008,.009)]:
  for i in range(N):
   a=2*math.pi*i/N;verts.append((x+w*math.cos(a),y+dy,z+h*math.sin(a)))
 faces=[tuple(range(N-1,-1,-1))]
 for j in range(6):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
 faces.append(tuple(range(6*N,7*N)))
 pod=mesh(name,verts,faces,carbon)
 for f in pod.data.polygons:f.use_smooth=True
 sub=pod.modifiers.new('Cowl_Surface','SUBSURF');sub.levels=2

bpy.context.view_layer.update()
objects=list(root.children_recursive);wheels=[o for o in objects if o.get('part')=='landing_wheel']
contacts=[]
for o in wheels:
 tyre=bpy.data.objects[o.name+'_Tyre'];points=[tyre.matrix_world@Vector(v) for v in tyre.bound_box]
 contacts.append({'name':o.name,'center_blender_m':list(o.location),'radius_m':o['radius_m'],'ground_min_m':min(v.z for v in points)})
checks={'three_wheels':len(wheels)==3,'no_legacy_gear':not any(o.name.startswith(('Gear_Front_','Gear_Rear_')) for o in objects),'ground_contact':all(abs(c['ground_min_m'])<.001 for c in contacts),'symmetric_mains':abs(bpy.data.objects['Gear_Main_Left'].location.x+bpy.data.objects['Gear_Main_Right'].location.x)<1e-6,'tail_centered_aft':abs(bpy.data.objects['Gear_Tail'].location.x)<1e-6 and bpy.data.objects['Gear_Tail'].location.y>.5,'rotors':sum(o.name.startswith('LiftRotor_') for o in objects)==8 and sum(o.name.startswith('CruiseRotor_') for o in objects)==3}
assert all(checks.values()),(checks,contacts)
(PRE/'validation.json').write_text(json.dumps({'version':'v12','source':'models/v09/ev50_v09.blend','contacts':contacts,'checks':checks},indent=2),encoding='utf-8')
cam=sc.camera;sc.render.resolution_x=1440;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
views={'front':(0,-12,.6),'rear':(0,12,.6),'left':(-12,0,.6),'right':(12,0,.6),'top':(0,0,12),'bottom':(0,0,-12),'perspective':(6,-8,4),'gear_detail':(3,-5,-1)}
for name,loc in views.items():
 cam.location=loc;target=Vector((0,0,.5 if name!='gear_detail' else .2));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=4.6 if name in ('left','right','gear_detail') else 8.2
 sc.render.filepath=str(PRE/(name+'.png'));bpy.ops.render.render(write_still=True)
cam.location=(6,-8,4);cam.rotation_euler=(Vector((0,0,.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=8.2
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'ev50_v12.blend'))
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'ev50_v12.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_tangents=False)
print('AIRFRAME_COMPLETE',json.dumps(checks))
