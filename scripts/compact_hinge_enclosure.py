"""Finite compact hinge cavities and the reviewed 64 x 7 split enclosures.

Candidate authoring module only. No production generator, rig or kinematics
mutation. The complete persistent input is scripts/data/compact-hinge-enclosure.json;
diagnostic files are provenance, never runtime inputs. Blender is imported only
by authoring entry points, so meridian/mesh/domain tests also run in plain Python.
"""
from pathlib import Path
from itertools import combinations
import hashlib
import json
import math
import numpy as np

CONTRACT_PATH = Path(__file__).with_name('data') / 'compact-hinge-enclosure.json'
CONTRACT = json.loads(CONTRACT_PATH.read_text())
assert CONTRACT['schema'] == 'transwing.compact-hinge-enclosure.v1'
CONFIG = CONTRACT['configuration']
N = CONFIG['circumferentialSegments']
INNER = [tuple(p) for p in CONTRACT['innerProfile']]
OUTER = [tuple(p) for p in CONTRACT['outerProfile']]
MOVING_END = CONFIG['movingMaximumT']
FIXED_START = CONFIG['fixedMinimumT']
O = np.array(CONTRACT['axisOrigin'])
A = np.array(CONTRACT['axisDirection'])
E = np.array(CONTRACT['basisE'])
F = np.array(CONTRACT['basisF'])
assert N == 64 and CONFIG['quarterCircleSegments'] == 7
assert abs(FIXED_START - MOVING_END - .003) < 1e-14


def clip_profile(poly, a, b):
    """Clip an ordered meridian without smoothing or removing radial steps."""
    out = []
    for p, q in zip(poly[:-1], poly[1:]):
        if q[0] < a-1e-12 or p[0] > b+1e-12:
            continue
        if abs(q[0]-p[0]) < 1e-12:
            if a-1e-12 <= p[0] <= b+1e-12:
                for pt in (p, q):
                    if not out or np.linalg.norm(np.array(pt)-out[-1]) > 1e-11:
                        out.append(pt)
        else:
            u, v = max(a, p[0]), min(b, q[0])
            if u > v:
                continue
            for t in (u, v):
                r = p[1]+(q[1]-p[1])*(t-p[0])/(q[0]-p[0])
                pt = (t, r)
                if not out or np.linalg.norm(np.array(pt)-out[-1]) > 1e-11:
                    out.append(pt)
    if not out:
        raise ValueError('Empty finite meridian clip')
    return out


def shell_section(owner):
    if owner not in ('moving', 'fixed'):
        raise ValueError('Explicit owner must be moving or fixed')
    a, b = (OUTER[0][0], MOVING_END) if owner == 'moving' else (FIXED_START, OUTER[-1][0])
    op, ip = clip_profile(OUTER, a, b), clip_profile(INNER, a, b)
    poly = []
    if op[0][0] < ip[0][0]-1e-10:
        poly.append((op[0][0], 0.))
    poly += op
    if op[-1][0] > ip[-1][0]+1e-10:
        poly += [(op[-1][0], 0.), (ip[-1][0], 0.)]
    poly += ip[::-1]
    if op[0][0] < ip[0][0]-1e-10:
        poly.append((ip[0][0], 0.))
    return poly


def solid_section(profile, a=None, b=None):
    profile = clip_profile(profile, profile[0][0] if a is None else a,
                           profile[-1][0] if b is None else b)
    return [(profile[0][0], 0.)] + profile + [(profile[-1][0], 0.)]


