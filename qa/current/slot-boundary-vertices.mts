/**
 * 从真实 Fuselage 网格边恢复四条可见纵向唇边。
 *
 * 输入为审查快照的世界/glTF 坐标 [X,Z,-Y]，输出为 Blender 坐标 [X,Y,Z]。
 * 名义端点 XY 只用于识别竖直切壁平面；不按名义 Z 或到预期三维直线的距离筛点。
 * 拟合不移动、不平均、不投影、不重采样，也不生成任何顶点。
 *
 * 本检查仅补充实际唇边识别和直线度量测，不能代替全实体闭合、截面、短圆端或物理 SAT。
 */
import {lineFit} from './slot-section.mts';

type Point = [number, number, number];
export interface FuselageTriangleSnapshot {
  name?: string;
  triangles: ReadonlyArray<{vertices: ReadonlyArray<ReadonlyArray<number>>; triangleIndex?: number}>;
}
export interface StraightFuselageSlotManifest {
  longRangeBlenderY: ReadonlyArray<number>;
  innerLipRightEndpoints: ReadonlyArray<ReadonlyArray<number>>;
  outerLipRightEndpoints: ReadonlyArray<ReadonlyArray<number>>;
}
type Failure = {reason: string; [key: string]: unknown};
type Vertex = {id: number; world: Point; blender: Point; triangleIndex: number; cornerIndex: number};
type Face = {index: number; triangleIndex: number; ids: number[]; points: Point[]; normal: Point | null; minY: number; maxY: number};
type Edge = {key: string; ids: [number, number]; faces: number[]};
type BoundaryEdge = Edge & {wallTriangleIndex: number; skinTriangleIndex: number | null; skinNormalBlender: Point | null; skinEligible: boolean};
type Fit = ReturnType<typeof lineFit>;

// 以下为边界识别设置，绝不替换既有 SAT 1e-9、材料 1e-8、焊接 1e-12 阈值。
const WELD = 1e-12;
const MATERIAL = 1e-8;
const MIN_WALL_NORMAL_ALIGNMENT = .98;
const MIN_SKIN_VERTICAL_NORMAL = .1;
const point = (p: ReadonlyArray<number>): Point => [p[0], p[1], p[2]];
const blender = (p: ReadonlyArray<number>): Point => [p[0], -p[2], p[1]];
const finitePoint = (p: unknown): p is number[] => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function faceNormal(ps: Point[]): Point | null {
  const a = sub(ps[1], ps[0]), b = sub(ps[2], ps[0]);
  const n: Point = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(...n);
  return length > 0 && Number.isFinite(length) ? n.map(v => v / length) as Point : null;
}
const edgeKey = (a: number, b: number) => a < b ? `${a}/${b}` : `${b}/${a}`;

/** 仅焊接拓扑，保留某个真实原始端点及其来源，不平均坐标。 */
function buildMesh(snapshot: FuselageTriangleSnapshot) {
  const vertices: Vertex[] = [], faces: Face[] = [], edges = new Map<string, Edge>();
  const buckets = new Map<string, number[]>(), failures: Failure[] = [];
  function vertexId(world: ReadonlyArray<number>, triangleIndex: number, cornerIndex: number) {
    const p = blender(world), q = p.map(v => Math.floor(v / WELD));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const id of buckets.get(`${q[0] + dx},${q[1] + dy},${q[2] + dz}`) ?? []) {
        if (Math.hypot(...sub(p, vertices[id].blender)) <= WELD) return id;
      }
    }
    const id = vertices.length, key = q.join(',');
    vertices.push({id, world: point(world), blender: p, triangleIndex, cornerIndex});
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(id);
    return id;
  }
  for (const [index, tri] of snapshot.triangles.entries()) {
    const triangleIndex = tri.triangleIndex ?? index;
    if (tri.vertices.length !== 3 || !tri.vertices.every(finitePoint)) {
      failures.push({reason: 'invalid-triangle-coordinates', triangleIndex});
      continue;
    }
    const ids = tri.vertices.map((p, corner) => vertexId(p, triangleIndex, corner));
    const ps = tri.vertices.map(blender), normal = faceNormal(ps);
    if (new Set(ids).size !== 3 || !normal) {
      failures.push({reason: 'degenerate-triangle-in-snapshot', triangleIndex});
      continue;
    }
    const face: Face = {index: faces.length, triangleIndex, ids, points: ps, normal,
      minY: Math.min(...ps.map(p => p[1])), maxY: Math.max(...ps.map(p => p[1]))};
    faces.push(face);
    for (let k = 0; k < 3; k++) {
      const a = ids[k], b = ids[(k + 1) % 3], key = edgeKey(a, b);
      if (!edges.has(key)) edges.set(key, {key, ids: [a, b], faces: []});
      edges.get(key)!.faces.push(face.index);
    }
  }
  return {vertices, faces, edges, failures};
}

