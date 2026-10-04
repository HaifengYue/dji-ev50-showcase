"""V22 紧凑翼面主铰链蒙皮罩，原创概念外观，非原厂 CAD。

只新增固定/活动两组真实薄壁罩；既有主轴、端帽、轴承、回转套、
翼面及120度运动完全不改。两罩分缝沿同轴旋转不变曲面，空腔
由内外两套曲面及有限闭合边缘构成，不靠隐藏原件假装包裹。
"""
import hashlib
import math
import struct

import bpy
import bmesh
from mathutils import Vector
from embedded_joint_surfaces import joint_profile

WALL = .0025
OUTER_RADIUS = .054
HALF_SEAM = .0015
RADIAL_SEGMENTS = 72
PROFILE_SEGMENTS = 20


def _digest(obj):
    values = [*obj.matrix_local]
    h = hashlib.sha256()
    for row in values:
        h.update(struct.pack('<4d', *row))
    for v in obj.data.vertices:
        h.update(struct.pack('<3d', *v.co))
    for p in obj.data.polygons:
        h.update(struct.pack('<%di' % len(p.vertices), *p.vertices))
    return h.hexdigest()


def _closed(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.normal_update()
    boundary = sum(not e.is_manifold for e in bm.edges)
    degenerate = sum(f.calc_area() <= 1e-18 for f in bm.faces)
    volume = bm.calc_volume(signed=True)
    if boundary or degenerate or volume <= 1e-10:
        raise ValueError('V22 fairing must be a positive closed thin-wall solid: ' + obj.name + str((boundary, degenerate, volume)))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    for face in obj.data.polygons:
        face.use_smooth = True
    # Both sides of the narrow service rim remain independent from the exterior.
    obj.data.set_sharp_from_angle(angle=math.radians(38))
    return volume


def _dome(context, side, sign, fixed):
    axis = context['wing_axis'](sign).normalized()
    origin = context['pivot_position'](sign) if fixed else Vector((0, 0, 0))
    u = axis.cross(Vector((0, 0, 1))).normalized()
    v = axis.cross(u).normalized()
    outward = 1 if fixed else -1
    parent = None if fixed else bpy.data.objects['WingPivot_' + side]
    # Axial teardrop, with just enough room around the unchanged endcaps.
    length = .134 if fixed else .082
    verts, faces = [], []
    rings = []
    for inner in (False, True):
        radius = OUTER_RADIUS - (WALL if inner else 0)
        depth = length - (WALL if inner else 0)
        pole = len(verts)
        verts.append(tuple(origin + axis*(joint_profile(0) + outward*(HALF_SEAM + depth))))
        layers = []
        for k in range(1, PROFILE_SEGMENTS + 1):
            phi = math.pi*.5*k/PROFILE_SEGMENTS
            r = radius*math.sin(phi)
            t = joint_profile(r) + outward*(HALF_SEAM + depth*math.cos(phi))
            ring = []
            for j in range(RADIAL_SEGMENTS):
                a = j*2*math.pi/RADIAL_SEGMENTS
                ring.append(len(verts))
                verts.append(tuple(origin + axis*t + r*(u*math.cos(a) + v*math.sin(a))))
            layers.append(ring)
        for j in range(RADIAL_SEGMENTS):
            q = (j+1) % RADIAL_SEGMENTS
            faces.append((pole, layers[0][j], layers[0][q]))
        for a, b in zip(layers[:-1], layers[1:]):
            for j in range(RADIAL_SEGMENTS):
                q = (j+1) % RADIAL_SEGMENTS
                faces.append((a[j], b[j], b[q], a[q]))
        rings.append(layers[-1])
    for j in range(RADIAL_SEGMENTS):
        q = (j+1) % RADIAL_SEGMENTS
        faces.append((rings[0][j], rings[0][q], rings[1][q], rings[1][j]))
    name = 'RootFairing' + ('Fixed_' if fixed else 'Moving_') + side
    obj = context['mesh_object'](name, verts, faces, context['body'], parent)
    volume = _closed(obj)
    obj['fairingRevision'] = 22
    obj['conceptOnly'] = True
    obj['fairingRole'] = '固定翼侧中空蒙皮罩' if fixed else '活动翼侧中空蒙皮罩'
    obj['wallThicknessNominal'] = WALL
    obj['originalHardwareRetained'] = True
    obj['jointClearanceNotFilled'] = True
    return obj, volume


def build_fairing_refinements(context):
    """Call after V21 finite supports and before animation baking/export.

    Context is generate_transwing.py globals(). It needs mesh_object, body,
    wing_axis and pivot_position. No production path writes happen here.
    """
    from surface_supports import _contact
    hardware = sorted([o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith((
        'RootHingeShaft_', 'RootHingeEndcap_', 'RootBearing', 'RootCarrier', 'RootFixedBearingPedestal_'))],
        key=lambda o: o.name)
    before = {o.name: _digest(o) for o in hardware}
    objects, contacts, topology = [], [], []
    for side, sign in [('L', -1), ('R', 1)]:
        for fixed in (True, False):
            obj, volume = _dome(context, side, sign, fixed)
            bpy.context.view_layer.update()
            host = bpy.data.objects[('Fixed_root_' if fixed else 'Composite_wing_') + side]
            contacts.append(_contact(obj, host, '两实际闭合材料的有限安装边接合；内部空腔及活动分缝保留'))
            support = bpy.data.objects[('RootFixedBearingPedestal_' if fixed else 'RootCarrierBridge_') + side]
            contacts.append(_contact(obj, support, '蒙皮罩与同刚体原有限安装足相接；原安装足网格不变'))
            objects.append(obj.name)
            topology.append({'node': obj.name, 'closedVolume': volume,
                             'vertices': len(obj.data.vertices), 'triangles': len(obj.data.polygons),
                             'parent': obj.parent.name if obj.parent else None})
    after = {o.name: _digest(o) for o in hardware}
    if before != after:
        raise ValueError('V22 fairing changed protected internal hinge hardware')
    return {'version': 22, 'conceptOnly': True, 'newNodes': objects,
            'construction': '固定/活动两侧独立薄壁旋转曲面蒙皮罩，内外曲面与闭合分缝边形成真实空腔',
            'nominalWallThickness': WALL, 'outerRadius': OUTER_RADIUS,
            'serviceSeamAxialGap': 2*HALF_SEAM,
            'movingRangeDegrees': 120,
            'geometryInvariant': '每个罩顶点都位于原主轴旋转不变的joint_profile(r)一侧；不以遮挡或跨关节实心盖代替结构',
            'fixedAttachmentInterfaces': contacts, 'topology': topology,
            'protectedHardwareDigests': before, 'protectedHardwareUnchanged': before == after,
            'sourceBoundary': '原创工业外观概念；不是原厂CAD、载荷、制造厚度或安装工艺认证'}
