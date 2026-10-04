"""V21 固定表面附件：在原网格上补足有限贴合，不以共同父级冒充连接。

这是未经原厂标定的原创概念模型。这里的薄层、压入量与固定安装区仅用于
消除模型中真实存在的悬空，不是原厂结构、粘接工艺、制造公差或承载声明。
保留节点名称、父级、材质与局部矩阵；不填翼根、转轴、球铰或舱盖活动缝。
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


HORN_EMBED = .0010
LATCH_EMBED = .0010
ANTENNA_EMBED = .0012
TIP_EMBED = .00050
SADDLE_EMBED = .00065
SEAM_EMBED = .00030
PITOT_MOUNT_INNER_RADIUS = .0058


def _bounds(points):
    return [[float(min(p[k] for p in points)) for k in range(3)],
            [float(max(p[k] for p in points)) for k in range(3)]]


def _frame(obj):
    return obj.parent.matrix_world.copy() if obj.parent else Matrix.Identity(4)


def _points(obj, frame):
    transform = frame.inverted() @ obj.matrix_world
    return [transform @ v.co for v in obj.data.vertices]


def _set_points(obj, points, frame):
    transform = obj.matrix_world.inverted() @ frame
    original = _points(obj, frame)
    for vertex, point, old_point in zip(obj.data.vertices, points, original):
        # 不对未修改顶点做矩阵往返，确保销孔、外皮与远端逐点保留。
        if point != old_point:
            vertex.co = transform @ point
    obj.data.update()


def _tree(obj, frame):
    obj.data.calc_loop_triangles()
    points = _points(obj, frame)
    triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
    # 旧吊舱旋成网格整体朝内；BVH审计必须以真实材料向外方向解释。
    # 这里只规范查询用三角序，不修改支承壳网格或其历史法线。
    origin = sum(points, Vector())/len(points)
    signed_volume = sum((points[a]-origin).dot((points[b]-origin).cross(points[c]-origin))
                        for a, b, c in triangles)/6
    if signed_volume < 0:
        triangles = [(a, c, b) for a, b, c in triangles]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True, epsilon=0.0)


def _ray(tree, point, direction, start=.012, maximum=.085):
    direction = Vector(direction).normalized()
    hit, normal, index, distance = tree.ray_cast(point-direction*start, direction, maximum)
    if hit is None or normal.dot(direction) > -.12:
        return None
    return hit, normal


def _replace_geometry(obj, points, faces, frame):
    """仅换数据块；不通过对象变换或重新挂父级来移动附件。"""
    local = obj.matrix_world.inverted() @ frame
    old = obj.data
    original = _points(obj, frame)
    local_points = [old.vertices[i].co.copy()
                    if i < len(original) and point == original[i] else local @ point
                    for i, point in enumerate(points)]
    mesh = bpy.data.meshes.new(obj.name + '_V21实际贴合网格')
    mesh.from_pydata(local_points, [], faces)
    for material in old.materials:
        mesh.materials.append(material)
    mesh.update()
    obj.data = mesh
    for face in mesh.polygons:
        face.use_smooth = True


def _closed(obj):
    """保留封闭正材料；一张开放色片不能通过这项实体检查。"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-9)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.normal_update()
    boundary = sum(not edge.is_manifold for edge in bm.edges)
    degenerate = sum(face.calc_area() <= 1e-18 for face in bm.faces)
    volume = abs(bm.calc_volume(signed=True))
    if boundary or degenerate or volume <= 1e-12:
        bm.free()
        raise ValueError('V21固定附件实体异常：' + obj.name + str((boundary, degenerate, volume)))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.data.set_sharp_from_angle(angle=math.radians(45))
    return volume


def _inside_distance(tree, point):
    hit, normal, index, distance = tree.find_nearest(point)
    if hit is None or distance <= 2e-7:
        return None
    # 对正确定向的封闭网格，最近表面处有向距离辨别真实材料侧。
    # 包括机壳内壁；这里不会把空腔或包围盒内部误认成材料。
    return float(distance) if (point-hit).dot(normal) < -2e-7 else None


