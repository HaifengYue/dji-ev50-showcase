"""Finite same-wing rib from RootCarrierBridge to Composite_wing.

Caller supplies an already-clearanced fixed-skin sweep cutter. The cutter is
neither changed nor deleted here. A candidate is clipped before admission, and
only the existing moving bridge mesh is replaced after closed-component and
strict material-attachment checks. Concept geometry, not a strength design.
"""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

AXIAL_CENTER = -.0029
AXIAL_HALF_WIDTH = .0010
TANGENTIAL_HALF_WIDTH = .0025
ROOT_RADIUS = .0345
HOST_EMBED = .0012
MAX_RADIAL_LENGTH = .075
REQUIRED_HARDWARE_CLEARANCE = .0032
NUMERIC_MARGIN = .000002


def _snapshot(obj):
    obj.data.calc_loop_triangles()
    mat = np.asarray(obj.matrix_world, dtype=np.float64)
    local = np.asarray([tuple(v.co) for v in obj.data.vertices], dtype=np.float64)
    points = local @ mat[:3, :3].T + mat[:3, 3]
    indices = np.asarray([t.vertices for t in obj.data.loop_triangles], dtype=int)
    triangles = points[indices]
    return dict(points=points, triangles=triangles,
                tree=BVHTree.FromPolygons(points.tolist(), indices.tolist(), all_triangles=True))


def _inside(snapshot, point):
    point = np.asarray(point, dtype=np.float64)
    nearest = snapshot['tree'].find_nearest(Vector(point))
    if nearest[0] is None or nearest[3] <= NUMERIC_MARGIN:
        return False, None
    tri = snapshot['triangles'] - point
    lengths = np.linalg.norm(tri, axis=2)
    numerator = np.einsum('ij,ij->i', tri[:, 0], np.cross(tri[:, 1], tri[:, 2]))
    denominator = (lengths.prod(axis=1)
                   + np.einsum('ij,ij->i', tri[:, 0], tri[:, 1]) * lengths[:, 2]
                   + np.einsum('ij,ij->i', tri[:, 1], tri[:, 2]) * lengths[:, 0]
                   + np.einsum('ij,ij->i', tri[:, 2], tri[:, 0]) * lengths[:, 1])
    winding = float(np.arctan2(numerator, denominator).sum() / (2 * math.pi))
    return abs(abs(winding) - 1.) < 1e-5, dict(winding=winding, boundaryDistance=float(nearest[3]))


