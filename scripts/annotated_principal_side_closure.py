"""Bounded principal-side construction on four newly generated native roots.

Call after annotated_low_angle_relief.apply_bounded_low_angle_relief(), while
the current generation is still in cruise, and before action baking. Pass the
objects produced by that generation explicitly. This module never imports a
finished aircraft, opens a Blender file, reads diagnostic programs, or exports.

The only runtime file input is adjacent data/annotated-principal-side-closure.json.
Every original physical vertex and every oriented actual loop triangle is locked.
No custom properties are added. A second call fails the complete original lock.
"""

from collections import Counter
from fractions import Fraction
from pathlib import Path
import hashlib
import json
import math
import struct


DATA_PATH = Path(__file__).with_name('data') / 'annotated-principal-side-closure.json'
EXPECTED_DATA_SHA256 = '9cd40401b110a44e31af3fd7ac5d20f1b4701e27638818ee4a0e486d02661c0d'
SCHEMA = 'transwing.native-principal-side-closure.v1'
ROOT_NAMES = ('Fixed_root_L', 'Fixed_root_R', 'Composite_wing_L', 'Composite_wing_R')
PIVOT_NAMES = ('WingPivot_L', 'WingPivot_R')
FINGERPRINT_ENCODING = 'sorted-unique-physical-f32-points-and-cyclic-oriented-f32-looptri.v1'


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _point(values):
    """Admit exact finite F32 coordinates, canonicalizing signed zero only."""
    result = tuple(float(x) for x in values)
    _require(len(result) == 3, 'Expected a three-coordinate point')
    for value in result:
        _require(math.isfinite(value), 'Non-finite construction coordinate')
        _require(struct.unpack('<f', struct.pack('<f', value))[0] == value,
                 'Construction coordinate is not exactly F32')
    return tuple(0.0 if x == 0.0 else x for x in result)


def _oriented(triangle):
    """Cyclic starts are equivalent; reversed winding is never equivalent."""
    triangle = tuple(_point(p) for p in triangle)
    _require(len(triangle) == 3, 'Expected a triangle')
    return min(triangle[i:] + triangle[:i] for i in range(3))


def geometry_fingerprint(points, triangles):
    """Full physical vertex inventory plus oriented actual triangle multiset."""
    points = sorted(_point(p) for p in points)
    _require(len(set(points)) == len(points), 'Duplicate physical point coordinates')
    triangles = sorted(_oriented(t) for t in triangles)
    point_set = set(points)
    _require(all(p in point_set for t in triangles for p in t), 'Triangle uses an absent point')
    vertices_hash = hashlib.sha256(b'transwing.full-physical-f32-points.v1\0')
    vertices_hash.update(struct.pack('<Q', len(points)))
    for point in points:
        vertices_hash.update(struct.pack('<3f', *point))
    faces_hash = hashlib.sha256(b'transwing.actual-oriented-f32-looptri.v1\0')
    faces_hash.update(struct.pack('<Q', len(triangles)))
    for triangle in triangles:
        for point in triangle:
            faces_hash.update(struct.pack('<3f', *point))
    full_hash = hashlib.sha256(FINGERPRINT_ENCODING.encode('ascii') + b'\0')
    full_hash.update(vertices_hash.digest())
    full_hash.update(faces_hash.digest())
    return {'encoding': FINGERPRINT_ENCODING, 'vertices': len(points),
            'triangles': len(triangles), 'verticesSHA256': vertices_hash.hexdigest(),
            'orientedLoopTrianglesSHA256': faces_hash.hexdigest(),
            'sha256': full_hash.hexdigest()}


def exact_cross(triangle):
    a, b, c = (tuple(Fraction(x) for x in p) for p in triangle)
    u, v = tuple(y-x for x, y in zip(a, b)), tuple(y-x for x, y in zip(a, c))
    return (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])


