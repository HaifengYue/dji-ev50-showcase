import assert from "node:assert/strict";
import * as THREE from "three";

/** 对实际几何点的二阶矩做 Jacobi 分解；可使用面积积分权重，不使用清单或局部轴标签。 */
export function principalAxes(points: THREE.Vector3[], weights?: number[]) {
  const total = weights
    ? weights.reduce((sum, weight) => sum + weight, 0)
    : points.length;
  const center = points
    .reduce(
      (sum, point, i) => sum.addScaledVector(point, weights?.[i] ?? 1),
      new THREE.Vector3(),
    )
    .divideScalar(total);
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const [i, point] of points.entries()) {
    const d = point.clone().sub(center).toArray();
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        covariance[row][column] +=
          (d[row] * d[column] * (weights?.[i] ?? 1)) / total;
  }
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let step = 0; step < 32; step++) {
    let p = 0;
    let q = 1;
    for (let row = 0; row < 3; row++)
      for (let column = row + 1; column < 3; column++)
        if (Math.abs(covariance[row][column]) > Math.abs(covariance[p][q])) {
          p = row;
          q = column;
        }
    if (Math.abs(covariance[p][q]) < 1e-15) break;
    const angle =
      0.5 *
      Math.atan2(2 * covariance[p][q], covariance[q][q] - covariance[p][p]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const pp = covariance[p][p];
    const qq = covariance[q][q];
    const pq = covariance[p][q];
    covariance[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    covariance[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    covariance[p][q] = covariance[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = covariance[k][p];
        const kq = covariance[k][q];
        covariance[k][p] = covariance[p][k] = c * kp - s * kq;
        covariance[k][q] = covariance[q][k] = s * kp + c * kq;
      }
      const vp = vectors[k][p];
      const vq = vectors[k][q];
      vectors[k][p] = c * vp - s * vq;
      vectors[k][q] = s * vp + c * vq;
    }
  }
  return [0, 1, 2]
    .map((i) => ({
      value: covariance[i][i],
      direction: new THREE.Vector3(...vectors.map((row) => row[i])).normalize(),
    }))
    .sort((a, b) => a.value - b.value);
}

/** 三角面三点积分精确到二阶，布尔切孔后的顶点密度不能改变实体轴线估计。 */
export function surfacePrincipalFrame(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const samples: THREE.Vector3[] = [];
  const weights: number[] = [];
  object.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const position = mesh.geometry.getAttribute("position");
    const vertices = Array.from({ length: position.count }, (_, i) =>
      new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld),
    );
    const index = mesh.geometry.index;
    const count = index?.count ?? position.count;
    for (let offset = 0; offset < count; offset += 3) {
      const tri = [0, 1, 2].map(
        (i) => vertices[index ? index.getX(offset + i) : offset + i],
      );
      const area = new THREE.Triangle(
        ...(tri as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
      ).getArea();
      if (area <= 1e-16) continue;
      points.push(...tri);
      const sum = tri.reduce(
        (total, vertex) => total.add(vertex),
        new THREE.Vector3(),
      );
      for (const vertex of tri) {
        // 重心坐标为(2/3,1/6,1/6)及其排列，三点各占三角面面积的1/3。
        samples.push(sum.clone().addScaledVector(vertex, 3).divideScalar(6));
        weights.push(area / 3);
      }
    }
  });
  assert.ok(samples.length > 0, `${object.name} 没有可积分的实际三角面`);
  const axes = principalAxes(samples, weights);
  // 盲孔改变表面面积质心，但不改变外部回转体包络中心；从实面极值恢复桨毂中心。
  const center = new THREE.Vector3();
  for (const { direction } of axes) {
    const values = points.map((point) => point.dot(direction));
    center.addScaledVector(
      direction,
      (Math.min(...values) + Math.max(...values)) / 2,
    );
  }
  return { axes, center, triangleCount: samples.length / 3 };
}
