"""Create EV50 v13 continuous control surfaces from the v12 source asset.

Run: blender -b --python blender/refine_control_surfaces.py
"""
import bpy
import bmesh
import json
import math
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'models/v12/ev50_v12.blend'
OUT = ROOT / 'models/v13'
PREVIEW = ROOT / 'previews/v13'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
scene.frame_set(1)
aircraft = bpy.data.objects['EV50_Root']
aircraft['visual_asset_version'] = 'v13'
aircraft['control_surface_layout'] = (
    'integrated ailerons, all-moving elevators, and curved-profile rudders'
)


def material(name, color, roughness, metallic):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    shader = next(
        (node for node in value.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'),
        None,
    )
    assert shader, f'No Principled BSDF node for {name}'
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return value


control_material = material('Control_Surface_Satin_Graphite', (.075, .092, .108), .38, .22)


def remove(name):
    object_ = bpy.data.objects.get(name)
    if object_:
        bpy.data.objects.remove(object_, do_unlink=True)


for side in ('Left', 'Right'):
    for suffix in ('Aileron', 'Aileron_Hinge', 'Rudder', 'Vertical_Fin'):
        remove(f'{side}_{suffix}')


def naca_half_thickness(t, thickness):
    return 5 * thickness * (
        .2969 * math.sqrt(t)
        - .126 * t
        - .3516 * t * t
        + .2843 * t * t * t
        - .1036 * t * t * t * t
    )


def airfoil_loft(name, sections, orientation, material_):
    """Create a closed, smooth NACA-like loft.

    Horizontal sections are (span_x, leading_y, chord_y, center_z, thickness).
    Vertical sections are (span_z, leading_y, chord_y, center_x, thickness).
    """
    samples = 22
    vertices = []
    for station, leading, chord, center, thickness in sections:
        for index in range(samples * 2):
            arc_index = index if index <= samples else samples * 2 - index
            t = (1 - math.cos(math.pi * arc_index / samples)) / 2
            half_thickness = naca_half_thickness(t, thickness)
            if orientation == 'horizontal':
                vertices.append(
                    (station, leading + t * chord, center + (half_thickness if index <= samples else -half_thickness))
                )
            else:
                vertices.append(
                    (center + (half_thickness if index <= samples else -half_thickness), leading + t * chord, station)
                )
    ring_size = samples * 2
    faces = [tuple(range(ring_size - 1, -1, -1))]
    for section in range(len(sections) - 1):
        for index in range(ring_size):
            current = section * ring_size + index
            following = section * ring_size + (index + 1) % ring_size
            faces.append((current, following, following + ring_size, current + ring_size))
    last = (len(sections) - 1) * ring_size
    faces.append(tuple(range(last, last + ring_size)))

    data = bpy.data.meshes.new(f'{name}_Mesh')
    data.from_pydata(vertices, [], faces)
    data.update()
    object_ = bpy.data.objects.new(name, data)
    scene.collection.objects.link(object_)
    object_.parent = aircraft
    data.materials.append(material_)
    uv = data.uv_layers.new(name='Surface_UV')
    for polygon in data.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            co = data.vertices[data.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (co.x * 10 + co.y * 7, co.z * 10 + co.y * 7)
    mesh_data = bmesh.new()
    mesh_data.from_mesh(data)
    bmesh.ops.recalc_face_normals(mesh_data, faces=mesh_data.faces)
    mesh_data.to_mesh(data)
    mesh_data.free()
    return object_


for sign, side in ((-1, 'Left'), (1, 'Right')):
    # The panels sit on the physical trailing region of the source wing, with
    # an airfoil profile and no free-standing hinge bars.
    aileron = airfoil_loft(
        f'{side}_Aileron',
        [
            (sign * 1.45, .102, .080, .889, .0060),
            (sign * 2.25, .076, .064, .904, .0052),
            (sign * 3.24, .057, .044, .934, .0038),
        ],
        'horizontal',
        control_material,
    )
    aileron['part'] = 'aileron'
    aileron['mount'] = 'main_wing_trailing_edge'

    # The source tailplane remains a continuous fixed root; this is its
    # directly attached trailing control surface rather than a floating strip.
    elevator = airfoil_loft(
        f'{side}_Elevator',
        [
            (sign * .12, 1.435, .137, .784, .0055),
            (sign * .39, 1.505, .132, .817, .0050),
            (sign * .66, 1.576, .126, .854, .0044),
        ],
        'horizontal',
        control_material,
    )
    elevator['part'] = 'elevator'
    elevator['mount'] = 'tailplane_trailing_edge'

    # A tapered, swept, airfoil-section vertical stabilizer replaces the flat
    # eight-vertex prism from v12. It retains the twin-fin reference layout.
    fin = airfoil_loft(
        f'{side}_Vertical_Fin',
        [
            (.770, 1.250, .450, sign * .660, .050),
            (.985, 1.365, .365, sign * .660, .042),
            (1.175, 1.485, .190, sign * .660, .026),
        ],
        'vertical',
        bpy.data.materials['Paint_Matte_Graphite'],
    )
    fin['part'] = 'vertical_stabilizer'
    fin['profile'] = 'tapered NACA-like curved airfoil'

    rudder = airfoil_loft(
        f'{side}_Rudder',
        [
            (.790, 1.548, .152, sign * .660, .0062),
            (.985, 1.606, .124, sign * .660, .0055),
            (1.155, 1.602, .073, sign * .660, .0038),
        ],
        'vertical',
        control_material,
    )
    rudder['part'] = 'rudder'
    rudder['mount'] = 'vertical_fin_trailing_edge'

bpy.context.view_layer.update()
controls = [
    f'{side}_{surface}'
    for side in ('Left', 'Right')
    for surface in ('Aileron', 'Elevator', 'Rudder')
]
checks = {
    'six_integrated_control_surfaces': all(bpy.data.objects.get(name) for name in controls),
    'curved_twin_vertical_fins': all(
        len(bpy.data.objects[f'{side}_Vertical_Fin'].data.vertices) >= 100 for side in ('Left', 'Right')
    ),
    'no_legacy_hinge_bars': not any(
        object_.name.endswith('_Aileron_Hinge') for object_ in aircraft.children_recursive
    ),
    'three_wheels': len([object_ for object_ in aircraft.children_recursive if object_.get('part') == 'landing_wheel']) == 3,
}
assert all(checks.values()), checks

(PREVIEW / 'validation.json').write_text(
    json.dumps({'version': 'v13', 'source': str(SOURCE.relative_to(ROOT)), 'checks': checks}, indent=2),
    encoding='utf-8',
)

camera = scene.camera
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
views = {
    'front': (0, -12, .6),
    'rear': (0, 12, .7),
    'left': (-12, 0, .7),
    'right': (12, 0, .7),
    'top': (0, 0, 12),
    'perspective': (6, -8, 4.5),
}
for name, location in views.items():
    camera.location = location
    target = Vector((0, .32, .76))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 4.8 if name in ('left', 'right') else 8.2
    scene.render.filepath = str(PREVIEW / f'{name}.png')
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'ev50_v13.blend'))
bpy.ops.object.select_all(action='DESELECT')
aircraft.select_set(True)
for object_ in aircraft.children_recursive:
    object_.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT / 'ev50_v13.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_tangents=False,
)
print('CONTROL_SURFACE_REFINEMENT_COMPLETE', json.dumps(checks))