def _load_contract():
    raw = DATA_PATH.read_bytes()
    _require(hashlib.sha256(raw).hexdigest() == EXPECTED_DATA_SHA256,
             'Principal-side construction data identity mismatch')
    data = json.loads(raw)
    _require(data['schema'] == SCHEMA, 'Unexpected principal-side construction schema')
    _require(tuple(data['rootNames']) == ROOT_NAMES, 'Unexpected authorized root inventory')
    _require(set(data['roots']) == set(ROOT_NAMES), 'Incomplete root identity inventory')
    _require(data['componentCount'] == 32 and data['sideTriangleCount'] == 407
             and data['uniqueMovedVertices'] == 212, 'Unexpected bounded construction scope')
    _require(len(data['patches']) == 32, 'Incomplete component inventory')
    return data


def prospective_geometry(points, triangles, patches, maximum_displacement):
    """Validate the finite patch and return its complete intended geometry.

    Pure Python. Input and output use physical F32 local coordinates. The source
    triangle list must be the actual tessellation, not a newly chosen diagonal.
    """
    points = tuple(_point(p) for p in points)
    _require(len(set(points)) == len(points), 'Duplicate source physical points')
    source = Counter(_oriented(t) for t in triangles)
    _require(all(n == 1 for n in source.values()), 'Ambiguous duplicate source triangle')
    point_set, edits, removed, added = set(points), {}, set(), []
    roles = Counter()
    outer_points = set()
    for patch in patches:
        vertices = patch['vertices']
        old_side = [_oriented(t) for t in patch['originalSideTrianglesLocal']]
        _require(len(old_side) == len(patch['newSideFaces']), 'Side triangle count changed')
        _require(len(set(old_side)) == len(old_side), 'Duplicate side triangle in a component')
        for key in old_side:
            _require(source[key] == 1 and key not in removed, 'Missing or overlapping old side triangle')
            removed.add(key)
        before_vertices, after_vertices = [], []
        for row in vertices:
            old, new = _point(row['oldLocal']), _point(row['newLocal'])
            role = row['role']
            _require(role in ('outer-boundary', 'inner-boundary', 'internal-step-boundary',
                              'internal-side-steiner'), 'Unexpected construction role')
            _require(old in point_set, 'Missing finite construction point')
            _require(old not in edits or edits[old] == new, 'Conflicting coordinate changes')
            _require(old[1:] == new[1:], 'Principal-side construction must preserve every Y/Z')
            _require(abs(old[0]-new[0]) <= maximum_displacement, 'Inset exceeds approved bound')
            if role == 'outer-boundary':
                _require(old == new, 'Outer boundary displacement is forbidden')
                outer_points.add(old)
            edits[old] = new
            before_vertices.append(old)
            after_vertices.append(new)
            roles[role] += old != new
        _require(len(set(before_vertices)) == len(before_vertices), 'Ambiguous component vertices')
        _require(set(before_vertices) == {p for t in old_side for p in t},
                 'Component vertex inventory does not equal its old side triangles')
        for indices in patch['newSideFaces']:
            _require(len(indices) == 3 and len(set(indices)) == 3
                     and all(type(i) is int and 0 <= i < len(vertices) for i in indices),
                     'Invalid bounded side connectivity')
            triangle = _oriented(tuple(after_vertices[i] for i in indices))
            _require(any(exact_cross(triangle)), 'Exact zero-area replacement triangle')
            added.append(triangle)
    _require(len(removed) == len(added), 'Construction changes side triangle count')
    updated_points = tuple(edits.get(p, p) for p in points)
    _require(len(set(updated_points)) == len(updated_points), 'Inset merges physical vertices')
    expected = [tuple(edits.get(p, p) for p in tri)
                for tri, count in source.items() if tri not in removed for _ in range(count)]
    expected.extend(added)
    _require(len(expected) == sum(source.values()), 'Complete triangle count changed')
    _require(len(set(_oriented(t) for t in expected)) == len(expected), 'Duplicate prospective face')
    return {'points': updated_points, 'triangles': tuple(expected), 'edits': edits,
            'removed': removed, 'added': tuple(added), 'outerPoints': outer_points,
            'movedVertices': sum(old != new for old, new in edits.items()),
            'movedRoleOccurrences': dict(roles)}


def _read_geometry(mesh):
    mesh.calc_loop_triangles()
    points = tuple(_point(v.co) for v in mesh.vertices)
    triangles = tuple(tuple(points[j] for j in tri.vertices) for tri in mesh.loop_triangles)
    return points, triangles


