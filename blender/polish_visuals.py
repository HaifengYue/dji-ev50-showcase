"""Create the v09 presentation asset from the existing v08 artwork.

This pass changes surface appearance and studio lighting only. The source
silhouette, component origins and existing animation hierarchy are retained.
Run with Blender --background --python blender/polish_visuals.py.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / 'models/v08/ev50_v08.blend'
MODEL_DIR = PROJECT / 'models/v09'
PREVIEW_DIR = PROJECT / 'previews/v09'
for folder in (MODEL_DIR, PREVIEW_DIR):
    folder.mkdir(parents=True, exist_ok=True)
if not SOURCE.is_file():
    raise FileNotFoundError(f'Build the v08 source artwork first: {SOURCE}')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
root = bpy.data.objects['EV50_Root']
root['visual_asset_version'] = 'v09'
root['description'] = 'Independent reference-based 3D artwork; surface presentation pass'

def surface(name, roughness, metallic, color=None):
    material = bpy.data.materials.get(name)
    if material is None:
        raise RuntimeError(f'Missing source material: {name}')
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if color:
        shader.inputs['Base Color'].default_value = (*color, 1)
        material.diffuse_color = (*color, 1)
    return material, shader

paint, paint_shader = surface('Paint_Matte_Graphite', .42, .24, (.105, .126, .145))
paint_shader.inputs['Coat Weight'].default_value = .26
paint_shader.inputs['Coat Roughness'].default_value = .32
carbon, carbon_shader = surface('Composite_Carbon', .48, .12)
surface('Motor_Anodized_Aluminium', .32, .78, (.19, .22, .24))
surface('Rubber_Shoes', .88, 0, (.015, .02, .024))
surface('Panel_Seams', .66, .04, (.027, .036, .042))

# An original, seamless tangent-space normal image gives the woven material
# a visible response to grazing light. It exports as a standard glTF normal map.
size = 256
y, x = np.mgrid[0:size, 0:size]
checker = (x // 16 + y // 16) % 2
height = np.where(checker == 0, np.cos(x * math.pi / 8), np.cos(y * math.pi / 8)) * .12
dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
rgba = np.concatenate((normal * .5 + .5, np.ones((size, size, 1))), axis=-1).astype(np.float32)
image = bpy.data.images.new('Original_Weave_Normal_v09', width=size, height=size)
image.colorspace_settings.name = 'Non-Color'
image.pixels.foreach_set(rgba.ravel())
image.pack()
texture = carbon.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
normal_node = carbon.node_tree.nodes.new('ShaderNodeNormalMap')
normal_node.inputs['Strength'].default_value = .38
carbon.node_tree.links.new(texture.outputs['Color'], normal_node.inputs['Color'])
carbon.node_tree.links.new(normal_node.outputs['Normal'], carbon_shader.inputs['Normal'])

scene.frame_set(1)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.07, .095, .12, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
for name, energy, size_value in [('Studio_Key', 1400, 5), ('Studio_Fill', 750, 5), ('Studio_Rim', 1800, 4)]:
    light = bpy.data.objects.get(name)
    if light:
        light.data.energy = energy
        light.data.size = size_value

camera = scene.camera
views = {'front': (0, -12, .6), 'rear': (0, 12, .6), 'left': (-12, 0, .6),
         'right': (12, 0, .6), 'top': (0, 0, 12), 'bottom': (0, 0, -12), 'perspective': (6, -8, 5)}
export_only = '--export-only' in sys.argv
for name, location in views.items():
    camera.location = location
    camera.rotation_euler = (Vector((0, 0, .58)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 4.8 if name in ('left', 'right') else 8.2
    scene.render.filepath = str(PREVIEW_DIR / f'{name}.png')
    if not export_only:
        bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(MODEL_DIR / 'ev50_v09.blend'))
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
objects = list(root.children_recursive)
for obj in objects:
    obj.select_set(True)
# Let the renderer derive tangent space for the normal map. Some source UVs
# produce zero-length explicit tangents; those must not be shipped in glTF.
bpy.ops.export_scene.gltf(filepath=str(MODEL_DIR / 'ev50_v09.glb'), export_format='GLB',
                          use_selection=True, export_apply=True, export_extras=True,
                          export_tangents=False)
report = {'version': 'v09', 'source': str(SOURCE.relative_to(PROJECT)), 'blender': bpy.app.version_string,
          'pass': 'surface materials, original woven normal texture, studio lighting',
          'views': list(views), 'previews_regenerated': not export_only,
          'export_tangents': False, 'mesh_objects': sum(o.type == 'MESH' for o in objects),
          'lift_rotors': sum(o.name.startswith('LiftRotor_') for o in objects),
          'cruise_rotors': sum(o.name.startswith('CruiseRotor_') for o in objects)}
assert report['lift_rotors'] == 8 and report['cruise_rotors'] == 3
(PREVIEW_DIR / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('VISUAL_V09_COMPLETE', json.dumps(report))
