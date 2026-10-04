/** Shared independent geometry utilities. No production metadata determines a pass. */
import * as T from "three";
const { pointInSolid, surfaceDistance } =
  await import("./solid-contact.mjs");
const { intersectMeshTriangles } =
  await import("./triangle-contact.mjs");
export const EPSILON = {
  sat: 1e-9,
  solid: 1e-8,
  weld: 1e-12,
  area: 1e-18,
  volume: 1e-10,
};
export const unique = (points: number[][]) => [
  ...new Map(
    points.map((p) => [p.map((v) => v.toFixed(10)).join(","), p]),
  ).values(),
];
export const samples = (s: any) =>
  unique(
    s.triangles.flatMap((t: any) => {
      const v = t.vertices;
      return [
        ...v,
        ...[0, 1, 2].map((i) =>
          v[i].map((x: number, k: number) => (x + v[(i + 1) % 3][k]) / 2),
        ),
        v[0].map((x: number, k: number) => (x + v[1][k] + v[2][k]) / 3),
      ];
    }),
  );
export function mesh(a: any, name: string) {
  const m = a.scene.getObjectByName(name);
  if (!m?.isMesh) throw new Error("Missing actual mesh " + name);
  return m;
}
export function frame(a: any, name: string | null) {
  const o = name ? a.scene.getObjectByName(name) : a.scene;
  if (!o) throw new Error("Missing frame " + name);
  return o;
}
export function componentSamples(s: any) {
  const parent: number[] = [],
    ids = new Map<string, number>();
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const id = (p: number[]) => {
    const key = p.map((v) => Math.round(v / EPSILON.weld)).join(",");
    if (!ids.has(key)) {
      ids.set(key, parent.length);
      parent.push(parent.length);
    }
    return ids.get(key)!;
  };
  const triangles = s.triangles.map((t: any) => {
    const vs = t.vertices.map(id);
    for (let i = 1; i < 3; i++) parent[root(vs[i])] = root(vs[0]);
    return { t, vertex: vs[0] };
  });
  const groups = new Map<number, any[]>();
  for (const { t, vertex } of triangles) {
    const r = root(vertex);
    groups.set(r, [...(groups.get(r) ?? []), t]);
  }
  return [...groups.values()].map((triangles, component) => ({
    component,
    triangles,
    points: samples({ triangles }),
  }));
}
const orientationCache = new WeakMap<object, any>();
export function directedEdgeOrientation(s: any) {
  const cached = orientationCache.get(s);
  if (cached) return cached;
  const edges = new Map<string, { count: number; balance: number }>();
  const key = (p: number[]) =>
    p.map((v) => Math.round(v / EPSILON.weld)).join(",");
  for (const t of s.triangles) {
    const vs = t.vertices.map(key);
    for (let i = 0; i < 3; i++) {
      const a = vs[i],
        b = vs[(i + 1) % 3],
        k = [a, b].sort().join("/"),
        r = edges.get(k) ?? { count: 0, balance: 0 };
      r.count++;
      r.balance += a < b ? 1 : a > b ? -1 : 0;
      edges.set(k, r);
    }
  }
  const bad = [...edges].filter(([k, r]) => r.count !== 2 || r.balance !== 0),
    result = {
      consistent: bad.length === 0,
      edgeCount: edges.size,
      badEdges: bad.slice(0, 8),
    };
  orientationCache.set(s, result);
  return result;
}
export function windingClassification(point: number[], s: any) {
  const orientation = directedEdgeOrientation(s);
  if (!orientation.consistent)
    return {
      winding: null,
      integerError: null,
      state: "unresolved-inconsistent-face-orientation",
      orientation,
    };
  const p = new T.Vector3(...point);
  let sum = 0;
  for (const tri of s.triangles) {
    const [a, b, c] = tri.vertices.map((v: number[]) =>
        new T.Vector3(...v).sub(p),
      ),
      la = a.length(),
      lb = b.length(),
      lc = c.length();
    sum +=
      2 *
      Math.atan2(
        a.dot(b.clone().cross(c)),
        la * lb * lc + a.dot(b) * lc + b.dot(c) * la + c.dot(a) * lb,
      );
  }
  const winding = sum / (4 * Math.PI),
    rounded = Math.round(winding),
    integerError = Math.abs(winding - rounded);
  return {
    winding,
    integerError,
    orientation,
    state:
      integerError < 1e-6 && Math.abs(rounded) <= 1
        ? Math.abs(rounded) === 1
          ? "inside"
          : "outside"
        : "unresolved-winding",
  };
}
export function spanArea(points: number[][]) {
  if (points.length < 3) return 0;
  const origin = new T.Vector3(...points[0]);
  let far = origin.clone(),
    area = 0;
  for (const p of points) {
    const q = new T.Vector3(...p);
    if (q.distanceToSquared(origin) > far.distanceToSquared(origin)) far = q;
  }
  for (const p of points)
    area = Math.max(
      area,
      far
        .clone()
        .sub(origin)
        .cross(new T.Vector3(...p).sub(origin))
        .length() / 2,
    );
  return area;
}
export function materialContact(
  a: any,
  names: string[],
  frameName: string | null = null,
) {
  const ms = names.map((n) => mesh(a, n)),
    ss = ms.map((m) => a.snap(m)),
    ts = names.map((n) => a.topology.get(n)),
    inv = frame(a, frameName).matrixWorld.clone().invert();
  const sat = intersectMeshTriangles(ss[0], ss[1], {
      maxWitnesses: 1,
      epsilon: EPSILON.sat,
    }),
    inside: any[] = [],
    unresolved: any[] = [];
  const components = ss.map(componentSamples),
    resolvedRayDisagreements: any[] = [],
    seen = new Set<string>();
  const classify = (i: number, component: any, p: number[]) => {
    const key =
      i +
      ":" +
      component.component +
      ":" +
      p.map((v) => v.toFixed(12)).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    if (
      p.some(
        (v, k) =>
          v < ss[1 - i].bounds.min[k] - EPSILON.solid ||
          v > ss[1 - i].bounds.max[k] + EPSILON.solid,
      )
    )
      return;
    let q = pointInSolid(p, ss[1 - i], ts[1 - i], EPSILON.solid);
    if (q.state === "unresolved-open-mesh") return;
    if (q.state === "unresolved-ray-disagreement") {
      const independent = windingClassification(p, ss[1 - i]);
      if (!independent.state.startsWith("unresolved")) {
        resolvedRayDisagreements.push({
          mesh: names[i],
          partner: names[1 - i],
          point: p,
          original: q,
          independent,
        });
        q = { ...q, state: independent.state };
      }
    }
    if (q.state.startsWith("unresolved")) {
      unresolved.push({ mesh: names[i], p, state: q.state });
      return;
    }
    if (!["inside", "boundary"].includes(q.state)) return;
    inside.push({
      mesh: names[i],
      component: component.component,
      point: p,
      local: new T.Vector3(...p).applyMatrix4(inv).toArray(),
      state: q.state,
      depth: q.distance,
    });
  };
  for (const i of [0, 1])
    for (const component of components[i])
      for (const p of component.points) classify(i, component, p);
  let adaptiveBarycentricSamples = 0;
  if (inside.length < 4) {
    // A narrow shaft through a large triangulated disc can initially produce only its two cap centers.
    // Sample the actual candidate triangles on an eighth-order barycentric grid instead of assuming finite area.
    for (const i of [0, 1])
      for (const component of components[i])
        for (const tri of component.triangles) {
          const other = ss[1 - i].bounds;
          if (
            [0, 1, 2].some(
              (k) =>
                tri.bounds.max[k] < other.min[k] - EPSILON.solid ||
                tri.bounds.min[k] > other.max[k] + EPSILON.solid,
            )
          )
            continue;
          for (let j = 0; j <= 8; j++)
            for (let k = 0; k <= 8 - j; k++) {
              const q = tri.vertices[0].map(
                (v: number, l: number) =>
                  v * (1 - j / 8 - k / 8) +
                  (tri.vertices[1][l] * j) / 8 +
                  (tri.vertices[2][l] * k) / 8,
              );
              adaptiveBarycentricSamples++;
              classify(i, component, q);
            }
        }
  }
  const ps = unique(inside.map((p) => p.local));
  let area = 0;
  if (ps.length >= 3) {
    const origin = new T.Vector3(...ps[0]);
    let far = origin.clone();
    for (const p of ps) {
      const q = new T.Vector3(...p);
      if (q.distanceToSquared(origin) > far.distanceToSquared(origin)) far = q;
    }
    for (const p of ps)
      area = Math.max(
        area,
        far
          .clone()
          .sub(origin)
          .cross(new T.Vector3(...p).sub(origin))
          .length() / 2,
      );
  }
  const componentCoverage = components.flatMap((cs, i) =>
    cs.map((c) => ({
      mesh: names[i],
      component: c.component,
      meshComponentCount: cs.length,
      contactSpanArea: spanArea(
        inside
          .filter((p) => p.mesh === names[i] && p.component === c.component)
          .map((p) => p.local),
      ),
      contactSamples: inside.filter(
        (p) => p.mesh === names[i] && p.component === c.component,
      ).length,
    })),
  );
  return {
    pair: names,
    frame: frameName,
    componentCoverage,
    sameRigid: ms[0].qaGroup === ms[1].qaGroup,
    surfaceContact: sat.intersects,
    closed: ts.map((t) => t.closed),
    sampleCount: ps.length,
    strictInsideSamples: inside.filter((p) => p.state === "inside").length,
    boundarySamples: inside.filter((p) => p.state === "boundary").length,
    spanTriangleArea: area,
    observedBounds: [0, 1, 2].map((k) => [
      Math.min(...ps.map((p) => p[k])),
      Math.max(...ps.map((p) => p[k])),
    ]),
    samples: inside,
    unresolved,
    resolvedRayDisagreements,
    adaptiveBarycentricSamples,
    satWitness: sat.witnesses[0],
  };
}
function rayBox(ray: T.Ray, b: any) {
  return (
    ray.intersectBox(
      new T.Box3(
        new T.Vector3(...b.min),
        new T.Vector3(...b.max),
      ).expandByScalar(EPSILON.solid),
      new T.Vector3(),
    ) !== null
  );
}
export function rayDistances(s: any, origin: T.Vector3, direction: T.Vector3) {
  const ray = new T.Ray(origin, direction),
    hit = new T.Vector3(),
    ds: number[] = [],
    stack = s.bvh ? [s.bvh] : [];
  while (stack.length) {
    const n = stack.pop();
    if (!rayBox(ray, n.bounds)) continue;
    if (!n.indices) {
      stack.push(n.left, n.right);
      continue;
    }
    for (const ix of n.indices) {
      const v = s.triangles[ix].vertices.map(
        (p: number[]) => new T.Vector3(...p),
      );
      // Same barycentric tolerance as the established solid-ray routine; physical distances and SAT epsilon are unchanged.
      const edge1 = v[1].clone().sub(v[0]),
        edge2 = v[2].clone().sub(v[0]),
        h = direction.clone().cross(edge2),
        det = edge1.dot(h);
      if (Math.abs(det) < 1e-16) continue;
      const inv = 1 / det,
        offset = origin.clone().sub(v[0]),
        u = offset.dot(h) * inv;
      if (u < -1e-10 || u > 1 + 1e-10) continue;
      const q = offset.clone().cross(edge1),
        bary = direction.dot(q) * inv;
      if (bary < -1e-10 || u + bary > 1 + 1e-10) continue;
      const distance = edge2.dot(q) * inv;
      if (distance > EPSILON.solid) ds.push(distance);
    }
  }
  ds.sort((a, b) => a - b);
  return ds.filter((d, i) => !i || d - ds[i - 1] > 1e-7);
}
export function basis(axis: T.Vector3) {
  const u = axis
      .clone()
      .cross(
        Math.abs(axis.y) < 0.9
          ? new T.Vector3(0, 1, 0)
          : new T.Vector3(1, 0, 0),
      )
      .normalize(),
    v = axis.clone().cross(u).normalize();
  return { u, v };
}
export function boreRays(a: any, d: any) {
  const f = frame(a, d.frame),
    center = new T.Vector3(...d.center).applyMatrix4(f.matrixWorld),
    axis = new T.Vector3(...d.axis).transformDirection(f.matrixWorld),
    { u, v } = basis(axis),
    s = a.snap(mesh(a, d.host)),
    rows: any[] = [];
  for (const station of d.stations)
    for (let k = 0; k < (d.angles ?? 32); k++) {
      const angle = (k * 2 * Math.PI) / (d.angles ?? 32),
        origin = center.clone().addScaledVector(axis, station),
        direction = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
      const distances = rayDistances(s, origin, direction);
      rows.push({
        station,
        angle,
        distances: distances.slice(0, 4),
        first: distances[0] ?? null,
      });
    }
  return {
    center: center.toArray(),
    axis: axis.toArray(),
    rows,
    minimumRadius: Math.min(...rows.map((r) => r.first ?? Infinity)),
    maximumRadius: Math.max(...rows.map((r) => r.first ?? Infinity)),
    allHit: rows.every((r) => r.first !== null),
  };
}
export function decorationDistances(a: any, d: any) {
  const ss = d.hosts.map((n: string) => a.snap(mesh(a, n))),
    m = mesh(a, d.name),
    rows = samples(a.snap(m)).map((point) => {
      const choices = ss.map((s: any) => ({
        host: s.name,
        ...surfaceDistance(point, s),
      }));
      choices.sort((a: any, b: any) => a.distance - b.distance);
      return { point, ...choices[0] };
    });
  return {
    name: d.name,
    hosts: d.hosts,
    sampleCount: rows.length,
    minimumDistance: Math.min(...rows.map((r) => r.distance)),
    maximumDistance: Math.max(...rows.map((r) => r.distance)),
    worst: rows
      .slice()
      .sort((x, y) => y.distance - x.distance)
      .slice(0, 8),
    rows,
  };
}