def _topology(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bad = sum(not e.is_manifold for e in bm.edges)
    bad_vertices = sum(not v.is_manifold for v in bm.verts)
    face_remaining = set(bm.faces)
    face_components = 0
    while face_remaining:
        face_components += 1
        todo = [face_remaining.pop()]
        while todo:
            for edge in todo.pop().edges:
                for face in edge.link_faces:
                    if face in face_remaining:
                        face_remaining.remove(face)
                        todo.append(face)
    remaining = set(bm.verts)
    components = 0
    while remaining:
        components += 1
        todo = [remaining.pop()]
        while todo:
            for edge in todo.pop().link_edges:
                for vertex in edge.verts:
                    if vertex in remaining:
                        remaining.remove(vertex)
                        todo.append(vertex)
    volume = bm.calc_volume(signed=True)
    bm.free()
    obj.data.calc_loop_triangles()
    vertices = np.asarray([tuple(v.co) for v in obj.data.vertices], dtype=np.float64)
    indices = np.asarray([t.vertices for t in obj.data.loop_triangles], dtype=int)
    if len(indices):
        tri = vertices[indices]
        areas = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 2
        tiny = int((areas <= 1e-18).sum())
    else:
        tiny = 0
    return dict(nonManifoldEdges=bad, nonManifoldVertices=bad_vertices,
                connectedComponents=components, edgeConnectedFaceComponents=face_components,
                trianglesAreaAtMost1e18=tiny, signedVolume=volume)


def _wing_owner(obj):
    p = obj
    while p:
        if p.name.startswith('WingPivot_'):
            return p.name
        p = p.parent
    return None


def _hardware_bounds(side, center, axis):
    rows = []
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.startswith('Root') or _wing_owner(obj):
            continue
        if not (obj.name.endswith('_' + side) or '_' + side + '_' in obj.name
                or obj.name.startswith('RootHingeEndcap_' + side)):
            continue
        points = _snapshot(obj)['points'] - center
        t = points @ axis
        radius = np.linalg.norm(points - t[:, None] * axis, axis=1)
        rows.append(dict(node=obj.name, tMin=float(t.min()), tMax=float(t.max()),
                         radiusMax=float(radius.max())))
    return rows


def _hardware_clearance(rows):
    # Every rib point is in this axial slab and outside this radial cylinder.
    # Clipping can only remove material. Triangle convexity bounds the actual
    # fixed hardware by its vertex t extrema and maximum radius.
    lo = AXIAL_CENTER - AXIAL_HALF_WIDTH - NUMERIC_MARGIN
    hi = AXIAL_CENTER + AXIAL_HALF_WIDTH + NUMERIC_MARGIN
    radial_min = ROOT_RADIUS - NUMERIC_MARGIN
    result = []
    for row in rows:
        axial = max(lo - row['tMax'], row['tMin'] - hi, 0.)
        radial = max(radial_min - row['radiusMax'], 0.)
        bound = math.hypot(axial, radial)
        result.append(dict(node=row['node'], conservativeTriangleDistanceLowerBound=bound))
    return result


def _make_prism(name, center, axis, radial, tangent, end_radius, bridge):
    points = []
    for r in [ROOT_RADIUS, end_radius]:
        for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            points.append(center + axis * (AXIAL_CENTER + a * AXIAL_HALF_WIDTH)
                          + radial * r + tangent * (b * TANGENTIAL_HALF_WIDTH))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in points], [], faces)
    for material in bridge.data.materials:
        mesh.materials.append(material)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def _remove(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def connect(side, center, axis, sweep_cutter, boolean):
    """Attach one finite moving rib; return scope and real attachment witnesses.

    sweep_cutter must already encode >= .0032u clearance from fixed skin over
    the intended motion. It may be I's conservative whole-range hull. No
    current model or scene is saved here, and a failed search changes no bridge.
    """
    if side not in ('L', 'R') or sweep_cutter is None or sweep_cutter.type != 'MESH':
        raise ValueError('Explicit side and real swept exclusion mesh required')
    bridge = bpy.data.objects['RootCarrierBridge_' + side]
    host = bpy.data.objects['Composite_wing_' + side]
    if _wing_owner(bridge) != 'WingPivot_' + side or _wing_owner(host) != 'WingPivot_' + side:
        raise ValueError('Refuse cross-rigid-body attachment')
    center = np.asarray(tuple(center), dtype=np.float64)
    axis = np.asarray(tuple(axis), dtype=np.float64)
    if axis.shape != (3,) or not np.isfinite(axis).all() or np.linalg.norm(axis) < 1e-12:
        raise ValueError('Finite nonzero mechanical axis required')
    if center.shape != (3,) or not np.isfinite(center).all():
        raise ValueError('Finite mechanical center required')
    axis /= np.linalg.norm(axis)
    sign = -1 if side == 'L' else 1
    e = np.asarray((sign, -1., 0.)); e /= np.linalg.norm(e)
    if abs(float(e @ axis)) > 1e-10:
        raise ValueError('Axis must preserve the calibrated orthogonal rib frame')
    f = sign * np.cross(axis, e); f /= np.linalg.norm(f)
    host_geometry = _snapshot(host)
    original_bridge_geometry = _snapshot(bridge)
    hardware = _hardware_clearance(_hardware_bounds(side, center, axis))
    if not hardware or min(x['conservativeTriangleDistanceLowerBound'] for x in hardware) < REQUIRED_HARDWARE_CLEARANCE:
        raise ValueError(('Finite rib slab cannot certify fixed-hardware clearance', hardware))
    candidates = []
    for degrees in range(0, 360, 3):
        phi = math.radians(degrees)
        radial = e * math.cos(phi) + f * math.sin(phi)
        tangent = -e * math.sin(phi) + f * math.cos(phi)
        origin = center + axis * AXIAL_CENTER + radial * ROOT_RADIUS
        point, normal, triangle, distance = host_geometry['tree'].ray_cast(Vector(origin), Vector(radial), MAX_RADIAL_LENGTH)
        if point is None or normal.dot(Vector(radial)) >= -.12:
            continue
        end_radius = ROOT_RADIUS + float(distance) + HOST_EMBED
        candidates.append((float(distance), degrees, radial, tangent, end_radius))
    candidates.sort(key=lambda x: (x[0], x[1]))
    attempts = []
    for distance, degrees, radial, tangent, end_radius in candidates:
        rib = _make_prism('TemporaryMovingConnectionRib_' + side, center, axis, radial, tangent, end_radius, bridge)
        trial = None
        try:
            boolean(rib, sweep_cutter, 'DIFFERENCE')
            top = _topology(rib)
            if (top['nonManifoldEdges'] or top['nonManifoldVertices']
                    or top['connectedComponents'] != 1 or top['edgeConnectedFaceComponents'] != 1
                    or top['trianglesAreaAtMost1e18'] or top['signedVolume'] <= 1e-10):
                attempts.append(dict(angle=degrees, rejected='sweep clipped rib into invalid/disconnected material', topology=top))
                continue
            rib_geometry = _snapshot(rib)
            roots, ends = [], []
            for a in [-.00035, .00035]:
                for b in [-.00055, .00055]:
                    for radial_value, collection, material in [
                        (ROOT_RADIUS + .00045, roots, original_bridge_geometry),
                        (end_radius - .00050, ends, host_geometry)]:
                        point = center + axis * (AXIAL_CENTER + a) + radial * radial_value + tangent * b
                        ok_rib, info_rib = _inside(rib_geometry, point)
                        ok_mat, info_mat = _inside(material, point)
                        if ok_rib and ok_mat:
                            collection.append(dict(worldPoint=point.tolist(), rib=info_rib, attachedMaterial=info_mat))
            if len(roots) < 2 or len(ends) < 2:
                attempts.append(dict(angle=degrees, rejected='no finite two-ended material attachment after sweep clipping', rootWitnesses=len(roots), wingWitnesses=len(ends)))
                continue
            trial = bridge.copy(); trial.data = bridge.data.copy()
            bpy.context.collection.objects.link(trial)
            trial.name = 'TemporaryBridgeAdmission_' + side
            boolean(trial, rib, 'UNION')
            final_topology = _topology(trial)
            if (final_topology['nonManifoldEdges'] or final_topology['nonManifoldVertices']
                    or final_topology['connectedComponents'] != 1
                    or final_topology['edgeConnectedFaceComponents'] != 1
                    or final_topology['trianglesAreaAtMost1e18'] or final_topology['signedVolume'] <= 0):
                attempts.append(dict(angle=degrees, rejected='union bridge admission topology failed', topology=final_topology))
                continue
            final_geometry = _snapshot(trial)
            if not all(_inside(final_geometry, p['worldPoint'])[0] for p in roots + ends):
                attempts.append(dict(angle=degrees, rejected='union did not retain complete finite connection'))
                continue
            old_data = bridge.data
            bridge.data = trial.data
            bpy.data.objects.remove(trial, do_unlink=True); trial = None
            if old_data.users == 0:
                bpy.data.meshes.remove(old_data)
            bridge['finiteMovingConnectionRib'] = True
            return dict(side=side, node=bridge.name, parent=bridge.parent.name,
                        host=host.name, chosenRadialAngleDegrees=degrees,
                        axisT=AXIAL_CENTER, axialHalfWidth=AXIAL_HALF_WIDTH,
                        tangentialHalfWidth=TANGENTIAL_HALF_WIDTH,
                        radialStart=ROOT_RADIUS, radialEnd=end_radius,
                        originalRayToWingDistance=distance,
                        clippedByProvidedSweptExclusion=True,
                        sweepClearanceRequirement=REQUIRED_HARDWARE_CLEARANCE,
                        sweepClearanceProvidedByCallerNotInferredFromName=True,
                        fixedHardwareConservativeBounds=hardware,
                        fixedHardwareBoundAppliesTo='New rib only; unchanged original bridge hardware clearance is not recertified here',
                        rootAttachmentWitnesses=roots, wingAttachmentWitnesses=ends,
                        finalTopology=final_topology, rejectedCandidates=attempts,
                        materialOwner=bridge.name, sameRigidWingOnly=True,
                        scope='Finite concept rib; no strength or whole-aircraft acceptance. Final source still needs explicit triangulation and full current material/motion review.')
        finally:
            if trial is not None:
                _remove(trial)
            if rib.name in bpy.data.objects:
                _remove(rib)
    raise ValueError(('No finite same-wing rib survives swept exclusion and two-ended attachment', side, attempts))
