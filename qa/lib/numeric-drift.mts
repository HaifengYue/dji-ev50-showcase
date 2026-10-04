/** Explicitly bounded numerical propagation proof; never used as collision or support tolerance. */
import assert from "node:assert/strict";
export function measureNumericMeshDrift(
  a: any,
  b: any,
  maximumPositionError: number,
) {
  const read = (m: any) => {
    const p = m.geometry.attributes.position;
    return Array.from({ length: p.count }, (_, i) => [
      p.getX(i),
      p.getY(i),
      p.getZ(i),
    ]);
  };
  const pa = read(a),
    pb = read(b),
    cell = maximumPositionError * 1.01,
    buckets = new Map<string, { p: number[]; id: string }[]>(),
    key = (p: number[]) => p.join(","),
    id = (p: number[]) => p.map((x) => x.toString()).join(",");
  for (const p of pa) {
    const k = key(p.map((x) => Math.floor(x / cell)));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push({ p, id: id(p) });
  }
  let maximumDistance = 0;
  const mapping = pb.map((p) => {
    const c = p.map((x) => Math.floor(x / cell));
    let best = Infinity,
      found: string | null = null;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const o of buckets.get(key([c[0] + x, c[1] + y, c[2] + z])) ??
            []) {
            const d = Math.hypot(...p.map((v, i) => v - o.p[i]));
            if (d < best) {
              best = d;
              found = o.id;
            }
          }
    assert(
      found !== null && best <= maximumPositionError,
      `${b.name} numerical position drift exceeds explicit bound ${best}`,
    );
    maximumDistance = Math.max(maximumDistance, best);
    return found!;
  });
  const triangles = (m: any, ids: string[]) => {
    const p = m.geometry.attributes.position,
      ix =
        m.geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i),
      ts = [];
    for (let i = 0; i < ix.length; i += 3) {
      const q = [ids[ix[i]], ids[ix[i + 1]], ids[ix[i + 2]]];
      ts.push(
        [
          q.join("|"),
          [q[1], q[2], q[0]].join("|"),
          [q[2], q[0], q[1]].join("|"),
        ].sort()[0],
      );
    }
    return ts.sort();
  };
  assert.deepEqual(
    triangles(a, pa.map(id)),
    triangles(b, mapping),
    `${b.name} changed oriented connectivity, not solely numerical propagation`,
  );
  return {
    name: a.name,
    maximumPositionError,
    maximumMeasuredVertexDisplacement: maximumDistance,
    orientedConnectivityUnderNearestVertexMapEqual: true,
    triangleCount: triangles(a, pa.map(id)).length,
    physicsExemption: false,
  };
}
