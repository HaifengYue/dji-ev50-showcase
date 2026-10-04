/** 独立的直输出件量测：只读真实解码三角面；声明端点只作为需验证的目标。 */
import { solidTopology } from "../lib/solid-contact.mjs";
import { section } from "./slot-section.mts";

export type Point = [number, number, number];
export type ActualTriangle = { vertices: Point[]; triangleIndex: number };
export type StraightOutputDeclaration = {
  endpoints: [Point, Point];
  radius: number;
};
const WELD = 1e-12,
  AREA = 1e-18,
  VOLUME = 1e-10;
const sub = (a: number[], b: number[]) => a.map((v, k) => v - b[k]);
const dot = (a: number[], b: number[]) =>
  a.reduce((s, v, k) => s + v * b[k], 0);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]) => a.map((v) => v / norm(a));
const mean = (ps: number[][]) =>
  [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length);
const finitePoint = (p: any) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const key = (p: number[]) => p.map((v) => Math.round(v / WELD)).join(",");
const distanceToLine = (p: number[], o: number[], d: number[]) =>
  norm(cross(sub(p, o), d));

/** 主轴完全来自真实唯一顶点/截面中心协方差；没有以声明端点初始化轴线。 */
function principalAxis(ps: number[][]) {
  const origin = mean(ps),
    cov = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const p of ps) {
    const v = sub(p, origin);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) cov[i][j] += v[i] * v[j];
  }
  let direction = [0, 0, 0];
  direction[[0, 1, 2].sort((a, b) => cov[b][b] - cov[a][a])[0]] = 1;
  for (let i = 0; i < 100; i++) {
    const q = cov.map((row) => dot(row, direction));
    if (norm(q) === 0) throw new Error("真实顶点不能确定非零主轴");
    direction = unit(q);
  }
  const deviations = ps.map((p) => distanceToLine(p, origin, direction));
  return {
    origin,
    direction,
    maximumDeviation: Math.max(...deviations),
    rmsDeviation: Math.sqrt(
      deviations.reduce((s, d) => s + d * d, 0) / ps.length,
    ),
  };
}

/** 从截线实际邻接恢复轮廓顺序，不能按极角排序伪造闭合或掩盖折返。 */
function orderedBoundary(s: any): number[][] | null {
  if (s.components.length !== 1 || !s.components[0].closed) return null;
  const ps = s.components[0].points as number[][],
    neighbors = ps.map(() => new Set<number>());
  for (const segment of s.segments) {
    const ids = segment.points.map((p: number[]) =>
      ps.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= WELD),
    );
    if (ids.some((i: number) => i < 0) || ids[0] === ids[1]) return null;
    neighbors[ids[0]].add(ids[1]);
    neighbors[ids[1]].add(ids[0]);
  }
  if (neighbors.some((n) => n.size !== 2)) return null;
  const ids = [0];
  let previous = -1,
    current = 0;
  while (ids.length <= ps.length) {
    const next = [...neighbors[current]].find((n) => n !== previous)!;
    if (next === 0) break;
    if (ids.includes(next)) return null;
    ids.push(next);
    previous = current;
    current = next;
  }
  return ids.length === ps.length ? ids.map((i) => ps[i]) : null;
}

