import * as THREE from 'three';
import type { ModelRig } from './rig';

export type BladeExposureProfile = {
  axis: THREE.Vector3;
  radialU: THREE.Vector3;
  radialV: THREE.Vector3;
  rows: {
    radius: number;
    minAngle: number;
    maxAngle: number;
    minAxial: number;
    maxAxial: number;
  }[];
};

/** 直接读取原始局部变换，不临时展开或挪动权威模型。 */
function restToProp(rig: ModelRig, mesh: THREE.Object3D, prop: THREE.Object3D) {
  const result = new THREE.Matrix4();
  for (let node: THREE.Object3D | null = mesh; node !== prop; node = node.parent) {
    if (!node) throw new Error('叶片不属于当前电机');
    const rest = rig.nodes.get(node.name);
    result.premultiply(
      new THREE.Matrix4().compose(
        rest?.position ?? node.position,
        rest?.quaternion ?? node.quaternion,
        node.scale,
      ),
    );
  }
  return result;
}

/**
 * 将真实展开B叶片投影到绕实际电机轴的圆柱。圆与三角形边的交点
 * 保留后掠弦宽、渐尖叶尖、根部轴套和随半径变化的真实轴向包络。
 * A叶片是V15资产契约已验证的180°对置副本，不使用臆造的宽桨轮廓。
 */
export function createBladeExposureProfile(
  rig: ModelRig,
  prop: ModelRig['props'][number],
  radialSegments = 96,
): BladeExposureProfile {
  const blade = rig.scene.getObjectByName(`Blade_${prop.id}_B`);
  if (!(blade instanceof THREE.Mesh)) throw new Error(`快门显示缺少实体桨叶 ${prop.id}_B`);
  const transform = restToProp(rig, blade, prop.object);
  const positions = blade.geometry.getAttribute('position');
  const points = Array.from({ length: positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform),
  );
  const axis = prop.axis.clone().normalize();
  const radial = (p: THREE.Vector3) => p.clone().addScaledVector(axis, -p.dot(axis));
  const tip = points.reduce((a, b) => (radial(a).lengthSq() > radial(b).lengthSq() ? a : b));
  const radialU = radial(tip).normalize(),
    radialV = axis.clone().cross(radialU).normalize();
  const polar = points.map((p) => new THREE.Vector3(p.dot(radialU), p.dot(radialV), p.dot(axis)));
  const maxRadius = Math.max(...polar.map((p) => Math.hypot(p.x, p.y)));
  const index = blade.geometry.index;
  const edgeKeys = new Set<string>(),
    edges: [THREE.Vector3, THREE.Vector3][] = [];
  const count = index?.count ?? points.length;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3],
        key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([polar[a], polar[b]]);
      }
    }
  }
  // 求边上真正的最近点，不能只比较两端顶点。
  const minRadius = Math.min(
    ...edges.map(([a, b]) => {
      const x = b.x - a.x,
        y = b.y - a.y,
        length = x * x + y * y;
      const t = length ? THREE.MathUtils.clamp(-(a.x * x + a.y * y) / length, 0, 1) : 0;
      return Math.hypot(a.x + t * x, a.y + t * y);
    }),
  );
  const rows = Array.from({ length: radialSegments + 1 }, (_, i) => {
    const radius = THREE.MathUtils.lerp(minRadius, maxRadius, i / radialSegments);
    const hits: THREE.Vector3[] = [];
    for (const [a, b] of edges) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = b.z - a.z;
      const A = dx * dx + dy * dy,
        B = 2 * (a.x * dx + a.y * dy),
        C = a.x * a.x + a.y * a.y - radius * radius;
      if (A < 1e-18) continue;
      const d = B * B - 4 * A * C;
      if (d < -1e-12) continue;
      for (const t of [
        (-B - Math.sqrt(Math.max(0, d))) / (2 * A),
        (-B + Math.sqrt(Math.max(0, d))) / (2 * A),
      ]) {
        if (t >= -1e-7 && t <= 1 + 1e-7)
          hits.push(new THREE.Vector3(a.x + t * dx, a.y + t * dy, a.z + t * dz));
      }
    }
    if (!hits.length) throw new Error(`叶片径向轮廓采样失败 ${prop.id}/${i}`);
    const angles = hits.map((p) => Math.atan2(p.y, p.x));
    return {
      radius,
      minAngle: Math.min(...angles),
      maxAngle: Math.max(...angles),
      minAxial: Math.min(...hits.map((p) => p.z)),
      maxAxial: Math.max(...hits.map((p) => p.z)),
    };
  });
  return { axis, radialU, radialV, rows };
}

/** 薄闭合包络只混合朝外正面，避免两张透明圆盘重复叠加。 */
export function createExposureGeometry(profile: BladeExposureProfile, angularSegments = 128) {
  const positions: number[] = [],
    rotorXY: number[] = [],
    bladeArc: number[] = [],
    indices: number[] = [];
  const stride = angularSegments + 1,
    layer = profile.rows.length * stride;
  for (const top of [true, false]) {
    for (const row of profile.rows)
      for (let j = 0; j <= angularSegments; j++) {
        const angle = (j / angularSegments) * Math.PI * 2,
          x = row.radius * Math.cos(angle),
          y = row.radius * Math.sin(angle);
        const p = profile.radialU
          .clone()
          .multiplyScalar(x)
          .addScaledVector(profile.radialV, y)
          .addScaledVector(profile.axis, top ? row.maxAxial : row.minAxial);
        positions.push(p.x, p.y, p.z);
        rotorXY.push(x, y);
        bladeArc.push(row.minAngle, row.maxAngle);
      }
  }
  for (let i = 0; i < profile.rows.length - 1; i++)
    for (let j = 0; j < angularSegments; j++) {
      const a = i * stride + j,
        b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
      indices.push(a + layer, a + 1 + layer, b + layer, a + 1 + layer, b + 1 + layer, b + layer);
    }
  for (const row of [0, profile.rows.length - 1])
    for (let j = 0; j < angularSegments; j++) {
      const a = row * stride + j,
        b = a + 1;
      if (row === 0) indices.push(a, b, a + layer, b, b + layer, a + layer);
      else indices.push(a, a + layer, b, b, a + layer, b + layer);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('rotorXY', new THREE.Float32BufferAttribute(rotorXY, 2));
  geometry.setAttribute('bladeArc', new THREE.Float32BufferAttribute(bladeArc, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** 两片对置叶片的累计占据角，周期为π。 */
function occupiedPrimitive(angle: number, width: number) {
  const turns = Math.floor(angle / Math.PI);
  return turns * width + Math.min(angle - turns * Math.PI, width);
}

/** 连续快门覆盖率；作为回归测试的CPU参考实现。 */
export function angularShutterCoverage(
  angle: number,
  bladeMin: number,
  bladeMax: number,
  phaseStart: number,
  phaseEnd: number,
) {
  const width = Math.max(0, bladeMax - bladeMin),
    lo = Math.min(phaseStart, phaseEnd),
    hi = Math.max(phaseStart, phaseEnd);
  if (hi - lo < 1e-8)
    return (((angle - bladeMin - lo) % Math.PI) + Math.PI) % Math.PI <= width ? 1 : 0;
  return Math.max(
    0,
    Math.min(
      1,
      (occupiedPrimitive(angle - bladeMin - lo, width) -
        occupiedPrimitive(angle - bladeMin - hi, width)) /
        (hi - lo),
    ),
  );
}
