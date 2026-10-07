"""Exact, fixture-free paint ownership partition and domain coalescence.

No Blender dependency, mesh writes, tolerances, snapping, support dilation, or
sliver deletion. This represents only eligible outward host prisms. It makes
no decision to delete paint outside them. Callers retain all export gates.
"""
from fractions import Fraction as F
from functools import cmp_to_key
from collections import defaultdict, Counter
import math


class ExactRegionError(ValueError):
    """No result may be applied when exact construction/validation fails."""


def _sign(x):
    return (x > 0)-(x < 0)


def _sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2],
            a[0]*b[1]-a[1]*b[0])


def _orient(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def _signed_area(poly):
    if len(poly) < 3:
        return F(0)
    a = poly[0]
    return sum(_orient(a, b, c) for b, c in zip(poly[1:-1], poly[2:]))/2


def _area(poly):
    return abs(_signed_area(poly))


def _value(plane, p):
    return plane[0]*p[0]+plane[1]*p[1]+plane[2]


def _clean(poly):
    out = []
    for p in poly:
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else []


def _split(poly, plane):
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
        if va < 0 < vb or vb < 0 < va:
            t = va/(va-vb)
            p = tuple(x+t*(y-x) for x, y in zip(a, b))
            inside.append(p)
            outside.append(p)
    return _clean(inside), _clean(outside)


def _clip(poly, planes):
    outside = []
    for plane in planes:
        poly, other = _split(poly, plane)
        if _area(other):
            outside.append(other)
        if not poly:
            break
    return poly, outside


def _float_poly(poly):
    return [tuple(float(x) for x in p) for p in poly]


def _exact_poly(poly):
    return [[str(x) for x in p] for p in poly]


def _simplify_loop(loop):
    loop = list(loop)
    changed = True
    while changed and len(loop) > 3:
        changed = False
        for i, b in enumerate(loop):
            a, c = loop[i-1], loop[(i+1) % len(loop)]
            if not _orient(a, b, c) and _dot(_sub(b, a), _sub(c, b)) >= 0:
                loop.pop(i)
                changed = True
                break
    return loop


def _boundary_loops(parts):
    """Cancel exact directed line intervals, including all T-junction splits."""
    lines = defaultdict(list)
    for poly in parts:
        if _signed_area(poly) <= 0:
            raise ExactRegionError('Supported cell orientation is not positive')
        for a, b in zip(poly, poly[1:]+poly[:1]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            if not dx and not dy:
                continue
            line = (dy, -dx, dx*a[1]-dy*a[0])
            div = next(x for x in line if x)
            key = tuple(x/div for x in line)
            lines[key].append((a, b, 0 if dx else 1))
    edges = []
    for segments in lines.values():
        events, points = defaultdict(int), {}
        axis = segments[0][2]
        for a, b, _ in segments:
            ta, tb = a[axis], b[axis]
            points[ta], points[tb] = a, b
            if ta < tb:
                events[ta] += 1
                events[tb] -= 1
            else:
                events[tb] -= 1
                events[ta] += 1
        ts, count = sorted(events), 0
        for ta, tb in zip(ts, ts[1:]):
            count += events[ta]
            if abs(count) > 1:
                raise ExactRegionError('Overlapping supported cells')
            if count == 1:
                edges.append((points[ta], points[tb]))
            elif count == -1:
                edges.append((points[tb], points[ta]))
    outgoing, incoming = defaultdict(list), Counter()
    for a, b in edges:
        outgoing[a].append(b)
        incoming[b] += 1
    if any(len(bs) != incoming[a] for a, bs in outgoing.items()):
        raise ExactRegionError('Unbalanced exact boundary graph')

    def next_vertex(a, b):
        choices = outgoing[b]
        if len(choices) == 1:
            return choices[0]
        # Interior is on the left. Choose the first clockwise outgoing edge
        # from the reversed incoming edge, separating point-touching loops.
        r = _sub(a, b)
        def coords(p):
            v = _sub(p, b)
            return _dot(r, v), -(r[0]*v[1]-r[1]*v[0])
        def compare(p, q):
            x, y = coords(p), coords(q)
            hx = 0 if x[1] > 0 or (x[1] == 0 and x[0] >= 0) else 1
            hy = 0 if y[1] > 0 or (y[1] == 0 and y[0] >= 0) else 1
            if hx != hy:
                return hx-hy
            return -_sign(x[0]*y[1]-x[1]*y[0])
        return min(choices, key=cmp_to_key(compare))

    todo, loops = set(edges), []
    while todo:
        start = min(todo)
        edge, loop = start, []
        while edge in todo:
            todo.remove(edge)
            a, b = edge
            loop.append(a)
            edge = (b, next_vertex(a, b))
        if edge != start:
            raise ExactRegionError('Boundary cycles could not be separated')
        loops.append(_simplify_loop(loop))
    if sum((_signed_area(p) for p in loops), F(0)) != sum((_area(p) for p in parts), F(0)):
        raise ExactRegionError('Union boundary area mismatch')
    return loops


def _winding(poly, p):
    winding = 0
    for a, b in zip(poly, poly[1:]+poly[:1]):
        if a[1] <= p[1] < b[1] and _orient(a, b, p) > 0:
            winding += 1
        if b[1] <= p[1] < a[1] and _orient(a, b, p) < 0:
            winding -= 1
    return winding


def _intersects(a, b, c, d):
    if a in (c, d) or b in (c, d):
        return False
    x, y, z, w = _orient(a, b, c), _orient(a, b, d), _orient(c, d, a), _orient(c, d, b)
    if ((x <= 0 <= y or y <= 0 <= x) and (z <= 0 <= w or w <= 0 <= z)):
        return (max(min(a[0], b[0]), min(c[0], d[0])) <= min(max(a[0], b[0]), max(c[0], d[0]))
                and max(min(a[1], b[1]), min(c[1], d[1])) <= min(max(a[1], b[1]), max(c[1], d[1])))
    return False


def _triangulate(poly, owner, validator, state_budget):
    """Exact ears with bounded backtracking; never omit an invalid tiny ear."""
    attempts = [0]
    cache = set()
    def check(tri):
        if validator is None:
            return {'valid': True, 'score': float(_area(tri))}
        result = validator(owner, _float_poly(tri))
        if not isinstance(result, dict) or 'valid' not in result:
            raise ExactRegionError('Triangle validator must return a dictionary with valid')
        return result
    def visit(remain):
        attempts[0] += 1
        if attempts[0] > state_budget:
            raise ExactRegionError('Triangulation work limit reached; no result applied')
        key = tuple(remain)
        if key in cache:
            return None
        if len(remain) == 3:
            if _orient(*remain) <= 0:
                return None
            result = check(remain)
            return [(list(remain), result)] if result['valid'] else None
        ears = []
        for i, b in enumerate(remain):
            a, c = remain[i-1], remain[(i+1) % len(remain)]
            if _orient(a, b, c) <= 0:
                continue
            if any(_orient(a, b, p) >= 0 and _orient(b, c, p) >= 0 and _orient(c, a, p) >= 0
                   for p in remain if p not in (a, b, c)):
                continue
            tri = [a, b, c]
            result = check(tri)
            if result['valid']:
                score = result.get('score', result.get('normalDot', 0.))
                ears.append((score, float(_area(tri)), i, tri, result))
        for _, _, i, tri, result in sorted(ears, key=lambda e: e[:2], reverse=True):
            tail = visit(remain[:i]+remain[i+1:])
            if tail is not None:
                return [(tri, result)]+tail
        cache.add(key)
        return None
    result = visit(list(poly))
    if result is not None and sum((_area(p) for p, _ in result), F(0)) != _area(poly):
        raise ExactRegionError('Triangulated area mismatch')
    return result


def _triangulate_component(outer, holes, owner, validator, state_budget, bridge_budget):
    holes = sorted(holes, key=lambda h: max(p[0] for p in h), reverse=True)
    original = [outer]+holes
    attempts = [0]
    def visit(current, remaining):
        if not remaining:
            return _triangulate(current, owner, validator, state_budget)
        hole = remaining[0]
        options = []
        for oi, a in enumerate(current):
            for hi, b in enumerate(hole):
                if a == b:
                    continue
                mid = tuple((x+y)/2 for x, y in zip(a, b))
                if not _winding(outer, mid) or any(_winding(h, mid) for h in holes):
                    continue
                if any(_intersects(a, b, c, d) for p in [current]+remaining
                       for c, d in zip(p, p[1:]+p[:1])):
                    continue
                distance = _dot(_sub(a, b), _sub(a, b))
                options.append((distance, oi, hi))
        for _, oi, hi in sorted(options):
            attempts[0] += 1
            if attempts[0] > bridge_budget:
                raise ExactRegionError('Hole bridge work limit reached; no result applied')
            merged = current[:oi+1]+hole[hi:]+hole[:hi+1]+[current[oi]]+current[oi+1:]
            if _signed_area(merged) != _signed_area(current)+_signed_area(hole):
                raise ExactRegionError('Hole bridge changed exact area')
            result = visit(merged, remaining[1:])
            if result is not None:
                return result
        return None
    result = visit(outer, holes)
    if result is None:
        raise ExactRegionError('No area-preserving triangulation meets the supplied encoding validator')
    if sum((_area(p) for p, _ in result), F(0)) != sum((_signed_area(p) for p in original), F(0)):
        raise ExactRegionError('Component triangulation changed exact supported area')
    return result


def _convex_planes(poly):
    return [(a[1]-b[1], b[0]-a[0], a[0]*b[1]-b[0]*a[1])
            for a, b in zip(poly, poly[1:]+poly[:1])]


def _verify_triangulated_domain(triangles, owner, cells, prepared):
    """Independently reject any added unsupported area or triangle overlap."""
    forbidden = [_convex_planes(poly) for poly, ci in cells
                 if ci is None or prepared[ci]['owner'] != owner]
    for triangle, _ in triangles:
        if any(u < 0 or v < 0 or u+v > 1 for u, v in triangle):
            raise ExactRegionError('Output triangle leaves the source domain')
        for planes in forbidden:
            overlap, _ = _clip(triangle, planes)
            if _area(overlap):
                raise ExactRegionError('Output triangle adds unsupported or other-owner area')
    for i, (a, _) in enumerate(triangles):
        for b, _ in triangles[i+1:]:
            overlap, _ = _clip(a, _convex_planes(b))
            if _area(overlap):
                raise ExactRegionError('Output triangles overlap with positive area')


def partition_and_coalesce(points, candidates, *, max_host_distance=.009,
                           min_normal_dot=.62, triangle_validator=None,
                           max_cells=8192, max_triangulation_states=4096,
                           max_bridge_trials=512):
    """Return exact-domain UV triangles, uncovered polygons, and true witnesses.

    Inputs:
      points: three actual source world positions.
      candidates: complete existing candidate sequence. Each supplies owner,
        points (three actual host world vertices), and optional host/triangle.
        The existing near-first ordering is retained; exact equal-depth ties
        retain the earlier candidate, matching the original splitter.
      triangle_validator(owner, float_uv_triangle): optional non-mutating
        export check returning {'valid': bool, 'score': number, ...diagnostics}.
        Supply it to select only triangulations satisfying existing Float32
        position, normal, and area gates. It must not relax or mutate anything.

    Outputs are JSON-safe. Exact arithmetic is over supplied binary coordinates;
    This bounded implementation handles candidates whose clipped footprint is
    wholly within the depth slab, or wholly outside it. A true slab crossing
    returns status="inconclusive_depth_cut" with no replacement geometry.
    Every merged region retains its original per-cell actual-host witnesses;
    no synthetic host/depth plane is attached to the union.
    Any unsupported construction or work cap raises ExactRegionError atomically.
    'uncovered' is geometry evidence only, never an instruction to delete paint.
    """
    if not 0 < max_host_distance <= .009 or not .62 <= min_normal_dot <= 1:
        raise ValueError('Existing host correspondence bounds may not be relaxed')
    if min(max_cells, max_triangulation_states, max_bridge_trials) < 1:
        raise ValueError('Work limits must be positive')
    P = [tuple(F(x) for x in p) for p in points]
    if len(P) != 3 or any(len(p) != 3 for p in P):
        raise ValueError('Exactly three 3D source points are required')
    C = _cross(_sub(P[1], P[0]), _sub(P[2], P[0]))
    c2 = _dot(C, C)
    if not c2:
        raise ExactRegionError('Source triangle is degenerate')
    length = math.sqrt(float(c2))
    bound, normal_bound = F(max_host_distance), F(min_normal_dot)
    whole = [(F(0), F(0)), (F(1), F(0)), (F(0), F(1))]
    prepared, rejected = [], []
    for ci, candidate in enumerate(candidates):
        H = [tuple(F(x) for x in p) for p in candidate['points']]
        if len(H) != 3 or any(len(p) != 3 for p in H):
            raise ValueError('Exactly three 3D host points are required')
        N = _cross(_sub(H[1], H[0]), _sub(H[2], H[0]))
        den = _dot(N, C)
        if den <= 0 or den*den < normal_bound*normal_bound*_dot(N, N)*c2:
            rejected.append({'candidateIndex': ci, 'reason': 'exact outward normal guard'})
            continue
        planes = []
        for a, b in zip(H, H[1:]+H[:1]):
            inward = _cross(C, _sub(b, a))
            values = [_dot(inward, _sub(p, a)) for p in P]
            planes.append((values[1]-values[0], values[2]-values[0], values[0]))
        footprint, _ = _clip(whole, planes)
        if not _area(footprint):
            rejected.append({'candidateIndex': ci, 'reason': 'empty exact footprint'})
            continue
        values = [_dot(N, _sub(p, H[0]))/den for p in P]
        depth = (values[1]-values[0], values[2]-values[0], values[0])
        depths = [_value(depth, p) for p in footprint]
        low, high = min(depths), max(depths)
        if high < 0 or (low > 0 and low*low*c2 > bound*bound):
            rejected.append({'candidateIndex': ci, 'reason': 'exact footprint wholly outside depth slab'})
            continue
        if low < 0 or high*high*c2 > bound*bound:
            return {'status': 'inconclusive_depth_cut', 'supported': None,
                    'uncovered': None, 'ledger': None,
                    'candidateIndex': ci, 'owner': candidate['owner'],
                    'host': candidate.get('host'), 'triangle': candidate.get('triangle'),
                    'reason': 'A genuine ray-distance slab boundary crosses this eligible footprint; no replacement geometry or coverage claim',
                    'footprintUv': _float_poly(footprint),
                    'depthAlongSourceCrossIntervalExact': [str(low), str(high)],
                    'sourceCrossSquaredExact': str(c2),
                    'rayDepthInterval': [float(low)*length, float(high)*length]}
        prepared.append({'candidateIndex': ci, 'owner': candidate['owner'],
                         'host': candidate.get('host'), 'triangle': candidate.get('triangle'),
                         'planes': planes, 'depth': depth})
    cells = [(whole, None)]
    single_owner = len({c['owner'] for c in prepared}) <= 1
    for ci, candidate in enumerate(prepared):
        result = []
        for poly, old in cells:
            if single_owner and old is not None:
                result.append((poly, old))
                continue
            overlap, outside = _clip(poly, candidate['planes'])
            result.extend((p, old) for p in outside)
            if not _area(overlap):
                continue
            if old is None:
                result.append((overlap, ci))
            else:
                compare = tuple(a-b for a, b in zip(prepared[old]['depth'], candidate['depth']))
                nearer, farther = _split(overlap, compare)
                if _area(nearer):
                    result.append((nearer, ci))
                if _area(farther):
                    result.append((farther, old))
        cells = result
        if len(cells) > max_cells:
            raise ExactRegionError('Exact partition work limit reached; no result applied')
    if sum((_area(p) for p, _ in cells), F(0)) != F(1, 2):
        raise ExactRegionError('Exact partition lost source area')
    unsupported = [p for p, ci in cells if ci is None]
    owner_parts, owner_witness_ids, witnesses = defaultdict(list), defaultdict(list), []
    maximum_depth = F(0)
    for poly, ci in cells:
        if ci is None:
            continue
        candidate = prepared[ci]
        depths = [_value(candidate['depth'], p) for p in poly]
        low, high = min(depths), max(depths)
        if low < 0 or high*high*c2 > bound*bound:
            raise ExactRegionError('Real host depth witness exceeds unchanged slab')
        maximum_depth = max(maximum_depth, high)
        wi = len(witnesses)
        owner_parts[candidate['owner']].append(poly)
        owner_witness_ids[candidate['owner']].append(wi)
        witnesses.append({'candidateIndex': candidate['candidateIndex'],
                          'owner': candidate['owner'], 'host': candidate['host'],
                          'triangle': candidate['triangle'], 'uvPolygon': _float_poly(poly),
                          'uvPolygonExact': _exact_poly(poly),
                          'depthAlongSourceCrossCoefficientsExact': [str(v) for v in candidate['depth']],
                          'sourceCrossSquaredExact': str(c2),
                          'rayDepthInterval': [float(low)*length, float(high)*length],
                          'rayDepthAlongSourceCrossIntervalExact': [str(low), str(high)],
                          'rayDepthExactScale': 'sqrt('+str(c2)+')',
                          'uvAreaExact': str(_area(poly))})
    supported = []
    whole_restored = not unsupported and len(owner_parts) == 1
    for owner, parts in owner_parts.items():
        loops = [whole] if whole_restored else _boundary_loops(parts)
        positive = [p for p in loops if _signed_area(p) > 0]
        negative = [p for p in loops if _signed_area(p) < 0]
        holes = [[] for _ in positive]
        for hole in negative:
            containers = [i for i, outer in enumerate(positive) if _winding(outer, hole[0])]
            if not containers:
                raise ExactRegionError('Hole has no supported outer boundary')
            index = min(containers, key=lambda i: _area(positive[i]))
            holes[index].append(hole)
        triangles = []
        for outer, inner in zip(positive, holes):
            triangles.extend(_triangulate_component(outer, inner, owner, triangle_validator,
                             max_triangulation_states, max_bridge_trials))
        _verify_triangulated_domain(triangles, owner, cells, prepared)
        exact_area = sum((_area(p) for p in parts), F(0))
        if sum((_area(t) for t, _ in triangles), F(0)) != exact_area:
            raise ExactRegionError('Coalesced triangles changed owner area')
        supported.append({'owner': owner, 'wholeSourceRestored': whole_restored,
                          'uvTriangles': [_float_poly(t) for t, _ in triangles],
                          'uvTrianglesExact': [_exact_poly(t) for t, _ in triangles],
                          'boundaryLoops': [_float_poly(p) for p in loops],
                          'boundaryLoopsExact': [_exact_poly(p) for p in loops],
                          'uvArea': float(exact_area), 'uvAreaExact': str(exact_area),
                          'worldArea': float(exact_area*length),
                          'depthWitnessIndices': owner_witness_ids[owner],
                          'encodingValidation': [result for _, result in triangles] if triangle_validator else None})
    supported_area = sum((_area(p) for ps in owner_parts.values() for p in ps), F(0))
    missing_area = sum((_area(p) for p in unsupported), F(0))
    return {'status': 'ok', 'supported': supported, 'uncovered': [_float_poly(p) for p in unsupported],
            'uncoveredExact': [_exact_poly(p) for p in unsupported],
            'ledger': {'inputUvAreaExact': '1/2', 'supportedUvAreaExact': str(supported_area),
                       'uncoveredUvAreaExact': str(missing_area),
                       'sumUvAreaExact': str(supported_area+missing_area),
                       'inputWorldArea': float(length/2),
                       'supportedWorldArea': float(supported_area*length),
                       'uncoveredWorldArea': float(missing_area*length),
                       'exactAreaPreserved': supported_area+missing_area == F(1, 2),
                       'exactNoUnsupportedAreaAdded': True,
                       'exactNoPositiveTriangleOverlap': True},
            'depthWitnesses': witnesses, 'maximumHostRayDistanceUsed': float(maximum_depth)*length,
            'maximumHostRayDistanceUsedExact': '('+str(maximum_depth)+')*sqrt('+str(c2)+')',
            'candidateCount': len(candidates), 'eligibleCandidateCount': len(prepared),
            'rejectedCandidates': rejected, 'exactCellCount': len(cells),
            'depthSlabClippedCandidateCount': 0,
            'wholeSourceRestored': whole_restored,
            'encodingValidated': triangle_validator is not None,
            'claimBoundary': 'Exact representation of eligible outward host-prism domain; uncovered regions are evidence, not trimming authorization'}
