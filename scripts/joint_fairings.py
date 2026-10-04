"""实际移轴后的紧凑薄壁轴罩；原创概念外观，非原厂CAD。

罩径位于新翼皮的真实轴孔内，保留两半罩闭壳和有限壁厚。
通过原实体桥/底座安装至同一刚体翼皮，不以罩壳跨接两片活动翼。
轴承、轴心、端帽、回转套和现有支脚的局部几何不变。
"""
import hashlib
import math
import struct

import bpy
import bmesh
from mathutils import Vector
from embedded_joint_surfaces import joint_profile

WALL = .0025
OUTER_RADIUS = .044
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
    # 窄检修边缘两侧保持独立法线，不能通过平滑掩盖实体分缝。
    obj.data.set_sharp_from_angle(angle=math.radians(38))
    return volume


def _dome(context, side, sign, fixed):
    axis = context['wing_axis'](sign).normalized()
    origin = context['pivot_position'](sign) if fixed else Vector((0, 0, 0))
    u = axis.cross(Vector((0, 0, 1))).normalized()
    v = axis.cross(u).normalized()
    outward = 1 if fixed else -1
    parent = None if fixed else bpy.data.objects['WingPivot_' + side]
    # 轴向泪滴闭壳围住未改端帽；固定端保留额外轴向内腔。
    length = .142 if fixed else .082
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
    obj['fairingRevision'] = 24
    obj['conceptOnly'] = True
    obj['fairingRole'] = '固定翼侧中空蒙皮罩' if fixed else '活动翼侧中空蒙皮罩'
    obj['wallThicknessNominal'] = WALL
    obj['originalHardwareRetained'] = True
    obj['jointClearanceNotFilled'] = True
    return obj, volume


def build_fairing_refinements(context):
    """在实际有限支承构造后、原生动画烘焙前生成当前两半罩。"""
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
            # 罩壳位于翼皮轴孔内，真实安装路径经原支脚，不要求壳面埋入翼皮。
            support = bpy.data.objects[('RootFixedBearingPedestal_' if fixed else 'RootCarrierBridge_') + side]
            contacts.append(_contact(obj, support, '蒙皮罩与同刚体原有限安装足相接；原安装足网格不变'))
            objects.append(obj.name)
            topology.append({'node': obj.name, 'closedVolume': volume,
                             'vertices': len(obj.data.vertices), 'triangles': len(obj.data.polygons),
                             'parent': obj.parent.name if obj.parent else None})
    after = {o.name: _digest(o) for o in hardware}
    if before != after:
        raise ValueError('V22 fairing changed protected internal hinge hardware')
    return {'version': 24, 'conceptOnly': True, 'newNodes': objects,
            'construction': '固定/活动两侧独立薄壁旋转曲面蒙皮罩，内外曲面与闭合分缝边形成真实空腔',
            'nominalWallThickness': WALL, 'outerRadius': OUTER_RADIUS,
            'serviceSeamAxialGap': 2*HALF_SEAM,
            'attachmentDesign':{'path':'薄罩→原实体桥/底座→同刚体翼皮','directWingContactRequired':False,
                'wingBoreRadius':.045,'nominalRadialWingGap':.045-OUTER_RADIUS,
                'fixedAxialLength':.142,'movingAxialLength':.082,
                'scope':'名义尺寸为模型单位；内腔、孔壁和跨刚体实际净空须独立验证'},
            'movingRangeDegrees': 120,
            'geometryInvariant': '每个罩顶点都位于原主轴旋转不变的joint_profile(r)一侧；不以遮挡或跨关节实心盖代替结构',
            'fixedAttachmentInterfaces': contacts, 'topology': topology,
            'protectedHardwareDigests': before, 'protectedHardwareUnchanged': before == after,
            'sourceBoundary': '原创工业外观概念；不是原厂CAD、载荷、制造厚度或安装工艺认证'}
