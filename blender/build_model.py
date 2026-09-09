"""Reproducible reference-based EV50 visual model. Blender 5.x, SI units.
blender -b --factory-startup --python blender/build_model.py -- --version 1
"""
import bpy, math, json, sys, argparse
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--version',type=int,default=1);ap.add_argument('--export',action='store_true');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
V=args.version; tag=f'v{V:02d}'; out=P/'previews'/tag;out.mkdir(parents=True,exist_ok=True)
(P/'models'/tag).mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene;sc.unit_settings.system='METRIC'
root=bpy.data.objects.new('EV50_Root',None);sc.collection.objects.link(root)
def mat(name,c,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*c,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 return m
paint=mat('Paint_Matte_Graphite',(.30,.33,.35),.43,.2)
carbon=mat('Composite_Carbon',(.065,.077,.088),.45,.25)
rubber=mat('Rubber_Shoes',(.018,.023,.027),.84)
metal=mat('Motor_Anodized_Aluminium',(.17,.20,.22),.3,.8)
black=mat('Panel_Seams',(.016,.022,.026),.55)
orange=mat('Propeller_Tip_Safety_Orange',(.95,.16,.035),.5)
if V>=6:
 paint.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.18
 paint.node_tree.nodes.get('Principled BSDF').inputs['Coat Roughness'].default_value=.38
 metal.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.38
if V>=3:
 # Small original woven texture, embedded in GLB. No borrowed product pixels.
 import numpy as np
 N=256;yy,xx=np.mgrid[0:N,0:N];a=(xx+yy)%32;b=(xx-yy)%32;tile=((xx//16+yy//16)%2)
 val=.14+.065*np.where(tile==0,np.sin(a/32*math.pi)**6,np.sin(b/32*math.pi)**6)
 rgba=np.stack([val*.88,val*.96,val,np.ones_like(val)],axis=2).astype(np.float32)
 im=bpy.data.images.new('Carbon_Weave_256',width=N,height=N);im.pixels.foreach_set(rgba.ravel());im.pack()
 node=carbon.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
 carbon.node_tree.links.new(node.outputs['Color'],carbon.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 carbon.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.54
 paint.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.12,.14,.16,1)
green=mat('Navigation_Green',(.04,.8,.23),.28);red=mat('Navigation_Red',(.9,.025,.035),.28)
for m in [green,red]:m.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=m.diffuse_color;m.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=2
def setup(o,n,m,parent=root):
 o.name=n;o.parent=parent
 if m:o.data.materials.append(m)
 return o
def mesh(n,verts,faces,m,parent=root,smooth=True):
 d=bpy.data.meshes.new(n+'_Mesh');d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(n,d);sc.collection.objects.link(o);setup(o,n,m,parent)
 uv=d.uv_layers.new(name='Surface_UV')
 for poly in d.polygons:
  for li in poly.loop_indices:
   co=d.vertices[d.loops[li].vertex_index].co;uv.data[li].uv=(co.x*12+co.z*12,co.y*12)
 # Consistent outward normals even for mirrored lofts.
 import bmesh
 bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(d);bm.free()
 for f in d.polygons:f.use_smooth=smooth
 return o
def box(n,loc,dim,m,bevel=0,parent=root):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=setup(bpy.context.object,n,m,parent);o.scale=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:b=o.modifiers.new('Edge_Radius','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted_Normals','WEIGHTED_NORMAL')
 return o
def ellipsoid(n,loc,dim,m,parent=root):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc);o=setup(bpy.context.object,n,m,parent);o.scale=dim
 for f in o.data.polygons:f.use_smooth=True
 return o
def cylinder(n,loc,r,depth,m,parent=root,axis='Z'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=depth,location=loc);o=setup(bpy.context.object,n,m,parent)
 if axis=='Y':o.rotation_euler[0]=math.pi/2
 for f in o.data.polygons:f.use_smooth=abs(f.normal.z)<.5 if V>=6 else True
 b=o.modifiers.new('Rim_Radius','BEVEL');b.width=min(.006,depth*.2);b.segments=2
 if V>=6:b.harden_normals=True;o.modifiers.new('Motor_Weighted_Normals','WEIGHTED_NORMAL')
 return o
def rod(n,a,b,r,m):
 a,b=Vector(a),Vector(b);o=cylinder(n,(a+b)/2,r,(a-b).length,m);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def loft(n,rings,m):
 # ring: longitudinal y, half-width, center z, half-height. Rounded superellipse.
 vv=[];N=32
 for y,w,z,h in rings:
  for i in range(N):
   t=2*math.pi*i/N;c=math.cos(t);s=math.sin(t)
   vv.append((w*math.copysign(abs(c)**.83,c),y,z+h*math.copysign(abs(s)**.9,s)))
 ff=[tuple(range(N-1,-1,-1))]
 for j in range(len(rings)-1):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;ff.append((a,b,b+N,a+N))
 ff.append(tuple(range((len(rings)-1)*N,len(rings)*N)))
 o=mesh(n,vv,ff,m);sub=o.modifiers.new('Hull_Fairing','SUBSURF');sub.levels=2 if V>=5 else 1;sub.render_levels=sub.levels;return o
width=1.14 if V==1 else 1.08
rings=[(-1.82,.02,.48,.025),(-1.73,.20,.48,.15),(-1.48,.38,.52,.25),(-1.05,.48,.56,.31),(-.55,.50,.58,.34),(0,.47,.60,.32),(.38,.42,.64,.26),(.75,.30,.69,.19),(1.1,.20,.74,.12),(1.52,.08,.80,.06),(1.66,.03,.81,.025)]
hull=loft('Fuselage_Shell',[(y,w*width,z,h) for y,w,z,h in rings],paint)
# Airfoil loft along span. NACA style thickness and tapered planform.
def wing(n,sections,m):
 vv=[];N=18
 for x,lead,chord,z,thick in sections:
  for i in range(N*2):
   t=(1-math.cos(math.pi*(i if i<=N else 2*N-i)/N))/2
   yt=5*thick*(.2969*math.sqrt(t)-.126*t-.3516*t*t+.2843*t**3-.1036*t**4)
   vv.append((x,lead+t*chord,z+(yt if i<=N else -yt)))
 nn=N*2;ff=[tuple(range(nn-1,-1,-1))]
 for j in range(len(sections)-1):
  for i in range(nn):a=j*nn+i;b=j*nn+(i+1)%nn;ff.append((a,b,b+nn,a+nn))
 ff.append(tuple(range((len(sections)-1)*nn,len(sections)*nn)))
 return mesh(n,vv,ff,m)
for s,label in [(-1,'Left'),(1,'Right')]:
 chord=.62 if V==1 else .49
 wing(label+'_Wing_Root',[(s*.30,-.30,.70,.87 if V==1 else .84,.095 if V==1 else .055),(s*.65,-.30,chord,.875,.055)],paint)
 wing(label+'_Main_Wing',[(s*(.62 if V==1 else .65),-.30,chord,.875,.053),(s*1.3,-.27,chord*.90,.88,.047),(s*2.65,-.18,chord*.60,.90,.033),(s*3.43,-.11,.20,.93,.024),(s*3.5,-.10,.17,1.10,.013)],carbon)
 wing(label+'_Tailplane',[(s*.10,1.1,.47,.78,.03),(s*.66,1.34,.36,.85,.027)],paint)
 # Thin trapezoidal twin vertical fins, no V-tail guess.
 x=s*.66; vv=[(x-.018,1.25,.77),(x-.018,1.69,.77),(x-.018,1.67,1.15),(x-.018,1.49,1.15),(x+.018,1.25,.77),(x+.018,1.69,.77),(x+.018,1.67,1.15),(x+.018,1.49,1.15)]
 mesh(label+'_Vertical_Fin',vv,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],paint,smooth=False)
 ellipsoid(label+'_Navigation_Light',(s*3.47,-.01,.985),(.012,.05,.014),green if s<0 else red)
# Each side has one longitudinal boom with a front and rear coaxial motor pod.
rotors=[]; stations=[]
for s,label in [(-1,'Left'),(1,'Right')]:
 x=s*(1.13 if V==1 else 1.24)
 rod(label+'_Longitudinal_Boom',(x,-1.10,.77),(x,1.06,.77),.046,carbon)
 for y,locname in [(-.94,'Front'),(.90,'Rear')]:
  n=label+'_'+locname
  ellipsoid(n+'_Motor_Pod',(x,y,.77),(.145,.36,.105),carbon)
  stations.append((x,y))
  for j,z in enumerate([.915,.625]):
   cylinder(n+('_Upper' if j==0 else '_Lower')+'_Motor',(x,y,z),.085,.065,metal)
   pivot=bpy.data.objects.new('LiftRotor_'+n+'_'+str(j),None);sc.collection.objects.link(pivot);pivot.parent=root;pivot.location=(x,y,z+(.042 if j==0 else -.042));pivot['axis']='local_Z';pivot['spin_sign']=(-1 if (j+(s>0))%2 else 1);pivot['radius']=.58
   cylinder(n+'_Hub_'+str(j),(0,0,0),.065,.028,black,parent=pivot)
   for b in [-1,1]:
    # Feathered, tapered two-blade propeller; origin stays on spindle.
    verts=[(-.022,b*.055,-.007),(.026,b*.055,.006),(.05,b*.26,.012),(.025,b*.58,.008),(-.021,b*.58,-.004),(-.04,b*.26,-.008)]
    blade=mesh(n+'_Blade_'+str(j)+'_'+str(b),verts,[tuple(range(6))],carbon,parent=pivot,smooth=False)
    sol=blade.modifiers.new('Blade_Thickness','SOLIDIFY');sol.thickness=.004
    tip=box(n+'_Tip_'+str(j)+'_'+str(b),(0,b*.564,.01),(.044,.028,.004),orange,parent=pivot)
   rotors.append(pivot)
for x,y,z,name in [(-2.14,-.25,.93 if V==1 else .90,'Left'),(2.14,-.25,.93 if V==1 else .90,'Right'),(0,1.71,.83,'Tail')]:
 ellipsoid('Cruise_'+name+'_Nacelle',(x,y+.04,z),(.06,.14,.06),carbon)
 pivot=bpy.data.objects.new('CruiseRotor_'+name,None);sc.collection.objects.link(pivot);pivot.parent=root;pivot.location=(x,y-.11 if name!='Tail' else y+.12,z);pivot.rotation_euler[0]=math.pi/2;pivot['axis']='local_Z';pivot['spin_sign']=1
 cylinder('Cruise_'+name+'_Hub',(0,0,0),.033,.055,metal,parent=pivot)
 for b in [-1,1]:ellipsoid('Cruise_'+name+'_Blade_'+str(b),(0,b*.125,0),(.025,.125,.012),carbon,parent=pivot)
 # Spinner has the same local propeller axis.
 ellipsoid('Cruise_'+name+'_Spinner',(0,0,.035),(.034,.034,.065),paint,parent=pivot)
# Low composite legs with rubber landing pads, matching visible transverse front gear.
for y,lab in [(-1.05,'Front'),(.63,'Rear')]:
 for s,side in [(-1,'Left'),(1,'Right')]:
  x=s*(.59 if V==1 else .63)
  rod('Gear_'+lab+'_'+side+'_Strut',(s*.32,y,.32 if V==1 else (.53 if y>0 else .36)),(x,y,.09),.029,carbon)
  box('Gear_'+lab+'_'+side+'_Shoe',(x,y,.065),(.075,.20,.13),rubber,.027)
if V>=2:
 # Panel outlines are visible surface detail; no fabricated internal assemblies.
 def seam(n,points,r=.0028):
  cu=bpy.data.curves.new(n,'CURVE');cu.dimensions='3D';cu.bevel_depth=r;cu.bevel_resolution=1;p=cu.splines.new('POLY');p.points.add(len(points)-1)
  for pt,co in zip(p.points,points):pt.co=(*co,1)
  o=bpy.data.objects.new(n,cu);sc.collection.objects.link(o);setup(o,n,black);return o
 hatchpoints=[(-.24,-1.43,.715),(-.34,-1.05,.816),(-.36,-.6,.88),(-.30,.16,.89),(.30,.16,.89),(.36,-.6,.88),(.34,-1.05,.816),(.24,-1.43,.715),(-.24,-1.43,.715)]
 if V>=3:
  # Project each sampled seam point onto evaluated shell: no floating lines.
  bpy.context.view_layer.update();ev=hull.evaluated_get(bpy.context.evaluated_depsgraph_get());sample=[]
  for aa,bb in zip(hatchpoints,hatchpoints[1:]):
   for i in range(12):
    x=aa[0]+(bb[0]-aa[0])*i/12;y=aa[1]+(bb[1]-aa[1])*i/12
    hit,co,normal,idx=ev.ray_cast(Vector((x,y,2)),Vector((0,0,-1)))
    if hit:sample.append((x,y,co.z+.003))
  if sample:sample.append(sample[0]);hatchpoints=sample
 seam('Cargo_Hatch_Outline',hatchpoints)
 for s,label in [(-1,'Left'),(1,'Right')]:
  for y in [-1.32,-1.02,-.60]:
   ellipsoid(label+'_Cargo_Latch_'+str(y),(s*.44,y,.55),(.016,.044,.018),metal)
  for xx in [.37,.78]:ellipsoid(label+'_Wing_Service_Fairing_'+str(xx),(s*xx,-.12,.925),(.015,.09,.022),paint)
  seam(label+'_Aileron_Hinge',[(s*1.5,.125,.9),(s*2.65,.11,.918),(s*3.35,.064,.945)])
  for y in [-.94,.9]:box(label+'_Pod_Vent_'+str(y),(s*1.24,y+.15,.858),(.075,.085,.009),black,.004)
  rod(label+'_Pitot',(s*.23,-1.65,.47),(s*.25,-1.80,.44),.006,metal)
 ellipsoid('Nose_Sensor',(0,-1.76,.44),(.025,.017,.025),black)
 box('Tail_Service_Panel',(0,.71,.877),(.23,.19,.015),paint,.025)
if V>=3:
 # Apply a subtle smooth union to the fuselage/wing shoulders only.
 bpy.ops.object.select_all(action='DESELECT')
 for o in [hull,bpy.data.objects['Left_Wing_Root'],bpy.data.objects['Right_Wing_Root']]:o.select_set(True)
 bpy.context.view_layer.objects.active=hull;bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
 if V<5:
  mod=hull.modifiers.new('Shoulder_Union','REMESH');mod.mode='VOXEL';mod.voxel_size=.018;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=hull.modifiers.new('Shoulder_Smoothing','SMOOTH');mod.factor=.55;mod.iterations=4;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=hull.modifiers.new('Shell_Optimization','DECIMATE');mod.ratio=.42;bpy.ops.object.modifier_apply(modifier=mod.name)
 for f in hull.data.polygons:f.use_smooth=True
 # Texture UVs tied to surface position, reused across symmetric parts.
 for o in root.children_recursive:
  if o.type=='MESH' and carbon.name in [m.name for m in o.data.materials]:
   uv=o.data.uv_layers.new(name='Carbon_UV') if not o.data.uv_layers else o.data.uv_layers.active
   for poly in o.data.polygons:
    for li in poly.loop_indices:
     co=o.data.vertices[o.data.loops[li].vertex_index].co
     uv.data[li].uv=(co.x*12+co.z*12,co.y*12)
 # Independent control surfaces, represented by slim trailing strips.
 for s,lab in [(-1,'Left'),(1,'Right')]:
  o=wing(lab+'_Aileron',[(s*1.5,.127,.037,.891,.004),(s*2.65,.081,.037,.900,.004),(s*3.32,.058,.025,.926,.003)],carbon);o['part']='aileron'
  o=box(lab+'_Rudder',(s*.66,1.673,.965),(.039,.028,.34),paint,.004);o['part']='rudder'
if V>=6:
 # Surface-only refinements; retain the validated v05 silhouette and all spindle origins.
 bpy.context.view_layer.update()
 ev=hull.evaluated_get(bpy.context.evaluated_depsgraph_get())
 for o in list(root.children_recursive):
  if '_Cargo_Latch_' in o.name:
   s=1 if o.location.x>0 else -1
   hit,co,normal,idx=ev.ray_cast(Vector((s*2,o.location.y,o.location.z)),Vector((-s,0,0)))
   if hit:o.location.x=co.x+s*.009
 for x,y in stations:
  for j,z in enumerate([.915,.625]):
   for ring,dz in enumerate([-.018,0,.018]):
    cylinder('Cooling_Ring_'+str(x)+'_'+str(y)+'_'+str(j)+'_'+str(ring),(x,y,z+dz),.088,.005,metal)
 # Shallow hinge shoes on existing gear joints, not invented internal equipment.
 for y,lab in [(-1.05,'Front'),(.63,'Rear')]:
  for s,side in [(-1,'Left'),(1,'Right')]:
   ellipsoid('Gear_'+lab+'_'+side+'_Joint',(s*.63,y,.105),(.04,.045,.027),metal)
# Component rotor-only demo action: the root remains owned by the flight path.
if V>=3:
 for o in root.children_recursive:
  if o.name.startswith(('LiftRotor_','CruiseRotor_')):
   o.rotation_mode='XYZ';base=o.rotation_euler.z
   o.rotation_euler.z=base;o.keyframe_insert(data_path='rotation_euler',index=2,frame=1)
   o.rotation_euler.z=base+2*math.pi*o.get('spin_sign',1);o.keyframe_insert(data_path='rotation_euler',index=2,frame=61)
   if o.animation_data and o.animation_data.action:
    o.animation_data.action.name=o.name+'_Spin'
 sc.frame_start=1;sc.frame_end=61;sc.render.fps=30;sc.frame_set(1)
# Model-only validation, before studio objects.
bpy.context.view_layer.update();model_objects=list(root.children_recursive)
coords=[o.matrix_world@Vector(c) for o in model_objects if o.type=='MESH' for c in o.bound_box]
dims=[max(v[i] for v in coords)-min(v[i] for v in coords) for i in range(3)]
report={'version':tag,'blender':bpy.app.version_string,'dimensions_m':dims,'lift_rotors':len(rotors),'cruise_rotors':len([o for o in model_objects if o.name.startswith('CruiseRotor_')]),'mesh_objects':len([o for o in model_objects if o.type=='MESH']),'lift_station_distance_m':min(math.dist(a,b) for i,a in enumerate(stations) for b in stations[i+1:]),'rotor_diameter_m':1.16,'checks':{}}
report['checks']['power_counts']=report['lift_rotors']==8 and report['cruise_rotors']==3
report['checks']['lift_station_clearance']=report['lift_station_distance_m']>1.16
report['checks']['english_names']=all(o.name.isascii() for o in model_objects)
report['checks']['independent_spindles']=all(o.type=='EMPTY' and len(o.children)>0 for o in rotors)
assert all(report['checks'].values()),report
(out/'validation.json').write_text(json.dumps(report,indent=2))
# Neutral studio with orthographic fixed views, no distracting environment.
sc.world=bpy.data.worlds.new('Studio_World');sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.14,.17,.20,1);sc.world.node_tree.nodes['Background'].inputs[1].default_value=.5
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,size in [('Key',(-3,-4,7),1100,5),('Fill',(4,-1,4),800,4),('Rim',(0,5,6),1400,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name='Studio_'+name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;aim(o,(0,0,.6))
bpy.ops.object.camera_add(location=(6,-8,5));cam=bpy.context.object;cam.name='Review_Camera';sc.camera=cam
sc.render.engine='BLENDER_EEVEE';sc.render.resolution_x=1200;sc.render.resolution_y=900;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.film_transparent=False
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
views={'front':(0,-12,.6),'rear':(0,12,.6),'left':(-12,0,.6),'right':(12,0,.6),'top':(0,0,12),'bottom':(0,0,-12),'perspective':(6,-8,5)}
cam.data.type='ORTHO';cam.data.ortho_scale=8.2;aim(cam,(0,0,.58))
path=P/'models'/tag/f'ev50_{tag}.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(path))
for name,loc in views.items():
 cam.location=loc;aim(cam,(0,0,.58));cam.data.ortho_scale=8.2 if name not in ['left','right'] else 4.8
 sc.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
cam.location=views['perspective'];cam.data.ortho_scale=8.2;aim(cam,(0,0,.58))
sc.render.filepath=str(out/'perspective.png')
bpy.ops.wm.save_as_mainfile(filepath=str(path))
if args.export:
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in model_objects:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(P/'models'/tag/f'ev50_{tag}.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True)
print('EV50_BUILD_SUCCESS',json.dumps(report))