def revolve(poly, name, side):
    """Same vertex/face order as the audited standalone shell reconstruction."""
    if side not in ('R', 'L'):
        raise ValueError('Explicit side must be R or L')
    vertices, rings, faces = [], [], []
    for t, r in poly:
        if r < 1e-12:
            p = O+A*t
            if side == 'L':
                p = p*np.array([-1, 1, 1])
            rings.append([len(vertices)])
            vertices.append(p.tolist())
            continue
        ring = []
        for j in range(N):
            ang = 2*math.pi*j/N
            p = O+A*t+r*(E*math.cos(ang)+F*math.sin(ang))
            if side == 'L':
                p = p*np.array([-1, 1, 1])
            ring.append(len(vertices))
            vertices.append(p.tolist())
        rings.append(ring)
    for a, b in zip(rings, rings[1:]+rings[:1]):
        if len(a) == len(b) == 1:
            continue
        for j in range(N):
            k = (j+1) % N
            if len(a) == 1:
                face = [a[0], b[k], b[j]]
            elif len(b) == 1:
                face = [a[j], a[k], b[0]]
            else:
                face = [a[j], a[k], b[k], b[j]]
            if side == 'L':
                face.reverse()
            faces.append(face)
    return {'name': name, 'vertices': vertices, 'faces': faces, 'profile': poly}


def shell_meshes():
    return [revolve(shell_section(owner), 'RootFairing'+owner.title()+'_'+side, side)
            for side in ('R', 'L') for owner in ('moving', 'fixed')]


def clearance_profile():
    """Minkowski .0062 plus recorded numerical guard, externally circumscribed.

    Padded hardware cylinders and exact upper-envelope crossover events are
    retained. No arbitrary widened tube or loft smoothing enters this cut.
    """
    d = CONTRACT['hostCavity']['clearanceEnvelopeOffset']
    n = CONFIG['quarterCircleSegments']
    profiles = []
    for cylinder in CONTRACT['cylinders']:
        points = []
        for center, angles in [((cylinder['a'], cylinder['R']), np.linspace(math.pi, math.pi/2, n+1)),
                               ((cylinder['b'], cylinder['R']), np.linspace(math.pi/2, 0, n+1))]:
            def at(angle, radius):
                return np.array(center)+radius*np.array([math.cos(angle), math.sin(angle)])
            points.append(at(angles[0], d))
            for u, v in zip(angles[:-1], angles[1:]):
                points.append(at((u+v)/2, d/math.cos((u-v)/2)))
            points.append(at(angles[-1], d))
        clean = []
        for t, r in points:
            if clean and abs(t-clean[-1][0]) < 1e-12:
                clean[-1] = (float(t), max(float(r), clean[-1][1]))
            else:
                clean.append((float(t), float(r)))
        profiles.append(clean)
    knots = sorted(set(t for p in profiles for t, r in p))
    def line(profile, t):
        j = np.searchsorted(np.array(profile)[:, 0], t)-1
        if j < 0 or j >= len(profile)-1:
            return None
        a, b = profile[j], profile[j+1]
        slope = (b[1]-a[1])/(b[0]-a[0])
        return slope, a[1]-slope*a[0]
    out = []
    for a, b in zip(knots[:-1], knots[1:]):
        if b-a < 1e-12:
            continue
        lines = [q for p in profiles if (q := line(p, (a+b)/2)) is not None]
        cuts = [a, b]
        for x, y in combinations(lines, 2):
            if abs(x[0]-y[0]) < 1e-12:
                continue
            t = (y[1]-x[1])/(x[0]-y[0])
            if a+1e-12 < t < b-1e-12:
                cuts.append(t)
        cuts.sort()
        for u, v in zip(cuts[:-1], cuts[1:]):
            slope, inter = max(lines, key=lambda q: q[0]*(u+v)/2+q[1])
            start, end = (u, slope*u+inter), (v, slope*v+inter)
            if not out or abs(out[-1][0]-start[0]) > 1e-10 or abs(out[-1][1]-start[1]) > 1e-10:
                out.append(start)
            out.append(end)
    clean = []
    for point in out:
        if clean and np.linalg.norm(np.array(point)-clean[-1]) < 1e-11:
            continue
        while len(clean) >= 2:
            v, w = np.array(clean[-1])-clean[-2], np.array(point)-clean[-1]
            if abs(v[0]*w[1]-v[1]*w[0]) > 1e-14 or np.dot(v, w) < 0:
                break
            clean.pop()
        clean.append(point)
    return [(t, r/math.cos(math.pi/N)) for t, r in clean]