function planarCross(a: number[], b: number[], c: number[]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function edgeDistance(p: number[], a: number[], b: number[]) {
  const d = sub(b, a),
    q = sub(p, a),
    t = Math.max(0, Math.min(1, dot(q, d) / dot(d, d)));
  return Math.hypot(...q.map((v, k) => v - t * d[k]));
}
function polygonMeasure(ps: number[][]) {
  let twiceArea = 0,
    cx = 0,
    cy = 0,
    selfIntersections = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i],
      b = ps[(i + 1) % ps.length],
      w = a[0] * b[1] - b[0] * a[1];
    twiceArea += w;
    cx += (a[0] + b[0]) * w;
    cy += (a[1] + b[1]) * w;
    for (let j = i + 1; j < ps.length; j++) {
      if (j === i + 1 || (i === 0 && j === ps.length - 1)) continue;
      const c = ps[j],
        d = ps[(j + 1) % ps.length],
        s1 = planarCross(a, b, c),
        s2 = planarCross(a, b, d),
        s3 = planarCross(c, d, a),
        s4 = planarCross(c, d, b);
      if (
        (s1 * s2 < 0 && s3 * s4 < 0) ||
        Math.min(
          edgeDistance(a, c, d),
          edgeDistance(b, c, d),
          edgeDistance(c, a, b),
          edgeDistance(d, a, b),
        ) <= WELD
      )
        selfIntersections++;
    }
  }
  const center = [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  return {
    center,
    area: Math.abs(twiceArea) / 2,
    selfIntersections,
    minimumRadius: Math.min(
      ...ps.map((p, i) => edgeDistance(center, p, ps[(i + 1) % ps.length])),
    ),
    maximumRadius: Math.max(
      ...ps.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1])),
    ),
  };
}

/**
 * 半径/端点/直线偏差只用源1e-6或运行6e-5的几何编码界限。
 * 17站截全部三角面，恢复唯一闭合无交叉轮廓，按面积质心拟合中心线。
 * 24边圆柱截面面积约为理想圆的98.86%；97%面积与94%体积下限允许
 * 明确有限的多边形离散/端部倒角体积缺失，不把端部倒角误判成弯杆。
 * 这些占比是形状完整性条件，不是焊接、碰撞、体积或面积数值容差。
 */
