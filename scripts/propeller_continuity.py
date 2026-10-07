"""真实折桨叶身连续化：仅消费本次生成的八片叶网格，不依赖旧模型或外部候选。

原 x<=.08 的实际有向三角和28点共用截面精确保留；其外增加实体截面并
圆顺收尖。没有布尔、缩盘避碰、法线伪装、原厂翼型或气动性能声明。
"""
import bpy
import bmesh
import math
import hashlib
import collections
from mathutils import Vector
from propeller_shape import HINGE_RADIUS, ROTOR_RADIUS
X0 = 0.08
X1 = 0.13333333333333333
XPREV = 0.054
TIP_START = 0.568757526714406
N = 28

def samples(n):
    return [(0.5 * (1 - math.cos(math.pi * i / n)), True) for i in range(n + 1)] + [(0.5 * (1 - math.cos(math.pi * i / n)), False) for i in range(n - 1, 0, -1)]
COARSE = samples(14)
FINE = samples(28)

def thick(u, c, r):
    return 5 * r * c * (0.2969 * math.sqrt(max(u, 0)) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)

def analytic(x, u, up, sampler):
    x, s, c, p, r = sampler(x)
    a = math.radians(p)
    dy = c * (0.5 - u)
    z = (1 if up else -1) * thick(u, c, r)
    return Vector((x, -s + dy * math.cos(a) - z * math.sin(a), dy * math.sin(a) + z * math.cos(a)))

def canonical(v, spin, letter):
    v = Vector(v)
    if letter == 'A':
        v.x *= -1
        v.y *= -1
    v.y *= spin
    return v

def measured_loop(oldvs, x, sampler):
    ids = [i for i, v in enumerate(oldvs) if abs(v.x - x) < 2e-07]
    assert len(ids) == 28, (x, len(ids))
    return [min(ids, key=lambda i: (oldvs[i] - analytic(x, u, up, sampler)).length) for u, up in COARSE]

def cyclic_sig(tri):
    return min((tuple(tri[k:] + tri[:k]) for k in range(3)))

def oriented(mesh, limit):
    vv = [tuple(v.co) for v in mesh.vertices]
    return collections.Counter((cyclic_sig([vv[i] for i in p.vertices]) for p in mesh.polygons if max((vv[i][0] for i in p.vertices)) <= limit))