def _contact(obj, host, label):
    """寻找同时严格位于两实际闭合网格内的有限接合证据。"""
    frame = _frame(obj)
    source = _tree(obj, frame)
    target = _tree(host, frame)
    points = _points(obj, frame)
    obj.data.calc_loop_triangles()
    candidates = []
    for triangle in obj.data.loop_triangles:
        a, b, c = (points[i] for i in triangle.vertices)
        normal = (b-a).cross(c-a).normalized()
        center = (a+b+c)/3
        candidates.extend((point, normal) for point in
                          (center, a*.6+b*.2+c*.2, a*.2+b*.6+c*.2, a*.2+b*.2+c*.6))
    witnesses = []
    depths = []
    # 每个源三角形至少有一个检查位置，避免只靠碰巧命中的单个顶点。
    # 距离阶梯远小于真实附件宽度，仅检查原附件/安装壳两者材料。
    for center, normal in candidates:
        for inset in (.00004, .00012, .00030, .00060):
            point = center-normal*inset
            dh = _inside_distance(target, point)
            if dh is None:
                continue
            ds = _inside_distance(source, point)
            if ds is not None:
                witnesses.append(point)
                depths.append(min(ds, dh))
                break
    if len(witnesses) < 4:
        raise ValueError('V21未找到足够真实有限材料接合：' + obj.name + ' / ' + host.name + '，样点=' + str(len(witnesses)))
    bounds = _bounds(witnesses)
    spans = sorted(bounds[1][k]-bounds[0][k] for k in range(3))
    if spans[-2] < .0005:
        raise ValueError('V21接合退化为单点/单线：' + obj.name + ' / ' + host.name)
    step = max(1, math.ceil(len(witnesses)/32))
    return {
        'pair': [obj.name, host.name], 'role': label,
        'frameNode': obj.parent.name if obj.parent else None,
        'coordinateSystem': 'Blender父节点局部坐标；无父节点时为Blender世界坐标',
        'method': '两实际封闭网格最近三角面有向距离的严格材料内样点，不使用父级或包围盒代替支承',
        'strictInteriorSamples': len(witnesses),
        'minimumWitnessBoundaryDistance': min(depths),
        'maximumWitnessBoundaryDistance': max(depths),
        'finiteContactBoundsBlender': bounds,
        'interiorWitnessesBlender': [list(p) for p in witnesses[::step]],
        'sameRigidAttachment': True,
    }


def _record(obj, host, method, before, **details):
    volume = _closed(obj)
    # 每个实际附件应为一个连通实体，不能用单个贴壳小碎片替整组背书。
    adjacency = {vertex.index: set() for vertex in obj.data.vertices}
    for edge in obj.data.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    unseen = set(adjacency)
    components = 0
    while unseen:
        components += 1
        pending = [unseen.pop()]
        while pending:
            for neighbor in adjacency[pending.pop()]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    pending.append(neighbor)
    if components != 1:
        raise ValueError('V21附件不是单连通闭合实体：' + obj.name)
    frame = _frame(obj)
    obj['surfaceSupportVersion'] = 21
    obj['surfaceSupportMethod'] = method
    obj['surfaceSupportConceptOnly'] = True
    row = {
        'node': obj.name, 'support': host.name, 'method': method,
        'parent': obj.parent.name if obj.parent else None,
        'beforeBoundsBlender': _bounds(before),
        'afterBoundsBlender': _bounds(_points(obj, frame)),
        'coordinateSystem': '原父节点局部Blender坐标',
        'closedVolume': volume, 'connectedComponents': components, 'transformPreserved': True,
        'materialPreserved': True, **details,
    }
    return row, _contact(obj, host, method)


def _cap_open_tube(obj, sides):
    frame = _frame(obj)
    points = _points(obj, frame)
    faces = [tuple(p.vertices) for p in obj.data.polygons]
    faces.extend([tuple(range(sides-1, -1, -1)),
                  tuple(range(len(points)-sides, len(points)))])
    _replace_geometry(obj, points, faces, frame)


