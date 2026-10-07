"""Fit annotated joints to final root skin before seats, drive, and animation.

Call after the actual pivots and wing meshes have reached their final authoring
coordinates. Snapshot ``previous_anchors`` from the already-rebased BraceWing
nodes and ``previous_length`` from the current rigid rod. The lateral/aft target
follows the user's red dots; height retains the measured pre-edit ball-to-skin
rise. This is an authoring-time rod refit, never runtime scaling or a new DOF.
"""
import math

import bpy
from mathutils import Vector
import kinematics

ANCHOR_ABS_X = .97
ANCHOR_Y = -1.04
# Direct pre-edit saved-Blend ray measurement, L/R differ by 1.19e-7.
RETAINED_BALL_TO_SKIN_RISE = .029935374855995178
SIDES = (('L', -1), ('R', 1))


def _identity(matrix, tolerance=1e-7):
    return all(abs(matrix[i][j] - float(i == j)) <= tolerance
               for i in range(4) for j in range(4))


def _mesh_center_in_parent(obj):
    """Rod eyes store their center partly in vertices, not their object origin."""
    points = [obj.matrix_basis @ v.co for v in obj.data.vertices]
    if not points:
        raise ValueError('Annotated linkage requires real rod-eye material: ' + obj.name)
    return Vector(tuple((min(p[k] for p in points) + max(p[k] for p in points))/2
                        for k in range(3)))


def _preflight(previous_anchors, previous_length):
    """Reject stale/late input before mutating either side or kinematics."""
    if kinematics._AUTHORING_REFERENCE:
        raise ValueError('Fit annotated anchors after final pivot rebasing, not authoring-reference mode')
    if not math.isfinite(previous_length) or previous_length <= .068:
        raise ValueError('Previous rigid rod length must exceed its two fixed end offsets')
    for side, sign in SIDES:
        if bpy.data.objects.get('BraceWingSeat_' + side) is not None:
            raise ValueError('Run annotated anchor fitting before constructing the final wing seat: ' + side)
        required = ['WingPivot_' + side, 'Composite_wing_' + side,
                    'BraceWing_' + side, 'BraceBall_' + side + '_Wing',
                    'BraceBallPin_' + side + '_Wing', 'BraceBody_' + side,
                    'BraceRod_' + side, 'BraceRod_mesh_' + side,
                    *('BraceRod' + part + '_' + side + '_' + end
                      for part in ('Eye', 'EyeNeck', 'Ferrule') for end in ('Body', 'Root'))]
        for name in required:
            if bpy.data.objects.get(name) is None:
                raise ValueError('Missing real annotated-linkage part: ' + name)
        pivot = bpy.data.objects['WingPivot_' + side]
        wing = bpy.data.objects['Composite_wing_' + side]
        marker = bpy.data.objects['BraceWing_' + side]
        rod = bpy.data.objects['BraceRod_' + side]
        if pivot.parent is not None or (pivot.location - kinematics.pivot_position(sign)).length > 1e-6:
            raise ValueError('Actual wing pivot and final kinematics disagree: ' + side)
        if tuple(pivot.scale) != (1., 1., 1.):
            raise ValueError('Annotated wing pivot must remain a rigid unit-scale body: ' + side)
        # The existing final seat builder ray-casts in the same wing/pivot frame.
        if wing.parent != pivot or not _identity(wing.matrix_basis) or not _identity(wing.matrix_parent_inverse):
            raise ValueError('Final wing skin must use the canonical pivot-local frame: ' + side)
        for name in ('BraceWing_' + side, 'BraceBall_' + side + '_Wing', 'BraceBallPin_' + side + '_Wing'):
            obj = bpy.data.objects[name]
            if obj.parent != pivot or not _identity(obj.matrix_parent_inverse):
                raise ValueError('Wing joint must inherit its final pivot directly: ' + name)
        if sign not in previous_anchors or (marker.location - Vector(previous_anchors[sign])).length > 1e-6:
            raise ValueError('Snapshot previous anchors after moving/rebasing the real wing parts: ' + side)
        if (bpy.data.objects['BraceBall_' + side + '_Wing'].location - marker.location).length > 1e-6:
            raise ValueError('Real wing ball and endpoint marker disagree before refit: ' + side)
        if rod.parent is not None or tuple(rod.scale) != (1., 1., 1.):
            raise ValueError('Rigid rod must be an unparented unit-scale body: ' + side)
        expected = {'BraceRod_mesh_' + side,
                    *('BraceRod' + part + '_' + side + '_' + end
                      for part in ('Eye', 'EyeNeck', 'Ferrule') for end in ('Body', 'Root'))}
        if {obj.name for obj in rod.children} != expected:
            raise ValueError('Unexpected rigid rod child inventory: ' + side)
        for child in rod.children:
            if not _identity(child.matrix_parent_inverse):
                raise ValueError('Rod part has a noncanonical parent inverse: ' + child.name)
        for end, z in (('Body', 0.), ('Root', previous_length)):
            eye = bpy.data.objects['BraceRodEye_' + side + '_' + end]
            if (_mesh_center_in_parent(eye) - Vector((0, 0, z))).length > 1e-6:
                raise ValueError('Previous length disagrees with the actual rod-eye geometry: ' + side)
        for obj in (pivot, rod, bpy.data.objects['BraceSpreader']):
            if obj.animation_data is not None:
                raise ValueError('Refit before baking animation; clear stale source tracks first: ' + obj.name)
    if bpy.data.objects['BraceSpreader'].parent is not None:
        raise ValueError('The single shared slider must remain an unparented body')