# Original root triangles and the boundary ring are reused by index, not refit.
def _refine_mesh(original, spin, sampler, stations):
    name = original.name
    letter = name[-1]
    assert original.get('geometryHandedness') == spin, name + ' handedness contract changed'
    TIP_END = stations[-1][0]
    oldvs = [canonical(v.co, spin, letter) for v in original.data.vertices]
    originalfaces = [tuple(p.vertices) if spin > 0 else tuple(reversed(p.vertices)) for p in original.data.polygons]
    rootfaces = [f for f in originalfaces if max((oldvs[i].x for i in f)) <= X0 + 2e-07]
    used = sorted(set((i for f in rootfaces for i in f)))
    remap = {old: new for new, old in enumerate(used)}
    vv = [oldvs[i].copy() for i in used]
    ff = [tuple((remap[i] for i in f)) for f in rootfaces]
    seam_old = measured_loop(oldvs, X0, sampler)
    prev_old = measured_loop(oldvs, XPREV, sampler)
    assert len(set(seam_old)) == 28
    seam = [remap[i] for i in seam_old]

    # Fine samples at the seam interpolate actual old polygon edges exactly.
    def existing_at(loop, u, up):
        cand = [k for k, (q, side) in enumerate(COARSE) if side == up or q in (0.0, 1.0)]
        cand = sorted(cand, key=lambda k: COARSE[k][0])
        for ka, kb in zip(cand, cand[1:]):
            a, b = (COARSE[ka][0], COARSE[kb][0])
            if a - 1e-09 <= u <= b + 1e-09:
                return oldvs[loop[ka]].lerp(oldvs[loop[kb]], (u - a) / (b - a))
        return oldvs[loop[min(cand, key=lambda k: abs(COARSE[k][0] - u))]].copy()

    # Match the old real span derivative, then rejoin the unchanged station law.
    def body(x, u, up):
        if x >= X1:
            return analytic(x, u, up, sampler)
        q0 = existing_at(seam_old, u, up)
        qm = existing_at(prev_old, u, up)
        m0 = (q0 - qm) / (X0 - XPREV)
        q1 = analytic(X1, u, up, sampler)
        h = 1e-05
        m1 = (analytic(X1 + h, u, up, sampler) - analytic(X1 - h, u, up, sampler)) / (2 * h)
        t = (x - X0) / (X1 - X0)
        L = X1 - X0
        q = q0 * (2 * t ** 3 - 3 * t * t + 1) + m0 * ((t ** 3 - 2 * t * t + t) * L) + q1 * (-2 * t ** 3 + 3 * t * t) + m1 * ((t ** 3 - t * t) * L)
        q.x = x
        return q
    x0, s0, c0, p0, r0 = sampler(TIP_START)
    eps = 1e-05
    dc = (sampler(TIP_START + eps)[2] - sampler(TIP_START - eps)[2]) / (2 * eps)
    alpha = 0.5 + (TIP_END - TIP_START) * dc / c0

    # Rounded terminal pole is an actual closed solid, inside the rotor envelope.
    def cap(x, u, up):
        t = (x - TIP_START) / (TIP_END - TIP_START)
        _, s, c, p, r = sampler(x)
        c = c0 * math.sqrt(max(0.0, 1 - t)) * (1 + alpha * t)
        a = math.radians(p)
        dy = c * (0.5 - u)
        z = (1 if up else -1) * thick(u, c, r)
        return Vector((x, -s + dy * math.cos(a) - z * math.sin(a), dy * math.sin(a) + z * math.cos(a)))
    xs = []
    for a, b, count in [(X0, X1, 6), (X1, 0.24, 8), (0.24, 0.395, 12), (0.395, 0.515, 10), (0.515, TIP_START, 6)]:
        xs += [a + (b - a) * k / count for k in range(1, count + 1)]
    xs += [TIP_START + (TIP_END - TIP_START) * math.sin(math.pi / 2 * k / 9) for k in range(1, 9)]
    last = seam
    for j, x in enumerate(xs):
        ring = []
        for u, up in FINE:
            ring.append(len(vv))
            vv.append(body(x, u, up) if x <= TIP_START else cap(x, u, up))
        if j == 0:
            for k in range(28):
                a = last[k]
                b = last[(k + 1) % 28]
                c = ring[(2 * k + 2) % 56]
                d = ring[(2 * k + 1) % 56]
                e = ring[2 * k]
                ff.extend([(a, b, c), (a, c, d), (a, d, e)])
        else:
            for k in range(56):
                a, b, c, d = (last[k], last[(k + 1) % 56], ring[(k + 1) % 56], ring[k])
                ff.extend([(a, b, c), (a, c, d)])
        last = ring
    pole = len(vv)
    vv.append(Vector((TIP_END, -stations[-1][1], 0)))
    for k in range(56):
        ff.append((last[k], last[(k + 1) % 56], pole))
    mesh = bpy.data.meshes.new('Continuous_propeller_solid_' + name)
    mesh.from_pydata(vv, [], ff)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    origroot = collections.Counter((cyclic_sig([tuple(oldvs[i]) for i in f]) for f in rootfaces))
    newroot = oriented(mesh, X0 + 2e-07)
    assert origroot == newroot, (name, 'root material changed', len(origroot), len(newroot))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bad = sum((not e.is_manifold for e in bm.edges))
    volume = bm.calc_volume(signed=True)
    euler = len(bm.verts) - len(bm.edges) + len(bm.faces)
    seen = set()
    components = 0
    for v in bm.verts:
        if v in seen:
            continue
        components += 1
        todo = [v]
        seen.add(v)
        while todo:
            p = todo.pop()
            for edge in p.link_edges:
                n = edge.other_vert(p)
                if n not in seen:
                    seen.add(n)
                    todo.append(n)
    bm.free()
    areas = []
    for p in mesh.polygons:
        a, b, c = [tuple(mesh.vertices[i].co) for i in p.vertices]
        ux, uy, uz = [b[i] - a[i] for i in range(3)]
        vx, vy, vz = [c[i] - a[i] for i in range(3)]
        areas.append(0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2))
    radius = max((math.hypot(v.co.x + HINGE_RADIUS, v.co.y) for v in mesh.vertices))
    assert bad == 0 and volume > 0 and (min(areas) > 1e-18) and (components == 1) and (radius <= ROTOR_RADIUS + 1e-08), (name, bad, volume, min(areas), components, radius)
    row = {'name': name, 'vertices': len(mesh.vertices), 'triangles': len(mesh.polygons), 'nonManifoldEdges': bad, 'connectedComponents': components, 'eulerCharacteristic': euler, 'signedVolumeCanonical': volume, 'minimumTriangleArea': min(areas), 'maxDeployedRadius': radius, 'preservedRootTriangleCount': sum(origroot.values()), 'preservedRootCoordinatesAndOrientationExact': True, 'protectedBoundaryX': X0, 'changedOnlyBeyondX': X0, 'seamVertexCount': 28, 'bodyPerimeterVertexCount': 56, 'bodyAddedSections': len(xs), 'tipCapStart': TIP_START, 'tipSpanEnd': TIP_END, 'tipChordAtPole': 0, 'originalRootTriangleSignature': hashlib.sha256(repr(sorted(origroot.items())).encode()).hexdigest()}
    for v in mesh.vertices:
        v.co.y *= spin
        if letter == 'A':
            v.co.x *= -1
            v.co.y *= -1
    if spin < 0:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    mesh.update()
    mesh.set_sharp_from_angle(angle=math.radians(42))
    for p in mesh.polygons:
        p.use_smooth = True
    for material in original.data.materials:
        mesh.materials.append(material)
    actual_old = collections.Counter((cyclic_sig([tuple(original.data.vertices[i].co) for i in p.vertices]) for p in original.data.polygons if max(((1 if letter == 'B' else -1) * original.data.vertices[i].co.x for i in p.vertices)) <= X0 + 2e-07))
    actual_new = collections.Counter((cyclic_sig([tuple(mesh.vertices[i].co) for i in p.vertices]) for p in mesh.polygons if max(((1 if letter == 'B' else -1) * mesh.vertices[i].co.x for i in p.vertices)) <= X0 + 2e-07))
    assert actual_old == actual_new, name + ' final root changed'
    return (mesh, row)