def cavity_meshes(side, owner):
    if owner not in ('moving', 'fixed'):
        raise ValueError('Explicit owner must be moving or fixed')
    clearance = clearance_profile()
    # Full service gap is part of both clearance cuts. Own-cover annular
    # contact is allowed only beyond the corresponding service lip.
    a, b = (clearance[0][0], FIXED_START) if owner == 'fixed' else (MOVING_END, clearance[-1][0])
    return [revolve(solid_section(INNER), 'FiniteHingeInner_'+side, side),
            revolve(solid_section(clearance, a, b), 'FiniteHingeOppositeAndService_'+side, side)]


def mechanical_domain():
    """Exact mesh AABB and conservative projected footprint; no skin waiver."""
    clearance = clearance_profile()
    mesh = revolve(solid_section(clearance), 'FiniteMechanicalDomain_R', 'R')
    vertices = np.array(mesh['vertices'])
    points = sorted(set(map(tuple, vertices[:, :2])))
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def chain(points):
        out = []
        for point in points:
            while len(out) > 1 and cross(out[-2], out[-1], point) <= 0:
                out.pop()
            out.append(point)
        return out
    hull = chain(points)[:-1]+chain(points[::-1])[:-1]
    area = abs(sum(a[0]*b[1]-a[1]*b[0] for a, b in zip(hull, hull[1:]+hull[:1])))/2
    radius = max(r for t, r in clearance)
    return {'axisT': [clearance[0][0], clearance[-1][0]],
            'maximumVertexRadius': radius, 'oldBoreRadius': .045,
            'necessaryRadiusIncrement': radius-.045,
            'rightXYZBounds': [vertices.min(axis=0).tolist(), vertices.max(axis=0).tolist()],
            'leftXYZBounds': [[-vertices[:, 0].max(), *vertices[:, 1:].min(axis=0)],
                              [-vertices[:, 0].min(), *vertices[:, 1:].max(axis=0)]],
            'rightXYConvexBound': [list(p) for p in hull],
            'projectedConvexBoundAreaPerSide': area,
            'scope': 'A conservative convex projection bound of the finite cut union, not a permission to alter its entire box or hull. Old missing bore material may be restored inside the old radius .045 domain. Only these actual cutters may remove additional material.'}