def refit_annotated_anchor(ctx, previous_anchors, previous_length):
    _preflight(previous_anchors, previous_length)
    bpy.context.view_layer.update()
    hits = []
    for side, sign in SIDES:
        pivot = bpy.data.objects['WingPivot_' + side]
        wing = bpy.data.objects['Composite_wing_' + side]
        xy = Vector((sign * ANCHOR_ABS_X, ANCHOR_Y, 0)) - pivot.location
        top = max(v.co.z for v in wing.data.vertices) + 1.
        hit, point, normal, index = wing.ray_cast(Vector((xy.x, xy.y, top)), Vector((0, 0, -1)))
        if not hit or normal.z <= 0:
            raise ValueError('Annotated ball target lacks actual outward top skin: ' + side)
        hits.append({'side': side, 'surfaceWorldZ': float(point.z + pivot.location.z),
                     'polygon': index, 'pointWingLocal': list(point), 'normalWingLocal': list(normal)})
    if abs(hits[0]['surfaceWorldZ'] - hits[1]['surfaceWorldZ']) > 1e-6:
        raise ValueError('Actual mirrored wing surfaces disagree at the new joint')
    height = sum(h['surfaceWorldZ'] for h in hits)/2 + RETAINED_BALL_TO_SKIN_RISE
    proposed = (ANCHOR_ABS_X, ANCHOR_Y, height)
    new_length = (Vector(proposed) - kinematics.brace_body(1)).length
    # Solve the actual current pose before any write. The generator starts in
    # hover; forcing the cruise slider here would leave a visibly detached rod.
    actual_slider = []
    for side, sign in SIDES:
        pivot = bpy.data.objects['WingPivot_' + side]
        local = Vector((sign * proposed[0], proposed[1], proposed[2])) - kinematics.pivot_position(sign)
        world = pivot.matrix_world @ local
        r2 = new_length**2 - (world.x - sign * kinematics.SLIDER_X)**2 - (world.z - kinematics.SLIDER_Z)**2
        if r2 <= 0:
            raise ValueError('Annotated rigid linkage has no real rear-slider closure: ' + side)
        actual_slider.append(world.y + math.sqrt(r2))
    if abs(actual_slider[0] - actual_slider[1]) > 1e-5:
        raise ValueError('Actual left/right wing poses do not close onto the same slider')

    kinematics.WING_ANCHOR_CRUISE = proposed
    ctx['WING_ANCHOR_CRUISE'] = proposed
    delta_length = new_length - previous_length
    changed = []
    for side, sign in SIDES:
        anchor = kinematics.brace_wing_local(sign)
        delta = anchor - Vector(previous_anchors[sign])
        bpy.data.objects['BraceWing_' + side].location = anchor
        bpy.data.objects['BraceBall_' + side + '_Wing'].location = anchor
        bpy.data.objects['BraceBallPin_' + side + '_Wing'].location += delta
        for obj in bpy.data.objects['BraceRod_' + side].children:
            if obj.name == 'BraceRod_mesh_' + side:
                inv = obj.matrix_basis.inverted()
                for vertex in obj.data.vertices:
                    p = obj.matrix_basis @ vertex.co
                    p.z = .034 + (p.z - .034)*(new_length - .068)/(previous_length - .068)
                    vertex.co = inv @ p
                obj.data.update()
                changed.append(obj.name)
            elif obj.name.endswith('_Root'):
                obj.location.z += delta_length
                changed.append(obj.name)
    bpy.data.objects['BraceSpreader'].location = (0, sum(actual_slider)/2, kinematics.SLIDER_Z)
    bpy.context.view_layer.update()
    for side, sign in SIDES:
        start = bpy.data.objects['BraceBody_' + side].matrix_world.translation
        end = bpy.data.objects['BraceWing_' + side].matrix_world.translation
        rod = bpy.data.objects['BraceRod_' + side]
        rod.location = start
        rod.rotation_mode = 'QUATERNION'
        rod.rotation_quaternion = kinematics.rod_rotation(end - start, bpy.data.objects['WingPivot_' + side].matrix_world.to_3x3() @ Vector((0, 0, 1)))
        rod.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    return {'cruiseAnchorBlender': list(proposed),
            'targetInterpretation': 'inward and aft (+Blender Y); image nose is downward',
            'actualTopSkinWitnesses': hits,
            'retainedBallToSkinRise': RETAINED_BALL_TO_SKIN_RISE,
            'rigidRodLength': new_length, 'oldRodLength': previous_length,
            'currentPoseSliderY': float(bpy.data.objects['BraceSpreader'].location.y),
            'changedRodNodes': changed,
            'requiresNewSeatSupportAndFullMotionEvidence': True}
