"""V22 蓝色前缘外皮法线整理；不细分、不移动几何、不抹掉真实活动缝。

V21源中主翼已有解析外皮法线，蓝色薄层仍靠布尔/三角化邻面平均。
只在颜色外皮的真实外侧，以最近主翼三角形的角点法线重建连续场。
封边、内侧、断面、孔缘保持原法线；不是借材质或法线隐藏几何缺口。
"""
import hashlib
import math
import struct

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


PAIRS = [('Fixed_root_blue_', 'Fixed_root_'), ('Wing_blue_leading_', 'Composite_wing_')]


def _positions_digest(obj):
    h = hashlib.sha256()
    for vertex in obj.data.vertices:
        h.update(struct.pack('<3d', *vertex.co))
    return h.hexdigest()


def _interpolate(point, a, b, c, normals):
    ab, ac, ap = b-a, c-a, point-a
    d00, d01, d11 = ab.dot(ab), ab.dot(ac), ac.dot(ac)
    den = d00*d11-d01*d01
    if abs(den) < 1e-20:
        return sum(normals, Vector()).normalized()
    v = (d11*ap.dot(ab)-d01*ap.dot(ac))/den
    w = (d00*ap.dot(ac)-d01*ap.dot(ab))/den
    weights = [max(0, min(1, 1-v-w)), max(0, min(1, v)), max(0, min(1, w))]
    total = sum(weights)
    return sum((n*(weight/total) for n, weight in zip(normals, weights)), Vector()).normalized()


def build_surface_finish(context=None):
    rows = []
    for side in ('L', 'R'):
        for prefix, host_prefix in PAIRS:
            obj, host = bpy.data.objects[prefix+side], bpy.data.objects[host_prefix+side]
            before = _positions_digest(obj)
            host.data.calc_loop_triangles()
            xform = obj.matrix_world.inverted() @ host.matrix_world
            normal_xform = xform.to_3x3().inverted().transposed()
            vertices = [xform @ v.co for v in host.data.vertices]
            triangles = list(host.data.loop_triangles)
            tree = BVHTree.FromPolygons(vertices, [tuple(t.vertices) for t in triangles], all_triangles=True)
            source_normals = [normal_xform @ n.vector for n in host.data.corner_normals]
            original = [n.vector.copy() for n in obj.data.corner_normals]
            normals = list(original)
            changed, angles, closest = 0, [], []
            cache = {}
            for face in obj.data.polygons:
                for li in face.loop_indices:
                    index = obj.data.loops[li].vertex_index
                    if index not in cache:
                        point = obj.data.vertices[index].co
                        hit, face_normal, triangle_index, distance = tree.find_nearest(point)
                        if hit is None or distance > .009:
                            cache[index] = None
                        else:
                            tri = triangles[triangle_index]
                            n = _interpolate(hit, *(vertices[i] for i in tri.vertices), [source_normals[i] for i in tri.loops])
                            cache[index] = (n, distance)
                    found = cache[index]
                    if found is None:
                        continue
                    n, distance = found
                    # Boundary ribbons/undersides must not inherit an exterior field.
                    if face.normal.dot(n) < .62:
                        continue
                    angle = original[li].angle(n, 0)
                    if angle > 1e-6:
                        normals[li] = n
                        changed += 1
                        angles.append(math.degrees(angle))
                        closest.append(distance)
            obj.data.normals_split_custom_set(normals)
            obj.data.update()
            after = _positions_digest(obj)
            assert before == after, 'V22 surface finish unexpectedly changed positions'
            obj['surfaceFinishRevision'] = 22
            obj['surfaceFinishMethod'] = '蓝色外皮从对应解析机翼外皮采样角点法线；几何与边界逐点不变'
            rows.append({'node': obj.name, 'host': host.name, 'changedCorners': changed,
                         'allCorners': len(normals), 'maximumNormalChangeDegrees': max(angles, default=0),
                         'maximumCorrespondenceDistance': max(closest, default=0),
                         'positionsSha256': before, 'positionsUnchanged': True,
                         'topologyUnchanged': True, 'boundaryAndUndersideNormalsPreserved': True})
    return {'version': 22, 'method': '匹配真实解析翼面法线的局部蓝前缘外皮整理',
            'changedNodes': [r['node'] for r in rows], 'rows': rows,
            'geometrySubdivided': False, 'movingGapsFilled': False,
            'sourceBoundary': '仅外观法线修复；未改变实际轮廓，不构成原厂CAD或制造级表面证明'}