def _blender_object(row):
    import bpy
    import bmesh
    mesh = bpy.data.meshes.new(row['name'])
    mesh.from_pydata(row['vertices'], [], row['faces'])
    mesh.update()
    obj = bpy.data.objects.new(row['name'], mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    if any(not e.is_manifold for e in bm.edges):
        raise ValueError('Finite hinge source must be closed: '+obj.name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def apply_finite_host_cavity(obj, side, owner):
    """Call on a virgin host at cruise, instead of shaft_bore, never after it."""
    import bpy
    from layered_wing_joint import _boolean
    if obj.get('annotatedFiniteHingeCavity') or obj.data.get('annotatedFiniteHingeCavity'):
        raise ValueError('Finite cavity can only be authored once: '+obj.name)
    if side not in ('L', 'R') or owner not in ('moving', 'fixed'):
        raise ValueError('Explicit side and ownership required')
    prefix = ('Fixed_root_' if owner == 'fixed' else 'Composite_wing_')+side
    if obj.name != prefix and not obj.name.startswith(prefix+'__'):
        raise ValueError('Finite host name must agree with explicit side/owner: '+obj.name)
    pivot = bpy.data.objects['WingPivot_'+side]
    origin = O.copy()
    if side == 'L':
        origin[0] *= -1
    if np.max(np.abs(np.array(pivot.location)-origin)) > 1e-7 or abs(pivot.rotation_quaternion.angle) > 1e-7:
        raise ValueError('Finite cavity requires annotated pivot and cruise pose')
    if obj.parent != (pivot if owner == 'moving' else None):
        raise ValueError('Unexpected finite-host rigid ownership: '+obj.name)
    rows = []
    for data in cavity_meshes(side, owner):
        cutter = _blender_object(data)
        _boolean(obj, cutter, 'DIFFERENCE')
        rows.append({'cutter': data['name'], 'axialBounds': [min(p[0] for p in data['profile']), max(p[0] for p in data['profile'])],
                     'maximumRadius': max(p[1] for p in data['profile'])})
        bpy.data.objects.remove(cutter, do_unlink=True)
    obj['annotatedFiniteHingeCavity'] = True
    # Keep the flag with the authored data as well: _replace() retains this
    # datablock but intentionally retains the old object identity/properties.
    obj.data['annotatedFiniteHingeCavity'] = True
    obj['oldInfiniteBoreApplied'] = False
    return {'node': obj.name, 'side': side, 'owner': owner, 'cuts': rows,
            'serviceIntervalEntirelyCut': [MOVING_END, FIXED_START],
            'ownCoverMaterialAllowed': 'same-body actual host/shell annular overlap only; not a 0.010 m main-wall certificate',
            'supportAdapted': False}


def replace_reviewed_enclosures():
    """Explicitly replace only the four named old fairings, retaining their IDs."""
    import bpy
    from mathutils import Matrix, Vector
    rows = shell_meshes()
    # Preflight the complete transaction before replacing anything.
    for row in rows:
        obj = bpy.data.objects[row['name']]
        side = row['name'][-1]
        moving = row['name'].startswith('RootFairingMoving_')
        pivot = bpy.data.objects['WingPivot_'+side]
        if obj.get('annotatedFiniteEnclosure'):
            raise ValueError('Reviewed enclosure can only replace its source once: '+row['name'])
        if obj.type != 'MESH' or obj.parent != (pivot if moving else None) or obj.modifiers or obj.animation_data:
            raise ValueError('Unexpected fairing source/hierarchy: '+row['name'])
        if not bpy.data.objects['RootCarrierMoving_'+side].get('annotatedCompactStack'):
            raise ValueError('Compact stack must be authored first: '+side)
    reports = []
    for row in rows:
        old = bpy.data.objects[row['name']]
        materials = list(old.data.materials)
        data = dict(row, name=row['name']+'__reviewed')
        temporary = _blender_object(data)
        old.data = temporary.data
        old.matrix_parent_inverse = Matrix.Identity(4)
        old.matrix_basis = Matrix.Identity(4)
        if old.parent:
            # The mesh stores audited world float32 positions. Counter-translate
            # under the pivot so cruise world coordinates remain exactly those
            # same values, while folding still rotates about the real axis.
            old.location = -old.parent.location
        bpy.data.objects.remove(temporary, do_unlink=True)
        for material in materials:
            old.data.materials.append(material)
        old['annotatedFiniteEnclosure'] = True
        old['hardwareClearanceMinimum'] = .0025
        old['serviceGap'] = .003
        old['supportAccepted'] = False
        old['localCoverNotMainWall'] = True
        for face in old.data.polygons:
            xyz = np.array([row['vertices'][i] for i in face.vertices])
            axis = A.copy()
            if row['name'].endswith('_L'):
                axis[0] *= -1
            face.use_smooth = bool(np.ptp(xyz@axis) > 1e-10)
        reports.append({'node': old.name, 'vertices': len(old.data.vertices), 'faces': len(old.data.polygons),
                        'triangles': sum(len(face.vertices)-2 for face in old.data.polygons),
                        'auditedWorldVertexFloat32Sha256': hashlib.sha256(np.array([tuple(v.co) for v in old.data.vertices], dtype='<f4').tobytes()).hexdigest(),
                        'parent': old.parent.name if old.parent else None})
    bpy.context.view_layer.update()
    return {'parts': reports, 'parameterFileSha256': hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),
            'supportStatus': CONTRACT['hostCavity']['supportStatus'], 'claimBoundary': CONTRACT['claimBoundary']}