def _admit_objects(root_objects, wing_pivots, data):
    """Read-only admission of ALL roots and pivots, before any BMesh/ID write."""
    from mathutils import Matrix
    _require(set(root_objects) == set(ROOT_NAMES), 'Pass exactly the current four generated roots')
    _require(set(wing_pivots) == set(PIVOT_NAMES), 'Pass exactly the current two generated pivots')
    identity = Matrix.Identity(4)
    for name in PIVOT_NAMES:
        pivot = wing_pivots[name]
        expected_location = tuple(data['cruiseAuthoring']['pivotLocalPositionF32'][name])
        _require(pivot.name == name and pivot.parent is None, 'Unexpected root pivot hierarchy: '+name)
        _require(pivot.library is None and not pivot.animation_data and not pivot.constraints,
                 'Use the unanimated current-generation pivot before baking: '+name)
        _require(pivot.rotation_mode == 'QUATERNION'
                 and tuple(pivot.rotation_quaternion) == (1.0, 0.0, 0.0, 0.0),
                 'Explicit identity cruise quaternion required: '+name)
        _require(tuple(pivot.location) == expected_location and tuple(pivot.scale) == (1.0, 1.0, 1.0)
                 and pivot.matrix_parent_inverse == identity
                 and pivot.matrix_basis == Matrix.Translation(expected_location),
                 'Final B pivot translation and unscaled cruise basis required: '+name)
    snapshots = []
    seen_meshes = set()
    for name in ROOT_NAMES:
        obj = root_objects[name]
        mesh = obj.data
        expected_parent = None if name.startswith('Fixed_root_') else wing_pivots['WingPivot_'+name[-1]]
        _require(obj.name == name and obj.type == 'MESH' and obj.parent == expected_parent,
                 'Unexpected current-generation root object or hierarchy: '+name)
        _require(obj.matrix_basis == identity and obj.matrix_parent_inverse == identity,
                 'Canonical identity root basis and parent inverse required: '+name)
        _require(not obj.modifiers and not obj.constraints and not obj.animation_data
                 and obj.mode == 'OBJECT' and obj.library is None and mesh.library is None
                 and mesh.shape_keys is None and mesh.users == 1,
                 'Root must be an unshared current-generation native mesh before baking: '+name)
        _require(mesh.as_pointer() not in seen_meshes, 'Root mesh datablocks must be distinct')
        seen_meshes.add(mesh.as_pointer())
        points, triangles = _read_geometry(mesh)
        actual = geometry_fingerprint(points, triangles)
        _require(actual == data['roots'][name]['before'],
                 'Full original root points/oriented actual loop-triangle identity mismatch: '+name)
        patches = [p for p in data['patches'] if p['mesh'] == name]
        prospective = prospective_geometry(points, triangles, patches, data['maximumActualDisplacement'])
        _require(geometry_fingerprint(prospective['points'], prospective['triangles'])
                 == data['roots'][name]['after'], 'Unexpected complete prospective geometry: '+name)
        snapshots.append({'object': obj, 'mesh': mesh, 'points': points, 'triangles': triangles,
                          'patches': patches, 'prospective': prospective,
                          'basis': obj.matrix_basis.copy(), 'parent': obj.parent,
                          'parentInverse': obj.matrix_parent_inverse.copy(),
                          'materialSlots': tuple(mesh.materials), 'before': actual})
    return snapshots


