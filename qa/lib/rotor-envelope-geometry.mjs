// 保守旋翼包络几何：所有正间隙都来自实计算，不以缩小桨盘求通过。
import * as T from "three";
export function triangleDistance(tri, c) {
  let best = Math.min(...tri.map((p) => p.distanceTo(c)));
  for (let i = 0; i < 3; i++) {
    const l = new T.Line3(tri[i], tri[(i + 1) % 3]);
    if (l.distanceSq() > 1e-24)
      best = Math.min(
        best,
        l.closestPointToPoint(c, true, new T.Vector3()).distanceTo(c),
      );
  }
  const t = new T.Triangle(...tri);
  if (t.getArea() > 1e-18)
    best = Math.min(
      best,
      t.closestPointToPoint(c, new T.Vector3()).distanceTo(c),
    );
  return best;
}

function clip(poly, c, n, limit, sign) {
  const out = [];
  if (!poly.length) return out;
  for (let i = 0; i < poly.length; i++) {
    const x = poly[i],
      y = poly[(i + 1) % poly.length],
      dx = sign * x.clone().sub(c).dot(n) - limit,
      dy = sign * y.clone().sub(c).dot(n) - limit;
    if (dx <= 1e-9) out.push(x);
    if (dx <= 0 !== dy <= 0) out.push(x.clone().lerp(y, dx / (dx - dy)));
  }
  return out;
}
export function envelopeTriangle(r, tri) {
  let poly = clip(tri, r.c, r.n, r.halfThickness, 1);
  poly = clip(poly, r.c, r.n, r.halfThickness, -1);
  if (!poly.length) return null;
  poly = poly.map((p) =>
    p.clone().addScaledVector(r.n, -p.clone().sub(r.c).dot(r.n)),
  );
  const max = Math.max(...poly.map((p) => p.distanceTo(r.c)));
  if (max < r.innerRadius - 1e-9) return null;
  let min = Math.min(...poly.map((p) => p.distanceTo(r.c)));
  for (let i = 1; i < poly.length - 1; i++)
    min = Math.min(min, triangleDistance([poly[0], poly[i], poly[i + 1]], r.c));
  if (poly.length === 2)
    min = Math.min(
      min,
      new T.Line3(poly[0], poly[1])
        .closestPointToPoint(r.c, true, new T.Vector3())
        .distanceTo(r.c),
    );
  return min <= r.radius + 1e-9
    ? { radialMinimum: min, radialMaximum: max }
    : null;
}
// 有限厚度实心圆柱包络是实际桨叶全周包络的超集；找到分离轴即可排除任意独立相位碰撞。
export function cylinderSeparation(x, y) {
  const delta = y.c.clone().sub(x.c),
    axes = [
      x.n,
      y.n,
      delta.clone().normalize(),
      new T.Vector3().crossVectors(x.n, y.n).normalize(),
      delta.clone().addScaledVector(x.n, -delta.dot(x.n)).normalize(),
      delta.clone().addScaledVector(y.n, -delta.dot(y.n)).normalize(),
    ];
  let gap = -Infinity,
    axis = null;
  for (const n of axes) {
    if (n.lengthSq() < 0.5) continue;
    const radius = (r) =>
      r.radius * Math.sqrt(Math.max(0, 1 - n.dot(r.n) ** 2)) +
      r.halfThickness * Math.abs(n.dot(r.n));
    const g = Math.abs(delta.dot(n)) - radius(x) - radius(y);
    if (g > gap) {
      gap = g;
      axis = n.toArray();
    }
  }
  return { separated: gap > 1e-9, separatingGap: gap, axis };
}