export function measureStraightOutput(
  triangles: ActualTriangle[],
  declaration: StraightOutputDeclaration,
  encoding: 1e-6 | 6e-5,
  allDecodedVertices?: Point[],
) {
  const failures: string[] = [];
  const base = {
    encoding,
    thresholds: {
      topologyWeld: WELD,
      triangleArea: AREA,
      solidVolume: VOLUME,
      unchangedCollisionSAT: 1e-9,
      minimumInteriorRadiusRatio: 0.98,
      minimumInteriorAreaRatio: 0.97,
      minimumVolumeRatio: 0.94,
    },
    declaration,
  };
  if (![1e-6, 6e-5].includes(encoding))
    throw new Error("只能使用源1e-6或运行6e-5编码界限");
  if (
    !declaration.endpoints.every(finitePoint) ||
    !Number.isFinite(declaration.radius) ||
    declaration.radius <= 0
  )
    throw new Error("无效直件声明");
  const rawVertices =
    allDecodedVertices ?? triangles.flatMap((t) => t.vertices);
  const invalidVertices = rawVertices.filter((p) => !finitePoint(p)).length;
  const invalidTriangles = triangles.filter(
    (t) => t.vertices.length !== 3 || !t.vertices.every(finitePoint),
  ).length;
  if (
    invalidVertices ||
    invalidTriangles ||
    !triangles.length ||
    !rawVertices.length
  )
    return {
      ...base,
      passed: false,
      failures: ["真实解码几何为空或含非有限顶点/三角面"],
      counts: {
        decodedVertices: rawVertices.length,
        triangles: triangles.length,
        invalidVertices,
        invalidTriangles,
      },
    };
  const ps = [...new Map(rawVertices.map((p) => [key(p), p])).values()];
  const topology = solidTopology({ triangles }, WELD);
  if (!topology.closed || topology.componentCount !== 1)
    failures.push("实际三角面不是一个闭合流形连通分量");
  const edgeDirections = new Map<string, number[]>();
  let zeroAreaTriangles = 0,
    minTriangleArea = Infinity,
    signedVolume = 0;
  const centroid = mean(ps);
  for (const t of triangles) {
    const [a, b, c] = t.vertices,
      area = norm(cross(sub(b, a), sub(c, a))) / 2;
    minTriangleArea = Math.min(minTriangleArea, area);
    if (area <= AREA) zeroAreaTriangles++;
    signedVolume +=
      dot(sub(a, centroid), cross(sub(b, centroid), sub(c, centroid))) / 6;
    for (let i = 0; i < 3; i++) {
      const a = key(t.vertices[i]),
        b = key(t.vertices[(i + 1) % 3]),
        k = [a, b].sort().join("/");
      const ds = edgeDirections.get(k) ?? [];
      ds.push(a < b ? 1 : -1);
      edgeDirections.set(k, ds);
    }
  }
  const inconsistentEdges = [...edgeDirections.values()].filter(
    (ds) => ds.length !== 2 || ds[0] + ds[1] !== 0,
  ).length;
  const volume = Math.abs(signedVolume);
  if (
    zeroAreaTriangles ||
    !Number.isFinite(volume) ||
    volume <= VOLUME ||
    inconsistentEdges
  )
    failures.push("实际三角面积、实体体积或面朝向一致性未通过");
  const [start, end] = declaration.endpoints,
    radius = declaration.radius,
    length = norm(sub(end, start));
  if (length <= 2 * radius) throw new Error("目标必须有明确长轴");
  const expectedAxis = unit(sub(end, start)),
    parameters = ps.map((p) => dot(sub(p, start), expectedAxis));
  const minimumParameter = Math.min(...parameters),
    maximumParameter = Math.max(...parameters);
  const radialDistances = ps.map((p) => distanceToLine(p, start, expectedAxis));
  const maximumRadialDistance = Math.max(...radialDistances),
    maximumRadialExcess = Math.max(0, maximumRadialDistance - radius);
  const endpointExtentDeviation = Math.max(
    Math.abs(minimumParameter),
    Math.abs(maximumParameter - length),
  );
  if (maximumRadialExcess > encoding || endpointExtentDeviation > encoding)
    failures.push("有真实顶点超出直圆柱径向包络或端部长度界限");
  // 有限圆柱是凸集；全部顶点受界定即可约束所有三角面的每一点，而非只抽查中心。
  const principal = principalAxis(ps);
  if (dot(principal.direction, expectedAxis) < 0)
    principal.direction = principal.direction.map((v) => -v);
  const independentAxisEndpointDeviations = declaration.endpoints.map((p) =>
    distanceToLine(p, principal.origin, principal.direction),
  );
  if (Math.max(...independentAxisEndpointDeviations) > encoding)
    failures.push("真实唯一顶点主轴与声明直线偏离超出编码界限");
  const guide = [0, 1, 2].sort(
    (a, b) =>
      Math.abs(principal.direction[a]) - Math.abs(principal.direction[b]),
  )[0];
  const seed = [0, 0, 0];
  seed[guide] = 1;
  const u = unit(cross(principal.direction, seed)),
    v = cross(principal.direction, u);
  const projected = triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((p) => {
      const q = sub(p, principal.origin);
      return [dot(q, u), dot(q, v), -dot(q, principal.direction)];
    }),
  }));
  const t0 = dot(sub(start, principal.origin), principal.direction),
    t1 = dot(sub(end, principal.origin), principal.direction);
  const rows: any[] = [],
    centers: number[][] = [];
  for (let i = 0; i < 17; i++) {
    const fraction = 0.08 + (0.84 * i) / 16;
    let station = t0 + (t1 - t0) * fraction;
    // 仅选择截平面时避开真实顶点所在平面，避免共面三角边的二义性；不更改焊接阈值。
    let stationAdjustments = 0;
    while (
      projected.some((t) =>
        t.vertices.some((p) => Math.abs(-p[2] - station) <= 16 * WELD),
      ) &&
      stationAdjustments < 20
    ) {
      station += (t1 - t0) * 0.00001713;
      stationAdjustments++;
    }
    const s = section({ triangles: projected }, station),
      boundary = orderedBoundary(s);
    if (!boundary) {
      rows.push({
        fraction,
        station,
        components: s.components.length,
        closed: s.components.map((c: any) => c.closed),
        passed: false,
      });
      failures.push(`内部站位${i}没有唯一闭合实际轮廓`);
      continue;
    }
    const p = polygonMeasure(boundary),
      center = principal.origin.map(
        (x, k) =>
          x +
          station * principal.direction[k] +
          p.center[0] * u[k] +
          p.center[1] * v[k],
      );
    const expectedAxisDeviation = distanceToLine(center, start, expectedAxis);
    const radiusAllowance = encoding,
      areaAllowance = Math.PI * (2 * radius * encoding + encoding * encoding);
    const passed =
      Number.isFinite(p.area) &&
      p.area > AREA &&
      p.selfIntersections === 0 &&
      p.minimumRadius >= 0.98 * radius - radiusAllowance &&
      p.maximumRadius <= radius + radiusAllowance &&
      p.area >= 0.97 * Math.PI * radius * radius - areaAllowance &&
      expectedAxisDeviation <= encoding;
    if (!passed) failures.push(`内部站位${i}的有限圆截面/面积中心偏差未通过`);
    rows.push({
      fraction,
      station,
      stationAdjustments,
      boundaryVertices: boundary.length,
      closed: true,
      ...p,
      actualCenter: center,
      expectedAxisDeviation,
      passed,
    });
    centers.push(center);
  }
  const centerline = centers.length >= 3 ? principalAxis(centers) : null;
  if (!centerline || centerline.maximumDeviation > encoding)
    failures.push("实际截面中心线不共线或有效截面不足");
  // 端点由实际截面中心线与实际顶点轴向极值面相交恢复；不把声明端点当测量值。
  const measuredEndpoints = centerline
    ? [minimumParameter, maximumParameter].map((t) => {
        const along =
          (t - dot(sub(centerline.origin, start), expectedAxis)) /
          dot(centerline.direction, expectedAxis);
        return centerline.origin.map(
          (v, k) => v + along * centerline.direction[k],
        );
      })
    : [];
  const endpointDeviations = measuredEndpoints.map((p, i) =>
    norm(sub(p, declaration.endpoints[i])),
  );
  if (endpointDeviations.some((d) => d > encoding))
    failures.push("实际中心线恢复端点与目标端点不一致");
  const idealVolume = Math.PI * radius * radius * length,
    volumeRatio = volume / idealVolume;
  const encodingExpandedVolume =
    Math.PI * (radius + encoding) ** 2 * (length + 2 * encoding);
  const encodingContractedVolume =
    Math.PI *
    Math.max(0, radius - encoding) ** 2 *
    Math.max(0, length - 2 * encoding);
  if (
    volume < 0.94 * encodingContractedVolume ||
    volume > encodingExpandedVolume
  )
    failures.push("实际体积超出有限倒角/离散缺失界限");
  return {
    ...base,
    passed: !failures.length,
    failures,
    counts: {
      decodedVertices: rawVertices.length,
      uniqueActualVertices: ps.length,
      triangles: triangles.length,
      invalidVertices,
      invalidTriangles,
      zeroAreaTriangles,
    },
    topology,
    inconsistentEdges,
    minTriangleArea,
    signedVolume,
    volume,
    idealVolume,
    volumeRatio,
    volumeDeficitRatio: 1 - volumeRatio,
    envelope: {
      minimumParameter,
      maximumParameter,
      expectedLength: length,
      maximumRadialDistance,
      maximumRadialExcess,
      endpointExtentDeviation,
    },
    actualVertexPrincipalAxis: principal,
    independentAxisEndpointDeviations,
    centerline,
    measuredEndpoints,
    endpointDeviations,
    sections: rows,
    limitations: [
      "中心线与圆截面为17个内部真实截面量测；全表面直圆柱包络由所有实际顶点保证",
      "闭合拓扑与非零体积本身不是任意三维自交的完备证明；本检验另排除截面自交，但不声称制造或强度认证",
      "本检验不证明球销/横梁的有限材料连接，也不替代独立全行程碰撞门槛",
    ],
  };
}
