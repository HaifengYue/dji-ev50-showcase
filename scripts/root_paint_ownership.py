"""Assign an existing cruise coating to actual fixed/moving root material.

Only this module's four input paint meshes are written.  No source/candidate
file is loaded, no host is changed, and no paint point is projected onto a
host.  Source triangles are clipped by the exact prisms of outward-facing
host triangles, using their actual world transforms.  The closest available
host wins wherever the fixed and moving support footprints overlap.

Call after the final root solids, bores and topology repair, at cruise pose::

    report = reassign_root_paint(ctx, unsupported="clip", encoding_slivers="clip")

The default unsupported="error" is atomic and reports real unsupported
regions.  Explicit "clip" removes those regions and records their area and
source triangles.  The .009 bound is the existing surface-finish host search
bound, NOT a collision/manufacturing tolerance; paint retains its original
roughly .004 surface offset.  Physical and export acceptance remain separate.
"""
import collections
import hashlib
import math
import struct

import bpy

AREA_LIMIT = 1e-18
ENCODING_DISTANCE_LIMIT = 1e-7


class PaintOwnershipError(ValueError):
    """A failed atomic assignment; detailed diagnostics are in ``report``."""
    def __init__(self, message, report):
        super().__init__(message)
        self.report = report


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def _length(a):
    return math.sqrt(_dot(a, a))


def _unit(a):
    length = _length(a)
    return tuple(x/length for x in a) if length else (0., 0., 0.)


def _matrix(matrix):
    return tuple(tuple(float(x) for x in row) for row in matrix)


def _inverse(matrix):
    # Python double precision avoids an additional mathutils Float32 roundtrip.
    a = [list(row)+[float(i == j) for j in range(4)] for i, row in enumerate(matrix)]
    for col in range(4):
        pivot = max(range(col, 4), key=lambda i: abs(a[i][col]))
        if not a[pivot][col]:
            raise ValueError('Singular paint/host transform')
        a[col], a[pivot] = a[pivot], a[col]
        div = a[col][col]
        a[col] = [v/div for v in a[col]]
        for i in range(4):
            if i != col:
                factor = a[i][col]
                a[i] = [x-factor*y for x, y in zip(a[i], a[col])]
    return tuple(tuple(row[4:]) for row in a)


def _point(matrix, point):
    return tuple(_dot(row[:3], point)+row[3] for row in matrix[:3])


def _normal(inverse, normal):
    return _unit(tuple(sum(inverse[j][i]*normal[j] for j in range(3)) for i in range(3)))


def _float32(point):
    return struct.unpack('<3f', struct.pack('<3f', *point))


