from pathlib import Path
p=Path('blender/build_model.py');s=p.read_text(encoding='utf-8');start=s.index(" mod=hull.modifiers.new('Shoulder_Union'");end=s.index(' # Texture UVs tied',start)
s=s[:start]+''' if V<5:
  mod=hull.modifiers.new('Shoulder_Union','REMESH');mod.mode='VOXEL';mod.voxel_size=.018;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=hull.modifiers.new('Shoulder_Smoothing','SMOOTH');mod.factor=.55;mod.iterations=4;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=hull.modifiers.new('Shell_Optimization','DECIMATE');mod.ratio=.42;bpy.ops.object.modifier_apply(modifier=mod.name)
 for f in hull.data.polygons:f.use_smooth=True
'''+s[end:]
s=s.replace("sub.levels=1;sub.render_levels=1;return o","sub.levels=2 if V>=5 else 1;sub.render_levels=sub.levels;return o")
p.write_text(s,encoding='utf-8')