def refine_generated_propellers(station_sampler, control_stations, spin_signs):
    """Refine only the eight existing freshly generated Blade meshes, in place."""
    names = ['Blade_' + key + '_' + letter for key in spin_signs for letter in ('A', 'B')]
    objects = [bpy.data.objects[name] for name in names]
    prepared = []
    # Build all eight before assigning any new data to an existing object.
    for original in objects:
        key = original.name[len('Blade_'):-2]
        mesh, row = _refine_mesh(original, spin_signs[key], station_sampler, control_stations)
        prepared.append((original, mesh, row))
    for original, mesh, row in prepared:
        original.data = mesh
        original['propellerContinuityVersion'] = 1
        original['protectedRootSpan'] = X0
        original['roundedTipStartSpan'] = TIP_START
    for key in spin_signs:
        a = bpy.data.objects['Blade_' + key + '_A'].data
        b = bpy.data.objects['Blade_' + key + '_B'].data
        assert collections.Counter(((-v.co.x, -v.co.y, v.co.z) for v in a.vertices)) == collections.Counter((tuple(v.co) for v in b.vertices)), key + ' A/B rotation mismatch'
    return {'version': 1, 'construction': 'This generation actual root triangles + shared boundary + parametric solid continuation; no previous finished model input', 'protectedRootSpan': X0, 'rootTrianglesAndOrientationExact': True, 'sharedBoundaryVertexCount': 28, 'bodyPerimeterVertexCount': 56, 'oldLawRecoveredAtSpan': X1, 'tipRoundStartSpan': TIP_START, 'tipSpanEnd': control_stations[-1][0], 'tipChordAtPole': 0, 'nominalRotorRadiusLimit': ROTOR_RADIUS, 'maximumActualRotorRadius': max((row['maxDeployedRadius'] for _, _, row in prepared)), 'seamContinuation': 'Hermite derivative matches previous actual root interval; finite triangles are not claimed mathematically C1', 'unchangedInterfaces': ['fold origins', 'root sleeves and bores', 'fold pins and forks', 'motor-axis markers', 'spinner', 'other powertrain meshes'], 'changedMeshNodes': names, 'meshes': [row for _, _, row in prepared], 'evidenceBoundary': '原创几何细化；未通过本构造声明气动、载荷、全机运动间隙或原厂参数。'}