function coverage(points: Point[], edges: BoundaryEdge[], vertices: Vertex[], range: Point | number[], encoding: number) {
  const [start, end] = range, span = [Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1]))];
  const intervals = edges.map(e => e.ids.map(id => vertices[id].blender[1]).sort((a, b) => a - b))
    .map(([a, b]) => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const union: number[][] = [];
  for (const [a, b] of intervals) {
    if (!union.length || a > union.at(-1)![1] + WELD) union.push([a, b]);
    else union.at(-1)![1] = Math.max(union.at(-1)![1], b);
  }
  const internalGaps = union.slice(1).map((p, i) => [union[i][1], p[0]]);
  const startShortfall = Math.max(0, span[0] - start), endShortfall = Math.max(0, end - span[1]);
  return {spanBlenderY: span, mainRangeCoverageFraction: union.reduce((sum, [a, b]) => sum + b - a, 0) / (end - start),
    coveredIntervalsBlenderY: union, internalGapsBlenderY: internalGaps, startShortfall, endShortfall,
    spansMainRange: startShortfall <= encoding && endShortfall <= encoding && internalGaps.length === 0};
}

function collectChains(boundary: BoundaryEdge[], vertices: Vertex[], range: number[], encoding: number) {
  const adjacency = new Map<number, number[]>();
  boundary.forEach((edge, index) => edge.ids.forEach(id => {
    if (!adjacency.has(id)) adjacency.set(id, []);
    adjacency.get(id)!.push(index);
  }));
  const visited = new Set<number>(), chains = [];
  for (const first of adjacency.keys()) {
    if (visited.has(first)) continue;
    const queue = [first], componentEdges = new Set<number>();
    visited.add(first);
    for (let i = 0; i < queue.length; i++) {
      for (const edgeIndex of adjacency.get(queue[i])!) {
        componentEdges.add(edgeIndex);
        for (const next of boundary[edgeIndex].ids) if (!visited.has(next)) {visited.add(next); queue.push(next);}
      }
    }
    const ends = queue.filter(id => adjacency.get(id)!.length === 1);
    const branches = queue.filter(id => adjacency.get(id)!.length > 2);
    const simplePath = ends.length === 2 && branches.length === 0 && componentEdges.size === queue.length - 1;
    let ids = queue;
    if (simplePath) {
      ids = []; let current = ends.sort((a, b) => vertices[a].blender[1] - vertices[b].blender[1])[0], previous = -1;
      while (ids.length < queue.length) {
        ids.push(current);
        const nextEdge = adjacency.get(current)!.find(index => index !== previous);
        if (nextEdge === undefined) break;
        const next = boundary[nextEdge].ids.find(id => id !== current)!;
        previous = nextEdge; current = next;
      }
    }
    const actualPoints = ids.map(id => [...vertices[id].blender] as Point);
    const strictlyLongitudinal = simplePath && actualPoints.slice(1).every((p, i) => p[1] > actualPoints[i][1] + WELD);
    const actualEdges = [...componentEdges].map(index => boundary[index]);
    const span = coverage(actualPoints, actualEdges, vertices, range, encoding);
    const hasYVariance = actualPoints.length >= 2 && span.spanBlenderY[1] > span.spanBlenderY[0] + WELD;
    const fit: Fit | null = hasYVariance ? lineFit(actualPoints) : null;
    chains.push({index: chains.length, simplePath, strictlyLongitudinal, ...span, fit, actualPoints,
      actualVertices: ids.map(id => ({weldedVertexId: id, actualWorld: [...vertices[id].world], actualBlender: [...vertices[id].blender],
        sourceTriangleIndex: vertices[id].triangleIndex, sourceCornerIndex: vertices[id].cornerIndex})),
      actualEdges: actualEdges.map(edge => ({weldedVertexIds: edge.ids, wallTriangleIndex: edge.wallTriangleIndex,
        skinTriangleIndex: edge.skinTriangleIndex, skinNormalBlender: edge.skinNormalBlender, skinEligible: edge.skinEligible})),
      endpointVertexIds: ends, branchVertexIds: branches,
      bracketingVerticesOutsideMainRange: ids.filter(id => vertices[id].blender[1] < range[0] - encoding || vertices[id].blender[1] > range[1] + encoding)});
  }
  return chains;
}

