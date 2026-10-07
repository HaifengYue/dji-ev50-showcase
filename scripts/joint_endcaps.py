"""V20 接合收口：真实裁去槽顶板外露部分，缩短无必要的销端。

不改变机身、V尾、运动轴、球心或传动链。尺寸是概念模型的局部修正，
不是原厂装配公差或可制造性声明。所有修正都进入真实网格，不依赖显隐。
"""
import math

import bmesh
import bpy
from mathutils import Vector

SLOT_RADIAL_SETBACK = .002
BALL_PIN_FREE_END = .017
WING_PIN_FREE_END = .014
BODY_PIN_SEAT_END = .035
BLADE_PIN_HALF_LENGTH = .049


def _validate_closed(obj):
    """布尔或替换后仍须有闭合的正材料，不把消失的网格当作修复。"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    boundary = sum(not edge.is_manifold for edge in bm.edges)
    zero = sum(face.calc_area() <= 1e-18 for face in bm.faces)
    volume = abs(bm.calc_volume(signed=True))
    if boundary or zero or volume <= 1e-10:
        bm.free()
        raise ValueError('V20接合实体不闭合或退化：' + obj.name)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.data.set_sharp_from_angle(angle=math.radians(42))
    return volume


def _replace_pin(ctx, name, start, end, radius, vertices):
    """以原对象局部坐标替换销网格，保持节点矩阵、父级和材质身份。"""
    obj = bpy.data.objects[name]
    before_matrix = obj.matrix_basis.copy()
    replacement = ctx['cylinder_between'](
        'Temporary_V20_recessed_pin', start, end, radius,
        obj.data.materials[0], obj.parent, vertices=vertices, bevel_width=.0007,
    )
    bpy.context.view_layer.update()
    replacement.data.transform(obj.matrix_basis.inverted() @ replacement.matrix_basis)
    obj.data = replacement.data
    bpy.data.objects.remove(replacement, do_unlink=True)
    volume = _validate_closed(obj)
    if any(abs(before_matrix[i][j] - obj.matrix_basis[i][j]) > 1e-12
           for i in range(4) for j in range(4)):
        raise ValueError('V20不允许接合销节点矩阵改变：' + name)
    obj['jointRefinementVersion'] = 20
    obj['jointRefinement'] = '仅缩短无必要外露端，保留真实销体、原轴线与支承穿入段'
    return {
        'node': name,
        'parent': obj.parent.name if obj.parent else None,
        'parentLocalStartBlender': list(start),
        'parentLocalEndBlender': list(end),
        'radius': radius,
        'volume': volume,
        'transformPreserved': True,
    }


def build_joint_refinements(ctx):
    rows = []
    # 外模线刀具不是空心机壳。用与机身相同的截面和角采样构造实心
    # 内收包络，盖板与该包络取真实交集；不削机身，也不加盖掩住突出物。
    # The roof is a fixed preserved part; slider relocation must not resize it.
    from pathlib import Path
    import json
    roof_domain = json.loads((Path(__file__).with_name('data') / 'slot-roof-preservation.json').read_text())
    if roof_domain['schema'] != 'transwing.original-slot-roof-preservation.v1' or roof_domain['radialSetback'] != SLOT_RADIAL_SETBACK:
        raise ValueError('Frozen original slot-roof domain mismatch')
    y0, y1 = roof_domain['domainStartBlenderY'], roof_domain['domainEndBlenderY']
    stations = [y0] + [s[0] for s in ctx['body_dense'] if y0 < s[0] < y1] + [y1]
    n = 64
    vertices = [ctx['fuselage_point'](y, k * 2 * math.pi / n, -SLOT_RADIAL_SETBACK)
                for y in stations for k in range(n)]
    faces = []
    for j in range(len(stations) - 1):
        for k in range(n):
            kk = (k + 1) % n
            faces.append((j*n+k, j*n+kk, (j+1)*n+kk, (j+1)*n+k))
    faces += [tuple(range(n-1, -1, -1)),
              tuple((len(stations)-1)*n+k for k in range(n))]
    envelope = ctx['mesh_object']('Temporary_V20_inset_outer_envelope', vertices, faces, None)
    _validate_closed(envelope)
    for side in ('L', 'R'):
        obj = bpy.data.objects['ActuatorSideSlot_' + side]
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        old_volume = abs(bm.calc_volume(signed=True))
        bm.free()
        bpy.context.view_layer.update()
        mod = obj.modifiers.new('V20按真实机身外廓裁掉突出板端', 'BOOLEAN')
        mod.operation = 'INTERSECT'
        mod.solver = 'EXACT'
        mod.object = envelope
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        volume = _validate_closed(obj)
        if not .65 * old_volume < volume < .99 * old_volume:
            raise ValueError('V20槽顶板减材范围异常：' + side + str((old_volume, volume)))
        obj['jointRefinementVersion'] = 20
        obj['jointRefinement'] = '真实封闭板端按同一机身外模线径向内收裁剪，节点仍存在且完整可见'
        obj['outerMoldLineRadialSetback'] = SLOT_RADIAL_SETBACK
        rows.append({
            'node': obj.name,
            'method': '与真实外模线内收包络求实体交集',
            'radialSetback': SLOT_RADIAL_SETBACK,
            'volumeBefore': old_volume,
            'volumeAfter': volume,
            'removedVolume': old_volume - volume,
            'originalVerticalBoundsBlender': [.106, .114],
            'slotTravelAndHullPreserved': False,
            'updatedSlotTravelBlender': [ctx['slot_min'],ctx['slot_max']],
            'originalRefinementMethodPreserved': True,
        })
    bpy.data.objects.remove(envelope, do_unlink=True)

    pins = []
    for side, sign in [('L', -1), ('R', 1)]:
        ball = Vector((sign * ctx['SLIDER_X'], 0, 0))
        axis = Vector((-sign*.664, -.307, .679)).normalized()
        row = _replace_pin(ctx, 'BraceBallPin_' + side + '_Body',
                           ball - axis * BALL_PIN_FREE_END,
                           ball + axis * BODY_PIN_SEAT_END, .0045, 12)
        row.update({'ball': 'BraceBall_' + side + '_Body',
                    'support': 'BraceBodyCarriage_' + side,
                    'ballCenterBlender': list(ball), 'axisBlender': list(axis),
                    'oldAxialBounds': [-.022, .042], 'newAxialBounds': [-.017, .035]})
        pins.append(row)
        ball = ctx['brace_wing_local'](sign)
        axis = Vector((0, 0, 1))
        row = _replace_pin(ctx, 'BraceBallPin_' + side + '_Wing',
                           ball - axis * .031, ball + axis * WING_PIN_FREE_END, .0045, 12)
        row.update({'ball': 'BraceBall_' + side + '_Wing',
                    'support': 'BraceWingSeat_' + side,
                    'ballCenterBlender': list(ball), 'axisBlender': list(axis),
                    'oldAxialBounds': [-.031, .022], 'previousRefinedAxialBounds':[-.031,.017], 'newAxialBounds': [-.031, WING_PIN_FREE_END],
                    'currentReason':'当前分层翼根扫掠要求自由端完全收在球内，保留向翼座的真实穿入段和原销轴'})
        pins.append(row)
        for end in ('Front', 'Rear'):
            for leaf, leaf_sign in [('A', -1), ('B', 1)]:
                name = 'Blade_hinge_pin_' + side + '_' + end + '_' + leaf
                row = _replace_pin(ctx, name,
                                   (leaf_sign*.170, -BLADE_PIN_HALF_LENGTH, 0),
                                   (leaf_sign*.170, BLADE_PIN_HALF_LENGTH, 0), .006, 24)
                row.update({'support': 'Blade_hinge_arm_' + side + '_' + end + '_' + leaf,
                            'parentLocalAxisBlender': [0, 1, 0],
                            'oldAxialBounds': [-.054, .054], 'newAxialBounds': [-.049, .049],
                            'forkOuterAxialBounds': [-.050, .050],
                            'nominalEndRecess': .001})
                pins.append(row)
    return {
        'version': 20,
        'conceptOnly': True,
        'reference': '用户V19尾根局部截图；实际GLB无阴影隔离和射线命中共同确认槽顶板外露',
        'slotCovers': rows,
        'recessedPins': pins,
        'currentWingPinFreeEnd':WING_PIN_FREE_END,
        'changedNodes': [r['node'] for r in rows + pins],
        'preserved': ['全部对象父级/局部变换/材质', '机身真实内腔与外模线', 'V尾翼与舵面',
                      '槽行程', '球心/定长杆/折翼轴', '中央横梁与全部内部驱动',
                      '旋翼真实相位和双手性扭转桨叶', '两套完整烘焙动作'],
        'newCollisionExemptions': [],
        'claimBoundary': '真实有限减材的原创概念修正；不构成制造、结构、气动或适航证明',
    }