def _stage_root(snapshot, bmesh):
    obj, mesh = snapshot['object'], snapshot['mesh']
    plan = snapshot['prospective']
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bm.verts.ensure_lookup_table()
        _require(all(tuple(v.index for v in face.verts) == tuple(mesh.polygons[i].vertices)
                     for i, face in enumerate(bm.faces)), 'Native polygon order changed: '+obj.name)
        moved = {p for p, q in plan['edits'].items() if p != q}
        affected = {tri.polygon_index for tri in mesh.loop_triangles
                    if _oriented(tuple(snapshot['points'][j] for j in tri.vertices)) in plan['removed']
                    or any(snapshot['points'][j] in moved for j in tri.vertices)}
        old_polygons = {i: bm.faces[i] for i in affected if len(bm.faces[i].verts) > 3}
        original_polygon_count = len(bm.faces)
        # Only affected non-triangular polygons are split, using their CURRENT
        # actual loop triangles. The whole mesh is never retriangulated.
        for tri in mesh.loop_triangles:
            if tri.polygon_index not in old_polygons:
                continue
            old_face = old_polygons[tri.polygon_index]
            old_loops = {loop.vert.index: loop for loop in old_face.loops}
            face = bm.faces.new(tuple(bm.verts[j] for j in tri.vertices))
            face.copy_from(old_face)
            for loop in face.loops:
                loop.copy_from(old_loops[loop.vert.index])
        if old_polygons:
            bmesh.ops.delete(bm, geom=list(old_polygons.values()), context='FACES_ONLY')
        by_point = {_point(v.co): v for v in bm.verts}
        _require(len(by_point) == len(bm.verts) and set(by_point) == set(snapshot['points']),
                 'BMesh changed full physical source points: '+obj.name)
        by_face = {_oriented(tuple(v.co for v in face.verts)): face
                   for face in bm.faces if len(face.verts) == 3}
        _require(all(key in by_face for key in plan['removed']), 'Native side face is absent: '+obj.name)
        remove = [by_face[key] for key in sorted(plan['removed'])]
        _require({face.material_index for face in remove} <= {0}, 'Unexpected side material slot: '+obj.name)
        added_vertices = []
        for patch in snapshot['patches']:
            vertices = [by_point[_point(row['oldLocal'])] for row in patch['vertices']]
            added_vertices.extend(tuple(vertices[j] for j in indices) for indices in patch['newSideFaces'])
        old_face_count, old_vertex_count = len(bm.faces), len(bm.verts)
        bmesh.ops.delete(bm, geom=remove, context='FACES_ONLY')
        for old, new in plan['edits'].items():
            by_point[old].co = new
        for vertices in added_vertices:
            face = bm.faces.new(vertices)
            face.smooth = False
            face.material_index = 0
        wire_edges = [edge for edge in bm.edges if not edge.link_faces]
        if wire_edges:
            bmesh.ops.delete(bm, geom=wire_edges, context='EDGES')
        bm.normal_update()
        _require(len(bm.faces) == old_face_count and len(bm.verts) == old_vertex_count,
                 'Unexpected native polygon or vertex count change: '+obj.name)
        _require(all(v.link_faces for v in bm.verts) and all(edge.is_manifold for edge in bm.edges),
                 'Bounded candidate fails closed-manifold topology: '+obj.name)
        float_zero = []
        for face in bm.faces:
            if len(face.verts) != 3:
                continue
            triangle = tuple(_point(v.co) for v in face.verts)
            cross = exact_cross(triangle)
            _require(any(cross), 'Exact zero-area actual BMesh triangle: '+obj.name)
            if face.calc_area() == 0:
                float_zero.append({'vertices': triangle, 'exactCross': [
                    {'numerator': str(q.numerator), 'denominator': str(q.denominator)} for q in cross]})
        volume = bm.calc_volume(signed=True)
        _require(volume > 0, 'Nonpositive native signed volume: '+obj.name)
        report = {'node': obj.name, 'components': len(snapshot['patches']),
                  'replacedSideTriangles': len(remove), 'movedCoordinateVertices': plan['movedVertices'],
                  'maximumActualDisplacement': max(abs(a[0]-b[0]) for a, b in plan['edits'].items()),
                  'physicalVertices': len(bm.verts), 'originalNativePolygons': original_polygon_count,
                  'resultNativePolygons': len(bm.faces),
                  'selectivelyTessellatedAffectedNativePolygons': sorted(old_polygons),
                  'discardedWireDiagonals': len(wire_edges), 'signedVolume': volume,
                  'outerBoundaryUniqueVerticesUnmoved': len(plan['outerPoints']),
                  'allYZUnchanged': True, 'floatAreaZeroButExactNonzeroTriangles': float_zero,
                  'actualTrianglesExactDegenerateCount': 0, 'constructionCheckOnly': True}
        return bm, report
    except BaseException:
        bm.free()
        raise