/**
 * 对所有实际边段解析构造 Y/Z 下包络，只用它识别外唇原始边。
 * 事件包含全部端点及边段交点，因此不会跳过短折返或仅在中途出现的低边。
 * 事件插值绝不进入拟合；非共享原始顶点的包络交接直接失败。
 */
function lowerEnvelope(boundary: BoundaryEdge[], vertices: Vertex[], range: number[], encoding: number) {
  const failures: Failure[] = [];
  const segments = boundary.map((edge, index) => {
    const ids = [...edge.ids].sort((a, b) => vertices[a].blender[1] - vertices[b].blender[1]);
    const [a, b] = ids.map(id => vertices[id].blender);
    return {edge, index, ids, a, b, dy: b[1] - a[1], slope: (b[2] - a[2]) / (b[1] - a[1])};
  });
  const nonvertical = segments.filter(e => e.dy > WELD);
  if (!nonvertical.length) return {failures: [{reason: 'no-longitudinal-envelope-segments'}] as Failure[], selectedEdges: [] as BoundaryEdge[], cells: [], handoffs: [], projectedCrossingCount: 0};
  const lo = Math.max(range[0], Math.min(...nonvertical.map(e => e.a[1])));
  const hi = Math.min(range[1], Math.max(...nonvertical.map(e => e.b[1])));
  if (!(hi > lo)) return {failures: [{reason: 'no-envelope-overlap-with-main-range'}] as Failure[], selectedEdges: [] as BoundaryEdge[], cells: [], handoffs: [], projectedCrossingCount: 0};
  const z = (e: typeof segments[number], y: number) => e.a[2] + (y - e.a[1]) * e.slope;
  const events = new Set([lo, hi]);
  for (const e of nonvertical) for (const p of [e.a, e.b]) if (p[1] >= lo && p[1] <= hi) events.add(p[1]);
  let projectedCrossingCount = 0;
  for (let i = 0; i < nonvertical.length; i++) for (let j = i + 1; j < nonvertical.length; j++) {
    const a = nonvertical[i], b = nonvertical[j];
    // 两条非重合直线共享端点时不可能再有第二个交点，避免端点舍入产生伪交点。
    if (a.ids.some(id => b.ids.includes(id))) continue;
    const left = Math.max(lo, a.a[1], b.a[1]), right = Math.min(hi, a.b[1], b.b[1]), slopeDifference = a.slope - b.slope;
    if (!(right > left) || slopeDifference === 0) continue;
    const y = left + (z(b, left) - z(a, left)) / slopeDifference;
    if (y > left && y < right) {events.add(y); projectedCrossingCount++;}
  }
  const ys = [...events].sort((a, b) => a - b);
  const cells: {rangeBlenderY: number[]; edgeIndex: number | null; competingEdgeIndices: number[]}[] = [];
  for (let i = 1; i < ys.length; i++) {
    const left = ys[i - 1], right = ys[i];
    // 对线性边在数学中点求值；极短事件区间也不要求其 Y 中点可单独表示为浮点数。
    const middleHeight = (e: typeof segments[number]) => z(e, left) + (z(e, right) - z(e, left)) / 2;
    const active = nonvertical.filter(e => e.a[1] <= left && e.b[1] >= right).sort((a, b) => middleHeight(a) - middleHeight(b));
    if (!active.length) {
      failures.push({reason: 'gap-in-actual-lower-envelope', rangeBlenderY: [left, right]});
      cells.push({rangeBlenderY: [left, right], edgeIndex: null, competingEdgeIndices: []});
      continue;
    }
    const competing = active.filter(e => Math.abs(middleHeight(e) - middleHeight(active[0])) <= WELD);
    if (competing.length > 1) failures.push({reason: 'ambiguous-overlapping-lower-envelope', rangeBlenderY: [left, right], edgeKeys: competing.map(e => e.edge.key)});
    cells.push({rangeBlenderY: [left, right], edgeIndex: active[0].index, competingEdgeIndices: competing.map(e => e.index)});
  }
  const runs: {edgeIndex: number; rangeBlenderY: number[]}[] = [];
  for (const cell of cells) {
    if (cell.edgeIndex === null) continue;
    const previous = runs.at(-1);
    if (previous?.edgeIndex === cell.edgeIndex && previous.rangeBlenderY[1] === cell.rangeBlenderY[0]) previous.rangeBlenderY[1] = cell.rangeBlenderY[1];
    else runs.push({edgeIndex: cell.edgeIndex, rangeBlenderY: [...cell.rangeBlenderY]});
  }
  const handoffs = [];
  for (let i = 1; i < runs.length; i++) {
    const before = segments[runs[i - 1].edgeIndex], after = segments[runs[i].edgeIndex], y = runs[i].rangeBlenderY[0];
    const sharedVertex = before.ids[1] === after.ids[0] && Math.abs(vertices[before.ids[1]].blender[1] - y) <= WELD;
    const handoff = {stationBlenderY: y, fromEdge: before.edge.key, toEdge: after.edge.key, sharedOriginalVertex: sharedVertex,
      originalVertexId: sharedVertex ? before.ids[1] : null, heightBefore: z(before, y), heightAfter: z(after, y),
      heightJump: z(after, y) - z(before, y)};
    handoffs.push(handoff);
    if (!sharedVertex) failures.push({reason: 'nonvertex-envelope-handoff', ...handoff});
  }
  // 内部竖直边若达到外轮廓最低处，外边不再是唯一的纵向函数，不能跳过它。
  for (const e of segments.filter(e => e.dy <= WELD)) {
    const y = e.a[1];
    if (y <= range[0] + encoding || y >= range[1] - encoding) continue;
    const active = nonvertical.filter(q => q.a[1] <= y && q.b[1] >= y);
    if (active.length && Math.min(e.a[2], e.b[2]) <= Math.min(...active.map(q => z(q, y))) + WELD) {
      failures.push({reason: 'vertical-or-zero-span-edge-on-exterior-envelope', edge: e.edge.key, stationBlenderY: y});
    }
  }
  const selectedEdges = [...new Set(runs.map(r => r.edgeIndex))].map(i => boundary[i]);
  for (const edge of selectedEdges) if (!edge.skinEligible) failures.push({reason: 'exterior-envelope-without-identifiable-skin-adjacency',
    edge: edge.key, adjacentTriangleIndex: edge.skinTriangleIndex, adjacentNormalBlender: edge.skinNormalBlender});
  return {failures, selectedEdges, cells, handoffs, projectedCrossingCount};
}

