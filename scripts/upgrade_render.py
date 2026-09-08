from pathlib import Path
p=Path('blender/render_flight.py');s=p.read_text(encoding='utf-8');s=s.replace('v03/ev50_v03.blend','v05/ev50_v05.blend').replace('1500','1800').replace('1501','1801').replace('Flight_50s','Flight_60s').replace('flight_sequence_v02','flight_sequence_v03').replace('flight_scene_v02','flight_scene_v03').replace('[1,301,601,901,1351]','[1,301,601,961,1651]').replace("P/'previews'/f'flight_", "P/'previews'/f'flight_v03_")
s=s.replace("sc.eevee.taa_render_samples=16","sc.eevee.taa_render_samples=64")
s=s.replace("N=70","N=160").replace('j*2.6','j*1.3').replace("20+28*abs(math.sin(a*4+k))**2+20*abs(math.sin(a*9+k*.7))+5*math.sin(r*.12+a*30)","42+46*math.sin(a*3+k*1.3)**2+26*math.sin(a*7+k)**2+10*math.sin(a*17+r*.038)+5*math.sin(a*41+r*.18)")
s=s.replace("m=mat('Ridge_'+str(k)","m=mat('Ridge_'+str(k)")
# Add original procedural surface variation to ground and mountains.
idx=s.index('# Lighting and atmospheric background.')
s=s[:idx]+'''# Fine procedural terrain shading and layered conifer instances.
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
''' + s[idx:]
# Dynamic 60s camera wide shot schedule.
s=s.replace('(t-22)/12','(t-24)/18').replace('22<t<34','24<t<42')
p.write_text(s,encoding='utf-8')
p=Path('scripts/validate_outputs.py');s=p.read_text().replace('v03/ev50_v03.glb','v05/ev50_v05.glb').replace("['v01','v02','v03']","['v01','v02','v03','v04','v05']").replace('==1501','==1801');p.write_text(s)