def apply_bounded_principal_side_closure(root_objects, wing_pivots):
    """Mutate only the four explicit current-generation root object handles.

    All four original geometry locks and poses pass before any BMesh mutation or
    temporary mesh datablock creation. Every complete staged tessellation passes
    before an original mesh is written. Backups restore originals on commit error.
    The returned construction receipt is not an acceptance or material QA result.
    """
    import bpy
    import bmesh
    data = _load_contract()
    snapshots = _admit_objects(root_objects, wing_pivots, data)
    pending, temporary, backups, committed = [], [], [], []
    try:
        for snapshot in snapshots:
            bm, report = _stage_root(snapshot, bmesh)
            pending.append((snapshot, bm, report))
        _require(sum(report['replacedSideTriangles'] for _, _, report in pending) == 407
                 and sum(report['movedCoordinateVertices'] for _, _, report in pending) == 212,
                 'Unexpected aggregate bounded construction changes')
        for snapshot, bm, report in pending:
            staged = snapshot['mesh'].copy()
            temporary.append(staged)
            bm.to_mesh(staged)
            staged.update()
            points, triangles = _read_geometry(staged)
            fingerprint = geometry_fingerprint(points, triangles)
            _require(fingerprint == data['roots'][snapshot['object'].name]['after'],
                     'Staged complete actual tessellation differs from plan: '+snapshot['object'].name)
            _require(all(any(exact_cross(triangle)) for triangle in triangles),
                     'Staged actual loop triangle is exactly degenerate: '+snapshot['object'].name)
            report['before'] = snapshot['before']
            report['after'] = fingerprint
            report['actualLoopTriangleCount'] = len(triangles)
        # Capture restoration state only after all detached/staged checks pass.
        # Original mesh and object IDs are retained throughout a successful call.
        for snapshot, _, _ in pending:
            backup = bmesh.new()
            backups.append((snapshot, backup))
            backup.from_mesh(snapshot['mesh'])
        for snapshot, bm, _ in pending:
            committed.append(snapshot)
            bm.to_mesh(snapshot['mesh'])
            snapshot['mesh'].update()
        for snapshot, _, _ in pending:
            obj, mesh = snapshot['object'], snapshot['mesh']
            points, triangles = _read_geometry(mesh)
            _require(geometry_fingerprint(points, triangles) == data['roots'][obj.name]['after'],
                     'Committed geometry differs from validated complete candidate: '+obj.name)
            _require(obj.data is mesh and obj.matrix_basis == snapshot['basis']
                     and obj.parent == snapshot['parent']
                     and obj.matrix_parent_inverse == snapshot['parentInverse']
                     and tuple(mesh.materials) == snapshot['materialSlots'],
                     'Object identity, hierarchy, transforms or material slots changed: '+obj.name)
        return {'schema': SCHEMA, 'status': 'CONSTRUCTED_NEW_GEOMETRY_REQUIRES_INDEPENDENT_ACCEPTANCE',
                'parameterSHA256': EXPECTED_DATA_SHA256, 'sourceProvenance': data['provenance'],
                'parts': [report for _, _, report in pending],
                'componentCount': 32, 'replacedSideTriangles': 407, 'movedCoordinateVertices': 212,
                'wholeMachineAccepted': False, 'newGeometryRequiresAcceptance': True,
                'strictIntersectionMaterialMotionChecksRequired': True,
                'originalObjectAndMeshIDsRetained': True, 'nodeExtrasAdded': False,
                'limits': data['limits']}
    except BaseException:
        if committed:
            for snapshot, backup in backups:
                backup.to_mesh(snapshot['mesh'])
                snapshot['mesh'].update()
            for snapshot in snapshots:
                points, triangles = _read_geometry(snapshot['mesh'])
                _require(geometry_fingerprint(points, triangles) == snapshot['before'],
                         'Original geometry restoration failed: '+snapshot['object'].name)
        raise
    finally:
        for _, bm, _ in pending:
            bm.free()
        for _, backup in backups:
            backup.free()
        for staged in temporary:
            bpy.data.meshes.remove(staged)