/**
 * 纯函数：复用已经载入的完整 Fuselage 快照。源模型编码误差通常为 1e-6，
 * 量化运行模型为 6e-5；只用于平面识别、端点存储误差及最终直线度界限。
 * 共享端点始终按 1e-12 焊接。
 */
export function measureSlotBoundaryVertices(snapshot: FuselageTriangleSnapshot, manifest: StraightFuselageSlotManifest, encodingEpsilon: number) {
  const failures: Failure[] = [];
  const range = manifest?.longRangeBlenderY;
  const endpointPairs = [manifest?.innerLipRightEndpoints, manifest?.outerLipRightEndpoints];
  const validRange = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[1] > range[0];
  const validEndpoints = validRange && endpointPairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(finitePoint)
    && Math.abs(pair[0][1] - range[0]) <= WELD && Math.abs(pair[1][1] - range[1]) <= WELD && pair.every(p => p[0] > 0));
  if (!validRange || !validEndpoints || !Number.isFinite(encodingEpsilon) || encodingEpsilon <= 0 || encodingEpsilon * 2 >= range![1] - range![0]) {
    return {passed: false, failures: [{reason: 'invalid-manifest-or-encoding-epsilon'}], lines: {} as Record<string, any>};
  }
  const [start, end] = range!, mainRange = [start, end], mesh = buildMesh(snapshot);
  failures.push(...mesh.failures);
  // 只触碰量化主区间端点的面/边可能属于圆端，要求其与避开编码误差的内部区间正交叠。
  const coreStart = start + encodingEpsilon, coreEnd = end - encodingEpsilon;
  const lines: Record<string, any> = {};
  for (const [kind, endpoints] of [['lower', manifest.innerLipRightEndpoints], ['upper', manifest.outerLipRightEndpoints]] as const) {
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const name = kind + side, localFailures: Failure[] = [];
      const slope = sign * (endpoints[1][0] - endpoints[0][0]) / (end - start), intercept = sign * endpoints[0][0] - slope * start;
      const normalScale = Math.hypot(1, slope), planeNormal: Point = [1 / normalScale, -slope / normalScale, 0];
      const wallFaces = new Set<number>(), coplanarRejectedNormals: number[] = [];
      let maxPlaneResidual = 0;
      for (const face of mesh.faces) {
        if (face.maxY <= coreStart || face.minY >= coreEnd) continue;
        const residual = Math.max(...face.points.map(p => Math.abs(p[0] - slope * p[1] - intercept) / normalScale));
        if (residual > encodingEpsilon) continue;
        if (!face.normal || Math.abs(dot(face.normal, planeNormal)) < MIN_WALL_NORMAL_ALIGNMENT) {
          coplanarRejectedNormals.push(face.triangleIndex); continue;
        }
        wallFaces.add(face.index); maxPlaneResidual = Math.max(maxPlaneResidual, residual);
      }
      if (!wallFaces.size) localFailures.push({reason: 'no-actual-cutwall-faces'});
      const boundary: BoundaryEdge[] = [], excludedCapCrossEdges: string[] = [];
      let unionInteriorEdgeCount = 0, boundaryEdgeCount = 0;
      for (const edge of mesh.edges.values()) {
        const selected = edge.faces.filter(index => wallFaces.has(index));
        if (!selected.length) continue;
        if (selected.length === 2 && edge.faces.length === 2) {unionInteriorEdgeCount++; continue;}
        if (selected.length !== 1) {localFailures.push({reason: 'nonmanifold-wall-union-edge', edge: edge.key, incidentTriangles: edge.faces.map(i => mesh.faces[i].triangleIndex)}); continue;}
        boundaryEdgeCount++;
        const ps = edge.ids.map(id => mesh.vertices[id].blender);
        const minY = Math.min(...ps.map(p => p[1])), maxY = Math.max(...ps.map(p => p[1]));
        if (maxY <= coreStart || minY >= coreEnd) {excludedCapCrossEdges.push(edge.key); continue;}
        if (edge.faces.length !== 2) localFailures.push({reason: 'lip-boundary-missing-unique-skin-adjacency', edge: edge.key, incidentTriangles: edge.faces.map(i => mesh.faces[i].triangleIndex)});
        const adjacent = edge.faces.filter(index => !wallFaces.has(index));
        const skin = adjacent.length === 1 ? mesh.faces[adjacent[0]] : null;
        const skinEligible = edge.faces.length === 2 && !!skin?.normal && Math.abs(skin.normal[2]) >= MIN_SKIN_VERTICAL_NORMAL;
        // 内壁可能与空腔相交后分支；保留这些全部原始边，让真正下包络决定外唇。
        boundary.push({...edge, wallTriangleIndex: mesh.faces[selected[0]].triangleIndex,
          skinTriangleIndex: skin?.triangleIndex ?? null, skinNormalBlender: skin?.normal ?? null, skinEligible});
      }
      const chains = collectChains(boundary, mesh.vertices, mainRange, encodingEpsilon);
      const envelope = lowerEnvelope(boundary, mesh.vertices, mainRange, encodingEpsilon);
      localFailures.push(...envelope.failures);
      const exteriorChains = collectChains(envelope.selectedEdges, mesh.vertices, mainRange, encodingEpsilon);
      if (exteriorChains.length !== 1) localFailures.push({reason: 'expected-one-connected-exterior-envelope', actualChains: exteriorChains.length});
      for (const chain of exteriorChains) {
        if (!chain.simplePath || !chain.strictlyLongitudinal) localFailures.push({reason: 'ambiguous-or-nonmonotone-exterior-envelope', chainIndex: chain.index});
        if (!chain.spansMainRange) localFailures.push({reason: 'incomplete-boundary-chain-span', chainIndex: chain.index,
          spanBlenderY: chain.spanBlenderY, internalGapsBlenderY: chain.internalGapsBlenderY, startShortfall: chain.startShortfall, endShortfall: chain.endShortfall});
      }
      const exterior = exteriorChains.length === 1 ? exteriorChains[0] : null;
      if (exterior && (!exterior.fit || !Number.isFinite(exterior.fit.maximumDeviation) || exterior.fit.maximumDeviation > encodingEpsilon)) {
        localFailures.push({reason: 'actual-lip-vertices-not-collinear', maximumDeviation: exterior.fit?.maximumDeviation, maximumAllowed: encodingEpsilon});
      }
      lines[name] = {passed: localFailures.length === 0 && exterior !== null, ...exterior?.fit,
        actualPoints: exterior?.actualPoints ?? [], actualVertices: exterior?.actualVertices ?? [],
        exteriorChains, envelope: {cells: envelope.cells, handoffs: envelope.handoffs, projectedCrossingCount: envelope.projectedCrossingCount,
          selectedEdgeKeys: envelope.selectedEdges.map(edge => edge.key)},
        chains, failures: localFailures,
        identification: {plane: {normalBlender: planeNormal, constant: -intercept / normalScale}, nominalZUsed: false,
          wallTriangleIndices: [...wallFaces].map(i => mesh.faces[i].triangleIndex), actualWallFaces: wallFaces.size,
          maximumSelectedFacePlaneResidual: maxPlaneResidual, coplanarRejectedNormals,
          unionInteriorEdgeCount, boundaryEdgeCount, actualUnionBoundaryEdges: boundary.length, identifiableSkinBoundaryEdges: boundary.filter(e => e.skinEligible).length, excludedCapCrossEdges}};
      failures.push(...localFailures.map(f => ({lip: name, ...f})));
    }
  }
  return {passed: failures.length === 0 && Object.values(lines).every(line => line.passed),
    method: '真实切壁面并集全部边界；按全部原始边段的解析下包络识别唯一外唇；只允许在共享原始顶点交接，不投影或补点',
    coordinateFrame: 'Blender [X,Y,Z] = audit world [X,-Z,Y]', longitudinalRangeBlender: mainRange,
    straightnessTolerance: encodingEpsilon, identificationPlaneTolerance: encodingEpsilon, weldTolerance: WELD,
    materialToleranceUnchanged: MATERIAL, envelopeTopologyTolerance: WELD, wallNormalMinimumAbsoluteAlignment: MIN_WALL_NORMAL_ALIGNMENT,
    skinNormalMinimumAbsoluteVerticalComponent: MIN_SKIN_VERTICAL_NORMAL,
    endpointPolicy: '排除仅在主区间编码端点以外的面/边；端点覆盖仅接纳编码误差内的缺口；拟合保留真实原始括界端点',
    meshTriangleCount: mesh.faces.length, weldedVertexCount: mesh.vertices.length, lines, failures,
    limitations: ['本辅助检查不单独证明实体闭合、材料厚度、短端几何、无自交或机构安全',
      '通过平面与面法线识别切壁；拓扑不明确或覆盖不足即失败，不放宽焊接、不按预期三维直线筛点',
      '内壁允许分支或不贯穿主区间；外边必须唯一连通且全长覆盖。解析包络事件只用于识别原始边，所有拟合点仍是原始网格顶点']};
}
