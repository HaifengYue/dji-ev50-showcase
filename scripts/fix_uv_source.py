from pathlib import Path
p=Path('blender/build_model.py');s=p.read_text(encoding='utf-8');s=s.replace(' # Consistent outward normals even for mirrored lofts.', ''' uv=d.uv_layers.new(name='Surface_UV')
 for poly in d.polygons:
  for li in poly.loop_indices:
   co=d.vertices[d.loops[li].vertex_index].co;uv.data[li].uv=(co.x*12+co.z*12,co.y*12)
 # Consistent outward normals even for mirrored lofts.''');p.write_text(s,encoding='utf-8')