def _fit_seam(obj, host, sides, closed):
    """仅移动原截面至首个有限微嵌位置，保持路径、管径和原宿主。"""
    frame = _frame(obj)
    points = _points(obj, frame)
    before = [p.copy() for p in points]
    tree = _tree(host, frame)
    if len(points) % sides:
        raise ValueError('V21接缝离散结构与已知截面不符：' + obj.name)
    moves = []
    for start in range(0, len(points), sides):
        ring = points[start:start+sides]
        center = sum(ring, Vector())/sides
        hit, normal, index, distance = tree.find_nearest(center)
        if hit is None or distance > .020:
            raise ValueError('V21接缝离原宿主壳过远：' + obj.name)
        deepest = min((point-center).dot(normal) for point in ring)
        # 用原离散截面的实际最内点，而非理想圆管半径，计算最小位移。
        shift = hit+normal*(-deepest-SEAM_EMBED)-center
        moves.append(shift.length)
        for i in range(start, start+sides):
            points[i] += shift
    _set_points(obj, points, frame)
    if not closed:
        _cap_open_tube(obj, sides)
    return _record(obj, host, '原接缝管逐截面最小微嵌至真实机壳，开放端封闭', before,
                   maximumRingShift=max(moves), sectionCount=len(points)//sides,
                   sectionSides=sides, nominalEmbedding=SEAM_EMBED,
                   originalTubeSectionPreserved=True, visualSeamNotStructuralJoint=True)


def _fit_saddle(obj, host):
    """原整流罩可见外面不动，沿真实舱壳补内壁和边壁成为贴壳薄罩。"""
    frame = _frame(obj)
    before = _points(obj, frame)
    tree = _tree(host, frame)
    bottom = []
    for point in before:
        result = _ray(tree, point, (0, 0, -1), start=.008, maximum=.030)
        if result is None:
            raise ValueError('V21整流罩未命中实际舱壳：' + obj.name)
        bottom.append(result[0]-Vector((0, 0, SADDLE_EMBED)))
    faces = [tuple(p.vertices) for p in obj.data.polygons]
    n = len(before)
    shell_faces = faces + [tuple(i+n for i in reversed(face)) for face in faces]
    edges = {}
    for face in faces:
        for a, b in zip(face, face[1:]+face[:1]):
            edges.setdefault(tuple(sorted((a, b))), []).append((a, b))
    for uses in edges.values():
        if len(uses) == 1:
            a, b = uses[0]
            shell_faces.append((b, a, a+n, b+n))
    _replace_geometry(obj, before+bottom, shell_faces, frame)
    row, contact = _record(obj, host, '保留原整流罩外面，增加真实贴壳内壁和四周封边', before,
                          originalVisibleVerticesUnchanged=True, visibleVertexCount=n,
                          originallyOpenSurface=True, nominalEmbedding=SADDLE_EMBED,
                          supportType='非原厂概念薄整流罩；不是独立假支架')
    bounds = contact['finiteContactBoundsBlender']
    if contact['strictInteriorSamples'] < 24 or bounds[1][0]-bounds[0][0] < .20 or bounds[1][1]-bounds[0][1] < .35:
        raise ValueError('V21整流罩有限贴合覆盖不足：' + obj.name)
    contact['minimumRequiredContactSpanBlenderXY'] = [.20, .35]
    contact['singleClosedComponentVerified'] = True
    return row, contact