def _area(poly):
    if len(poly) < 3:
        return 0.
    # Translate before cross products, avoiding large-offset cancellation.
    a = poly[0]
    return abs(math.fsum((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                         for b, c in zip(poly[1:-1], poly[2:])))*.5


def _value(plane, p):
    return plane[0]*p[0]+plane[1]*p[1]+plane[2]


def _clean(poly):
    out = []
    for p in poly:
        if not out or p != out[-1]:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else []


def _split(poly, plane):
    """Disjoint convex half-plane split; no geometric epsilon/dilation."""
    values = [_value(plane, p) for p in poly]
    if not poly or max(values) <= 0:
        return [], poly
    if min(values) >= 0:
        return poly, []
    inside, outside = [], []
    for i, (a, b) in enumerate(zip(poly, poly[1:]+poly[:1])):
        va, vb = values[i], values[(i+1) % len(poly)]
        if va >= 0:
            inside.append(a)
        if va <= 0:
            outside.append(a)
        if (va < 0 < vb) or (vb < 0 < va):
            t = va/(va-vb)
            p = tuple(x+t*(y-x) for x, y in zip(a, b))
            inside.append(p)
            outside.append(p)
    return _clean(inside), _clean(outside)


def _intersection_parts(poly, planes):
    outside = []
    for plane in planes:
        poly, other = _split(poly, plane)
        if other:
            outside.append(other)
        if not poly:
            break
    return poly, outside


def _affine(function):
    c = function((0., 0.))
    return (function((1., 0.))-c, function((0., 1.))-c, c)


def _uv_point(points, p):
    return tuple(points[0][i]+p[0]*(points[1][i]-points[0][i])+p[1]*(points[2][i]-points[0][i])
                 for i in range(3))


def _bounds(points):
    return tuple(min(p[i] for p in points) for i in range(3)), tuple(max(p[i] for p in points) for i in range(3))


def _overlap(a, b):
    return all(a[0][i] <= b[1][i] and b[0][i] <= a[1][i] for i in range(3))


def _host_index(groups, root_abs_x, max_distance, grid_size=.06):
    hosts, buckets = [], collections.defaultdict(list)
    for owner, objects in enumerate(groups):
        for obj in objects:
            if obj.type != 'MESH' or obj.modifiers:
                raise ValueError('Host must be an actual modifier-free mesh: '+obj.name)
            obj.data.calc_loop_triangles()
            world = _matrix(obj.matrix_world)
            vertices = [_point(world, tuple(v.co)) for v in obj.data.vertices]
            for tri in obj.data.loop_triangles:
                points = tuple(vertices[i] for i in tri.vertices)
                lo, hi = _bounds(points)
                if lo[0] > root_abs_x+max_distance or hi[0] < -root_abs_x-max_distance:
                    continue
                cross = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
                if _length(cross)*.5 <= AREA_LIMIT:
                    raise ValueError('Host contains zero-area triangle: '+obj.name+' '+str(tri.index))
                item = {'owner': owner, 'host': obj.name, 'triangle': tri.index,
                        'points': points, 'normal': _unit(cross), 'bounds': (lo, hi)}
                index = len(hosts)
                hosts.append(item)
                for x in range(math.floor(lo[0]/grid_size), math.floor(hi[0]/grid_size)+1):
                    for y in range(math.floor(lo[1]/grid_size), math.floor(hi[1]/grid_size)+1):
                        buckets[x, y].append(index)
    return hosts, buckets, grid_size


def _candidates(points, normal, index, max_distance, min_normal_dot):
    hosts, buckets, grid_size = index
    lo, hi = _bounds(points)
    lo = tuple(v-max_distance for v in lo)
    hi = tuple(v+max_distance for v in hi)
    ids = set()
    for x in range(math.floor(lo[0]/grid_size), math.floor(hi[0]/grid_size)+1):
        for y in range(math.floor(lo[1]/grid_size), math.floor(hi[1]/grid_size)+1):
            ids.update(buckets.get((x, y), ()))
    candidates = []
    for i in sorted(ids):
        host = hosts[i]
        hn = host['normal']
        den = _dot(hn, normal)
        if den < min_normal_dot or not _overlap((lo, hi), host['bounds']):
            continue
        anchor = host['points'][0]
        depth = _affine(lambda uv: _dot(hn, _sub(_uv_point(points, uv), anchor))/den)
        def hit(uv):
            p = _uv_point(points, uv)
            d = _value(depth, uv)
            return tuple(p[k]-normal[k]*d for k in range(3))
        planes = []
        for a, b in zip(host['points'], host['points'][1:]+host['points'][:1]):
            inward = _cross(hn, _sub(b, a))
            planes.append(_affine(lambda uv: _dot(inward, _sub(hit(uv), a))))
        planes.extend((depth, (-depth[0], -depth[1], max_distance-depth[2])))
        # Reject slabs/footprints that cannot touch any part of this triangle.
        if any(max(_value(p, uv) for uv in ((0., 0.), (1., 0.), (0., 1.))) <= 0 for p in planes):
            continue
        candidates.append({**host, 'planes': planes, 'depth': depth})
    # Near-first decreases fragmentation; the actual overlap comparison below
    # still uses affine depth at every point, not this centroid ordering.
    return sorted(candidates, key=lambda c: (_value(c['depth'], (1/3, 1/3)), c['owner'], c['host'], c['triangle']))


def _partition(poly, candidates, physical_factor):
    fragments = [(poly, None)]
    single_owner = len({c['owner'] for c in candidates}) <= 1
    for candidate in candidates:
        result = []
        for shape, old in fragments:
            if single_owner and old is not None and old['owner'] == candidate['owner']:
                result.append((shape, old))
                continue
            overlap, outside = _intersection_parts(shape, candidate['planes'])
            result.extend((p, old) for p in outside if _area(p)*physical_factor > AREA_LIMIT)
            if not overlap or _area(overlap)*physical_factor <= AREA_LIMIT:
                continue
            if old is None:
                result.append((overlap, candidate))
            else:
                # Positive where this candidate is closer along the same ray.
                plane = tuple(x-y for x, y in zip(old['depth'], candidate['depth']))
                nearer, farther = _split(overlap, plane)
                if nearer and _area(nearer)*physical_factor > AREA_LIMIT:
                    result.append((nearer, candidate))
                if farther and _area(farther)*physical_factor > AREA_LIMIT:
                    result.append((farther, old))
        fragments = result
    return fragments


def _snapshot(obj):
    if obj.type != 'MESH' or obj.modifiers:
        raise ValueError('Paint must be an actual modifier-free mesh: '+obj.name)
    obj.data.calc_loop_triangles()
    world = _matrix(obj.matrix_world)
    inverse = _inverse(world)
    local = [tuple(v.co) for v in obj.data.vertices]
    return {'obj': obj, 'mesh': obj.data, 'world': world, 'inverse': inverse,
            'local': local, 'points': [_point(world, p) for p in local],
            'normals': [tuple(n.vector) for n in obj.data.corner_normals],
            'triangles': [(tuple(t.vertices), tuple(t.loops), t.polygon_index) for t in obj.data.loop_triangles],
            'materials': list(obj.data.materials)}


def _triangle_digest(rows):
    h = hashlib.sha256()
    for row in sorted(rows):
        for point in row:
            h.update(struct.pack('<3d', *point))
    return h.hexdigest()


def _far_triangles(snapshot, limit, touching=False):
    out = []
    for ids, _, _ in snapshot['triangles']:
        test = any if touching else all
        if test(abs(snapshot['points'][i][0]) >= limit for i in ids):
            out.append(tuple(snapshot['local'][i] for i in ids))
    return out


def _resolve_objects(objects):
    return [bpy.data.objects[x] if isinstance(x, str) else x for x in objects]


def reassign_root_paint(ctx=None, roots=None, *, root_abs_x=1.83,
                        max_host_distance=.009, min_normal_dot=.62,
                        unsupported='error', encoding_slivers='error', dry_run=False, exact_regions=False, unsupported_admission=None):
    """Redistribute coating in place, preserving names/parents/materials.

    ``roots`` optionally maps side labels to dictionaries containing
    ``paint`` = [fixed_paint, moving_paint] and ``hosts`` =
    [[fixed_root, optional_fixed_saddle], [moving_root]]. Values may be
    actual bpy objects or names. The default uses the four standard named
    paint objects and includes Fuselage as the real fixed saddle host.
    ``encoding_slivers='clip'`` explicitly permits omitting only newly
    created sub-1e-7-altitude fragments whose Float32 representation loses
    the source surface orientation; their exact areas/polygons are reported.
    The default errors atomically. Exactly collapsed stored corners/segments
    are always recorded and never emitted as zero-area triangles.
    ``ctx`` is accepted for generator integration but no constructor or
    analytic surface is used. ``dry_run`` computes all diagnostics without
    mesh changes. Failure is atomic across both sides.
    """
    if unsupported not in ('error', 'clip') or encoding_slivers not in ('error', 'clip'):
        raise ValueError('unsupported and encoding_slivers must be error or clip')
    if not 0 < max_host_distance <= .009 or not .62 <= min_normal_dot <= 1:
        raise ValueError('Existing host correspondence bounds may not be relaxed')
    if not 0 < root_abs_x <= 1.83:
        raise ValueError('Paint assignment may not expand beyond |X|=1.83')
    if roots is None:
        roots = {s: {'paint': ['Fixed_root_blue_'+s, 'Wing_blue_leading_'+s],
                     'hosts': [['Fixed_root_'+s, 'Fuselage'], ['Composite_wing_'+s]]}
                 for s in ('L', 'R')}
    bpy.context.view_layer.update()
    report = {'method': 'source-plane clipping by real outward host triangle prisms; affine nearest-depth ownership',
              'rootAbsX': root_abs_x, 'protectedFarPolicy': 'retain entire source triangles touching |X| >= cutoff, including straddlers', 'maximumHostRayDistance': max_host_distance,
              'minimumOutwardNormalDot': min_normal_dot, 'zeroAreaLimit': AREA_LIMIT,
              'float32MaximumPositionErrorBound': ENCODING_DISTANCE_LIMIT,
              'exactSourceRegionCoalescence': exact_regions,
              'unsupportedPolicy': unsupported, 'encodingSliverPolicy': encoding_slivers, 'dryRun': dry_run, 'sides': [],
              'hostGeometryChanged': False, 'paintProjected': False,
              'doubleSidedMaterialChanges': False, 'collisionToleranceChanges': False,
              'claimBoundary': 'Cruise coating ownership only; no claim of continuous motion, host topology, shell thickness or whole-model acceptance'}
    plans = []
    errors = []
    for side, config in roots.items():
        paints = _resolve_objects(config['paint'])
        groups = [_resolve_objects(group) for group in config['hosts']]
        if len(paints) != 2 or len(groups) != 2 or not all(groups):
            raise ValueError('Each side requires exactly two paint objects and two nonempty host groups')
        for paint, hosts in zip(paints, groups):
            if any(host.parent is not paint.parent for host in hosts):
                raise ValueError('Paint and host must share their motion parent: '+paint.name)
        snapshots = [_snapshot(obj) for obj in paints]
        if snapshots[0]['materials'] != snapshots[1]['materials']:
            raise ValueError('The original blue material slots must match before paint transfer')
        index = _host_index(groups, root_abs_x, max_host_distance)
        output = [[], []]
        row = {'side': side, 'paintNodes': [o.name for o in paints],
               'hostNodes': [[o.name for o in g] for g in groups],
               'inputRootArea': 0., 'assignedRootArea': [0., 0.],
               'transferredArea': [[0., 0.], [0., 0.]], 'unsupportedArea': 0.,
               'unsupportedFragments': [], 'sourceRootTriangles': 0,
               'maximumHostRayDistanceUsed': 0., 'farTrianglesBefore': [],
               'farTriangleHashesBefore': [], 'protectedTouchingTrianglesBefore': [],
               'protectedTouchingTriangleHashesBefore': [], 'maximumFloat32PositionError': 0.,
               'float32DegenerateTriangles': [], 'float32CollapsedFragments': [],
               'float32CollapsedArea': 0., 'float32NormalReversals': [],
               'areaLedgerStage': 'exact source-plane support before Float32; collapsed and encoding-clipped areas are separately disclosed',
               'discardedUnusedConstructionVertices': [],
               'minimumEncodedSourceNormalDot': 1., 'minimumRetainedSourceNormalDot': 1.,
               'encodingClippedArea': 0., 'encodingClippedTriangles': [], 'clippingAreaResidual': 0.,
               'exactRegionCertificates': [], 'exactRegionInconclusive': []}
        for source_id, snap in enumerate(snapshots):
            row['protectedTouchingTrianglesBefore'].append(len(_far_triangles(snap, root_abs_x, touching=True)))
            row['protectedTouchingTriangleHashesBefore'].append(_triangle_digest(_far_triangles(snap, root_abs_x, touching=True)))
            row['farTrianglesBefore'].append(len(_far_triangles(snap, root_abs_x)))
            row['farTriangleHashesBefore'].append(_triangle_digest(_far_triangles(snap, root_abs_x)))
            for ti, (ids, loops, polygon_index) in enumerate(snap['triangles']):
                points = [snap['points'][i] for i in ids]
                cross = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
                factor = _length(cross)
                if factor*.5 <= AREA_LIMIT:
                    raise ValueError('Source paint has a zero-area triangle: '+snap['obj'].name+' '+str(ti))
                whole = [(0., 0.), (1., 0.), (0., 1.)]
                # Protect every complete source triangle touching the far
                # domain, including its tiny root-side portion. Splitting a
                # triangle at a nonrepresentable Float32 cutoff could alter
                # its far surface. Ownership transitions are well inboard.
                record = {'source': source_id, 'triangle': ti, 'ids': ids,
                          'loops': loops, 'polygon': polygon_index}
                if any(abs(p[0]) >= root_abs_x for p in points):
                    output[source_id].append({**record, 'uv': whole, 'protected': True})
                    continue
                root = whole
                for sign in (1., -1.):
                    root, far = _split(root, _affine(lambda uv: root_abs_x-sign*_uv_point(points, uv)[0]))
                    if far and _area(far)*factor > AREA_LIMIT:
                        output[source_id].append({**record, 'uv': far, 'protected': False})
                    if not root:
                        break
                if not root:
                    continue
                root_area = _area(root)*factor
                row['sourceRootTriangles'] += 1
                row['inputRootArea'] += root_area
                normal = tuple(x/factor for x in cross)
                candidates = _candidates(points, normal, index, max_host_distance, min_normal_dot)
                fragments = _partition(root, candidates, factor)
                # Native precision repair: only replace a fragmented source
                # domain with a rigorously equal actual-prism domain. No host,
                # storage bound, orientation bound or unsupported policy changes.
                legacy_missing = sum(_area(poly)*factor for poly, host in fragments if host is None)
                if exact_regions and legacy_missing:
                    from paint_exact_regions import partition_and_coalesce
                    local_source = [snap['local'][i] for i in ids]
                    def validate_uv_triangle(owner, triangle):
                        dest = snapshots[owner]
                        world_before = [_point(snap['world'], _uv_point(local_source, uv)) for uv in triangle]
                        stored = [_float32(_uv_point(local_source, uv) if owner == source_id
                                  else _point(dest['inverse'], point)) for uv, point in zip(triangle, world_before)]
                        world_after = [_point(dest['world'], point) for point in stored]
                        error = max(_length(_sub(a, b)) for a, b in zip(world_before, world_after))
                        area = _length(_cross(_sub(stored[1], stored[0]), _sub(stored[2], stored[0])))*.5
                        encoded_normal = _unit(_cross(_sub(world_after[1], world_after[0]), _sub(world_after[2], world_after[0])))
                        normal_dot = _dot(encoded_normal, normal)
                        return {'valid': area > AREA_LIMIT and normal_dot >= min_normal_dot and error <= ENCODING_DISTANCE_LIMIT,
                                'score': normal_dot, 'normalDot': normal_dot, 'storedArea': area,
                                'maximumPositionError': error}
                    exact = partition_and_coalesce(points, candidates, max_host_distance=max_host_distance,
                                min_normal_dot=min_normal_dot, triangle_validator=validate_uv_triangle)
                    if exact['status'] == 'ok':
                        covered = [0., 0.]
                        for group in exact['supported']:
                            owner = group['owner']; covered[owner] += group['uvArea']*factor
                            output[owner].extend({**record, 'uv': triangle, 'protected': False}
                                                 for triangle in group['uvTriangles'])
                        missing = sum(_area(poly)*factor for poly in exact['uncovered'])
                        for poly in exact['uncovered']:
                            row['unsupportedFragments'].append({'source': snap['obj'].name, 'triangle': ti,
                                'area': _area(poly)*factor, 'worldPolygon': [_uv_point(points, uv) for uv in poly],
                                'sourceDomainConstruction': 'exact direct-edge host prism partition'})
                        row['clippingAreaResidual'] += root_area-missing-sum(covered)
                        row['unsupportedArea'] += missing
                        row['assignedRootArea'] = [a+b for a, b in zip(row['assignedRootArea'], covered)]
                        row['transferredArea'][source_id] = [a+b for a, b in zip(row['transferredArea'][source_id], covered)]
                        row['maximumHostRayDistanceUsed'] = max(row['maximumHostRayDistanceUsed'], exact['maximumHostRayDistanceUsed'])
                        row['exactRegionCertificates'].append({'source': snap['obj'].name, 'sourceTriangle': ti,
                            'legacyRoundedPlaneMissingArea': legacy_missing, 'result': exact})
                        continue
                    row['exactRegionInconclusive'].append({'source': snap['obj'].name, 'sourceTriangle': ti, 'result': exact})
                    # Inconclusive leaves the original strict representation and
                    # all existing errors active; never widen a depth slab.
                covered = [0., 0.]
                missing = 0.
                for shape, host in fragments:
                    area = _area(shape)*factor
                    if host is None:
                        missing += area
                        row['unsupportedFragments'].append({'source': snap['obj'].name, 'triangle': ti,
                            'area': area, 'worldPolygon': [_uv_point(points, uv) for uv in shape]})
                    else:
                        covered[host['owner']] += area
                        row['maximumHostRayDistanceUsed'] = max(row['maximumHostRayDistanceUsed'],
                            *(_value(host['depth'], uv) for uv in shape))
                row['clippingAreaResidual'] += root_area-missing-sum(covered)
                row['unsupportedArea'] += missing
                row['assignedRootArea'] = [a+b for a, b in zip(row['assignedRootArea'], covered)]
                row['transferredArea'][source_id] = [a+b for a, b in zip(row['transferredArea'][source_id], covered)]
                # Host tessellation must not gratuitously tessellate a coating.
                # Restore the source polygon iff every surviving partition has
                # the same owner and there is no positive-area uncovered piece.
                owners = {h['owner'] for _, h in fragments if h is not None}
                if not missing and len(owners) == 1:
                    target = next(iter(owners))
                    output[target].append({**record, 'uv': root, 'protected': False})
                else:
                    for shape, host in fragments:
                        if host is not None:
                            output[host['owner']].append({**record, 'uv': shape, 'protected': False})
        if abs(row['clippingAreaResidual']) > 1e-13:
            errors.append('Clipping area ledger failed on side '+str(side))
        if unsupported == 'error' and row['unsupportedArea'] > AREA_LIMIT:
            errors.append('unsupported paint on side '+str(side))
        # Materialize in memory only. A subsequent failure leaves every object
        # unchanged, including the opposite side.
        side_plans = []
        for target, fragments in enumerate(output):
            dest = snapshots[target]
            vertices, faces, normals, properties = [], [], [], []
            lookup = {}
            protected_after = []
            for fragment in fragments:
                source = snapshots[fragment['source']]
                ids, loops = fragment['ids'], fragment['loops']
                local = [source['local'][i] for i in ids]
                source_normals = [source['normals'][i] for i in loops]
                polygon = source['mesh'].polygons[fragment['polygon']]
                values = []
                for uv in fragment['uv']:
                    source_point = _uv_point(local, uv)
                    world_point = _point(source['world'], source_point)
                    # Identity source coordinates remain exactly the original
                    # stored float, rather than a gratuitous inverse transform.
                    local_point = source_point if target == fragment['source'] else _point(dest['inverse'], world_point)
                    encoded = _float32(local_point)
                    displacement = _length(_sub(_point(dest['world'], encoded), world_point))
                    row['maximumFloat32PositionError'] = max(row['maximumFloat32PositionError'], displacement)
                    if displacement > ENCODING_DISTANCE_LIMIT:
                        errors.append('Float32 paint position error on '+dest['obj'].name)
                    if encoded not in lookup:
                        lookup[encoded] = len(vertices)
                        vertices.append(encoded)
                    n = _uv_point(source_normals, uv)
                    if target != fragment['source']:
                        n = _normal(dest['world'], _normal(source['inverse'], n))
                    values.append((lookup[encoded], n, uv))
                # Remove only exactly identical stored Float32 corners. This
                # does not merge nearby points or cover any unsupported area.
                compact = []
                for value in values:
                    if not compact or compact[-1][0] != value[0]:
                        compact.append(value)
                if len(compact) > 1 and compact[0][0] == compact[-1][0]:
                    compact.pop()
                # Exactly collinear stored corners are representation-only;
                # remove the middle point, with no distance-based welding.
                while len(compact) >= 3:
                    drop = None
                    for j in range(len(compact)):
                        a = vertices[compact[j-1][0]]
                        b = vertices[compact[j][0]]
                        c = vertices[compact[(j+1) % len(compact)][0]]
                        if (_length(_cross(_sub(b, a), _sub(c, a))) == 0.
                                and _dot(_sub(b, a), _sub(c, b)) >= 0.):
                            drop = j
                            break
                    if drop is None:
                        break
                    compact.pop(drop)
                def face_area(corners):
                    ps = [vertices[v[0]] for v in corners]
                    return _length(_cross(_sub(ps[1], ps[0]), _sub(ps[2], ps[0])))*.5
                if len(compact) < 3:
                    factor = _length(_cross(_sub(local[1], local[0]), _sub(local[2], local[0])))
                    area = _area(fragment['uv'])*factor
                    row['float32CollapsedFragments'].append({'source': source['obj'].name,
                        'sourceTriangle': fragment['triangle'], 'target': dest['obj'].name,
                        'preEncodingArea': area, 'storedDistinctVertices': len(compact)})
                    row['float32CollapsedArea'] += area
                    continue
                # Use the best convex fan; a numerically collinear boundary
                # corner must not force an otherwise valid polygon to fail.
                fans = []
                for start in range(len(compact)):
                    cs = compact[start:]+compact[:start]
                    tris = [(cs[0], cs[j], cs[j+1]) for j in range(1, len(cs)-1)]
                    fans.append((min(face_area(c) for c in tris), start, tris))
                _, _, chosen = max(fans, key=lambda f: (f[0], -f[1]))
                for corners in chosen:
                    face = tuple(v[0] for v in corners)
                    ps = [vertices[i] for i in face]
                    area = face_area(corners)
                    if area <= AREA_LIMIT:
                        row['float32DegenerateTriangles'].append({'source': source['obj'].name,
                            'sourceTriangle': fragment['triangle'], 'target': dest['obj'].name,
                            'points': ps, 'area': area})
                        continue
                    actual_world = [_point(dest['world'], p) for p in ps]
                    source_world = [source['points'][i] for i in ids]
                    actual_n = _unit(_cross(_sub(actual_world[1], actual_world[0]), _sub(actual_world[2], actual_world[0])))
                    source_n = _unit(_cross(_sub(source_world[1], source_world[0]), _sub(source_world[2], source_world[0])))
                    normal_dot = _dot(actual_n, source_n)
                    row['minimumEncodedSourceNormalDot'] = min(row['minimumEncodedSourceNormalDot'], normal_dot)
                    if normal_dot < min_normal_dot:
                        original_world = [_point(source['world'], _uv_point(local, v[2])) for v in corners]
                        original_area = _length(_cross(_sub(original_world[1], original_world[0]), _sub(original_world[2], original_world[0])))*.5
                        longest = max(_length(_sub(a, b)) for a in original_world for b in original_world)
                        altitude = 2*original_area/longest if longest else 0.
                        detail = {'source': source['obj'].name, 'sourceTriangle': fragment['triangle'],
                            'target': dest['obj'].name, 'storedArea': area, 'preEncodingArea': original_area,
                            'normalDot': normal_dot, 'preEncodingAltitude': altitude,
                            'worldPolygonBeforeEncoding': original_world,
                            'worldPolygonAfterEncoding': actual_world}
                        if normal_dot <= 0:
                            row['float32NormalReversals'].append(detail)
                        if fragment['protected'] or altitude > ENCODING_DISTANCE_LIMIT or encoding_slivers == 'error':
                            errors.append('Unrepresentable Float32 paint sliver on side '+str(side))
                        else:
                            row['encodingClippedArea'] += original_area
                            row['encodingClippedTriangles'].append(detail)
                            continue
                    row['minimumRetainedSourceNormalDot'] = min(row['minimumRetainedSourceNormalDot'], normal_dot)
                    faces.append(face)
                    normals.extend(v[1] for v in corners)
                    properties.append((polygon.material_index, polygon.use_smooth))
                    if fragment['protected']:
                        protected_after.append(tuple(ps))
            if row['float32DegenerateTriangles']:
                errors.append('Float32-degenerate paint fragments on side '+str(side))
            before = _far_triangles(dest, root_abs_x, touching=True)
            if _triangle_digest(protected_after) != _triangle_digest(before):
                errors.append('Protected far paint changed on '+dest['obj'].name)
            used = sorted({i for face in faces for i in face})
            remap = {old: new for new, old in enumerate(used)}
            row['discardedUnusedConstructionVertices'].append(len(vertices)-len(used))
            vertices = [vertices[i] for i in used]
            faces = [tuple(remap[i] for i in face) for face in faces]
            side_plans.append({'snapshot': dest, 'vertices': vertices, 'faces': faces,
                               'normals': normals, 'properties': properties})
        row['outputTriangles'] = [len(p['faces']) for p in side_plans]
        row['farTrianglesPreserved'] = not any('Protected far paint changed on '+o.name in errors for o in paints)
        row['parentRelationsPreserved'] = True
        row['originalMaterialsPreserved'] = True
        report['sides'].append(row)
        plans.extend(side_plans)
    if unsupported == 'clip' and unsupported_admission is not None:
        report['unsupportedAdmission'] = unsupported_admission(report)
    if errors:
        report['errors'] = sorted(set(errors))
        report['applied'] = False
        raise PaintOwnershipError('; '.join(report['errors']), report)
    if not dry_run:
        new_meshes = []
        try:
            for plan in plans:
                snap = plan['snapshot']
                data = bpy.data.meshes.new(snap['mesh'].name+'__actual_root_ownership')
                new_meshes.append(data)
                data.from_pydata(plan['vertices'], [], plan['faces'])
                data.update()
                for material in snap['materials']:
                    data.materials.append(material)
                for poly, (material, smooth) in zip(data.polygons, plan['properties']):
                    poly.material_index, poly.use_smooth = material, smooth
                data.normals_split_custom_set(plan['normals'])
                data.update()
            for plan, data in zip(plans, new_meshes):
                obj = plan['snapshot']['obj']
                obj.data = data
                obj['layeredWingJoint'] = True  # Keep existing source-Float32 export path.
                obj['rootPaintOwnership'] = 'actual fixed/moving material, source cruise positions retained'
        except Exception:
            for plan in plans:
                plan['snapshot']['obj'].data = plan['snapshot']['mesh']
            for mesh in new_meshes:
                if mesh.users == 0:
                    bpy.data.meshes.remove(mesh)
            raise
    report['applied'] = not dry_run
    return report