def build_surface_supports(ctx):
    bpy.context.view_layer.update()
    rows, contacts = [], []
    identities = {o.name: (o.parent, o.matrix_basis.copy(), tuple(o.data.materials))
                  for o in bpy.data.objects if o.type == 'MESH'}

    def add(result):
        row, contact = result
        rows.append(row)
        contacts.append(contact)

    # 舵角只抬高原三角板根部四角，销孔与活动轴不变；接合随同舵面运动。
    for side in ('L', 'R'):
        for which in ('Inboard', 'Outboard'):
            key = side+'_'+which
            obj = bpy.data.objects['ControlHorn_'+key]
            host = bpy.data.objects['ControlSurface_'+key]
            frame = _frame(obj)
            points = _points(obj, frame)
            before = [p.copy() for p in points]
            top = max(p.z for p in points)
            tree = _tree(host, frame)
            changed = 0
            for i, point in enumerate(points):
                if point.z < top-1e-6:
                    continue
                result = _ray(tree, point, (0, 0, 1), start=.002, maximum=.020)
                if result is None:
                    raise ValueError('V21舵角根部未命中所属舵面：' + key)
                hit, normal = result
                points[i] = hit+Vector((0, 0, HORN_EMBED))
                changed += 1
            _set_points(obj, points, frame)
            add(_record(obj, host, '只延伸原舵角板根部，与所属舵面形成有限材料接合', before,
                        rootVerticesChanged=changed, nominalEmbedding=HORN_EMBED,
                        boreAndControlAxisPreserved=True))

    # 搭扣的原外表面和横销保持不动，仅把原座/拉片的内半厚度延长贴壳。
    # 固定座贴机身；活动拉片只贴本身舱盖，不用桥接舱口来消灭活动间隙。
    for side in ('L', 'R'):
        fixed = bpy.data.objects['CargoLatchFixed_'+side]
        normal_world = fixed.matrix_world.to_3x3() @ Vector((0, 0, 1))
        normal_world.normalize()
        # 原搭扣姿态的局部+Z指向壳内；只由实际机身最近面判定外法向，
        # 不改历史节点旋转，也不把内外半厚度选反。
        hull_world = _tree(bpy.data.objects['Fuselage'], Matrix.Identity(4))
        nearest = hull_world.find_nearest(fixed.matrix_world.translation)
        if nearest[0] is None:
            raise ValueError('V21搭扣无法判定原机身外法向：' + side)
        if normal_world.dot(nearest[1]) < 0:
            normal_world *= -1
        for prefix, host_name in [('CargoLatchFixed_', 'Fuselage'),
                                  ('CargoLatchMoving_', 'CargoHoodShell')]:
            obj = bpy.data.objects[prefix+side]
            host = bpy.data.objects[host_name]
            frame = _frame(obj)
            normal = (frame.inverted().to_3x3() @ normal_world).normalized()
            points = _points(obj, frame)
            before = [p.copy() for p in points]
            center = sum(points, Vector())/len(points)
            tree = _tree(host, frame)
            changed = 0
            for i, point in enumerate(points):
                if (point-center).dot(normal) >= -1e-6:
                    continue
                result = _ray(tree, point, -normal, start=.006, maximum=.060)
                if result is None:
                    continue
                hit, hit_normal = result
                points[i] = hit-normal*LATCH_EMBED
                changed += 1
            if changed < 4:
                raise ValueError('V21搭扣实际贴壳根部不足：' + obj.name)
            _set_points(obj, points, frame)
            add(_record(obj, host, '保留原搭扣外观和横销位置，仅原内侧底面延伸贴合所属壳体', before,
                        rootVerticesChanged=changed, nominalEmbedding=LATCH_EMBED,
                        movingOpeningGapPreserved=True))
        contacts.append(_contact(bpy.data.objects['CargoLatchPin_'+side], fixed,
                                 '原横销与原固定座既有有限接合，横销网格未改'))

    antenna = bpy.data.objects['Dorsal_antenna']
    host = bpy.data.objects['Fuselage']
    frame = _frame(antenna)
    points = _points(antenna, frame)
    before = [p.copy() for p in points]
    tree = _tree(host, frame)
    for i in range(8):
        result = _ray(tree, points[i], (0, 0, -1), start=.015, maximum=.050)
        if result is None:
            raise ValueError('V21背部天线根部未命中机身')
        points[i] = result[0]-Vector((0, 0, ANTENNA_EMBED))
    _set_points(antenna, points, frame)
    _cap_open_tube(antenna, 8)
    add(_record(antenna, host, '保留天线端点和杆身，原根圈延伸入机壳并封闭两端', before,
                nominalEmbedding=ANTENNA_EMBED, originalOpenEndsClosed=True))

    for side in ('L', 'R'):
        for end in ('Front', 'Rear'):
            key = side+'_'+end
            host = bpy.data.objects['Nacelle_'+key]
            obj = bpy.data.objects['Landing_wear_tip_'+key]
            frame = _frame(obj)
            points = _points(obj, frame)
            before = [p.copy() for p in points]
            tree = _tree(host, frame)
            # V11内壁最后160个顶点为40分段的四个内圈。只改变前两圈，
            # 在相对舱壳纵向[.994,1.009375]形成有限固定安装带。
            # 可见外圈、接地点及后段原.0002径向/端面余隙全部保持。
            if len(points) < 320:
                raise ValueError('V21接地端内壁拓扑不符：' + obj.name)
            inner_start = len(points)-160
            for i in range(inner_start, inner_start+80):
                hit, normal, index, distance = tree.find_nearest(points[i])
                if hit is None or distance > .00040:
                    raise ValueError('V21接地端内壁不是原.0002间隙带：' + obj.name)
                points[i] = hit-normal*TIP_EMBED
            _set_points(obj, points, frame)
            add(_record(obj, host, '仅原接地端前两内圈内收，形成有限环形固定安装带', before,
                        changedInnerVertices=80, originalOuterVerticesUnchanged=True,
                        nacelleLongitudinalBand=[.994, 1.009375],
                        nominalEmbedding=TIP_EMBED, distalClearancePreserved=.0002))
            add(_fit_saddle(bpy.data.objects['Pod_wing_saddle_'+key], host))

    # 全机检查确认这三个完整线管没有与真实宿主接合；只修这些确诊对象。
    add(_fit_seam(bpy.data.objects['Dorsal_hatch_main'], bpy.data.objects['Fuselage'], 5, True))
    for suffix in ('001', '003'):
        name = 'Lower_fuselage_join'+suffix
        obj = bpy.data.objects.get(name) or bpy.data.objects['Lower_fuselage_join.'+suffix]
        add(_fit_seam(obj, bpy.data.objects['Fuselage'], 4, False))

    # 原探头夹座并非运动轴承。其整段.0004装配缝使探管没有有限固定连接，
    # 仅收紧原夹座两内圈；外径、轴线、固定脚、探管与真实气流内孔均不改。
    obj = bpy.data.objects['Pitot_probe_mount']
    host = bpy.data.objects['Pitot_probe_tube']
    frame = _frame(obj)
    points = _points(obj, frame)
    before = [point.copy() for point in points]
    radial = 36
    if len(points) != radial*4:
        raise ValueError('V21探头夹座四圈拓扑与原生成器不符')
    centers = []
    for start in (radial*2, radial*3):
        center = sum(points[start:start+radial], Vector())/radial
        centers.append(center)
        for i in range(start, start+radial):
            delta = points[i]-center
            if abs(delta.length-.0064) > 2e-6:
                raise ValueError('V21探头夹座不是原.0064内半径')
            points[i] = center+delta*(PITOT_MOUNT_INNER_RADIUS/.0064)
    _set_points(obj, points, frame)
    add(_record(obj, host, '仅原探头夹座内壁半径.0064收至.0058，与探管形成有限固定环带', before,
                originalOuterVerticesUnchanged=True, changedInnerVertices=72,
                oldInnerRadius=.0064, newInnerRadius=PITOT_MOUNT_INNER_RADIUS,
                unchangedTubeOuterRadius=.006, unchangedAirflowBoreRadius=.0034,
                originalAxisPreserved=True, annularEndCentersBlender=[list(p) for p in centers],
                unchangedTubeAndFoot=True, nominalRadialEngagement=.0002))

    for row in rows:
        obj = bpy.data.objects[row['node']]
        parent, matrix, materials = identities[obj.name]
        if obj.parent != parent or tuple(obj.data.materials) != materials or any(
                abs(obj.matrix_basis[i][j]-matrix[i][j]) > 1e-12
                for i in range(4) for j in range(4)):
            raise ValueError('V21固定附件改变了节点身份/局部矩阵：' + obj.name)
    return {
        'version': 21, 'conceptOnly': True,
        'claimBoundary': '原创概念模型的真实有限贴合，不是原厂CAD、制造尺寸、粘接工艺或承载证明',
        'changedNodes': [row['node'] for row in rows],
        'changes': rows, 'finiteContactPairs': contacts,
        'preserved': ['全部修改件的名称/父级/局部矩阵/材质', '舵角销孔与全部既有运动轴',
                      '舱盖开口活动净空', '接地端可见外皮、接地点与后段内壁余隙',
                      '未修改原主轴/球铰/舱盖铰支承/任何活动轴承间隙'],
        'decorativeClassification': {
            'Pod_wing_saddle': '原定义为鞍形整流小罩，保留可见原面并补单连通贴壳薄实体，非原厂结构声明',
            'Fixed_root_blue': '原涂装面及精确色边编码保持；有意表面偏置，非金属紧固件或结构支承',
            'PanelSeams': '仅三件确诊完全离壳的原接缝管微嵌贴面；其余管径和表面偏置保持，不作为承力结构',
            'audit': 'qa/v21/diagnostic/decorations-v20.json',
        },
        'newCollisionExemptions': [],
        'verificationLimit': '作者检查使用严格材料内有限样点；最终源/压缩GLB及相对运动仍需独立复核',
    }
