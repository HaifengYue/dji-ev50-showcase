/** 合成解析网格：不读取/生成 GLB，不使用作者生成器或名义属性作为证据。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  measureStraightOutput,
  type Point,
  type ActualTriangle,
} from "./straight-output-geometry.mts";
const radius = 0.007,
  length = 0.05;
const declaration = {
  endpoints: [
    [0, 0, 0],
    [0, 0, length],
  ] as [Point, Point],
  radius,
};
function rod(map: (p: Point) => Point = (p) => p, radialScale = 1) {
  const n = 24,
    triangles: ActualTriangle[] = [],
    rings: Point[][] = [];
  // 两端均有有限倒角；中间增加真实截环，反例可弯曲中段而保持端点。
  for (const [z, r] of [
    [0, 0.006],
    [0.0003, 0.0067],
    [0.001, radius],
    [0.01, radius],
    [0.025, radius],
    [0.04, radius],
    [0.049, radius],
    [0.0497, 0.0067],
    [0.05, 0.006],
  ]) {
    rings.push(
      Array.from({ length: n }, (_, i) =>
        map([
          radialScale * r * Math.cos((i * 2 * Math.PI) / n),
          radialScale * r * Math.sin((i * 2 * Math.PI) / n),
          z,
        ]),
      ),
    );
  }
  const add = (vertices: Point[]) =>
    triangles.push({ vertices, triangleIndex: triangles.length });
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      add([rings[k][i], rings[k][j], rings[k + 1][j]]);
      add([rings[k][i], rings[k + 1][j], rings[k + 1][i]]);
    }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    add([map([0, 0, 0]), rings[0][j], rings[0][i]]);
    add([map([0, 0, length]), rings.at(-1)![i], rings.at(-1)![j]]);
  }
  return triangles;
}
const results: any[] = [];
function check(
  name: string,
  triangles: ActualTriangle[],
  encoding: 1e-6 | 6e-5,
  expected: boolean,
  decl = declaration,
  vertices?: Point[],
) {
  const r = measureStraightOutput(triangles, decl, encoding, vertices);
  assert.equal(r.passed, expected, `${name}: ${JSON.stringify(r.failures)}`);
  results.push({
    name,
    expected,
    passed: r.passed,
    failures: r.failures,
    counts: r.counts,
    centerlineMaximumDeviation: r.centerline?.maximumDeviation,
    endpointDeviations: r.endpointDeviations,
    volumeRatio: r.volumeRatio,
  });
  return r;
}
const straight = rod();
const accepted = check("24边双倒角直实心件", straight, 1e-6, true);
assert.equal(accepted.topology?.componentCount, 1);
assert(accepted.centerline!.maximumDeviation < 1e-12);
assert.equal(accepted.sections?.length, 17);
check(
  "运行量化界限以内的真实几何扰动",
  rod(
    (p) =>
      p.map(
        (v, k) => Math.round((v + (k === 0 ? 8e-6 : 0)) / 2e-6) * 2e-6,
      ) as Point,
  ),
  6e-5,
  true,
);
const rotate = (p: Point): Point => [
  0.12 + 0.8 * p[0] + 0.6 * p[2],
  -0.009 + p[1],
  0.02 - 0.6 * p[0] + 0.8 * p[2],
];
check("实际式斜向旋转/平移倒角直件", rod(rotate), 1e-6, true, {
  endpoints: declaration.endpoints.map(rotate) as [Point, Point],
  radius,
});
const mirror = (p: Point): Point => {
  const q = rotate(p);
  return [-q[0], q[1], q[2]];
};
check("另一侧镜像倒角直件", rod(mirror), 1e-6, true, {
  endpoints: declaration.endpoints.map(mirror) as [Point, Point],
  radius,
});
// 不改变端点，实际中段轻微偏轴仍需失败。
check(
  "源轻微弯曲5e-6",
  rod((p) => [p[0] + 5e-6 * Math.sin((Math.PI * p[2]) / length), p[1], p[2]]),
  1e-6,
  false,
);
check(
  "运行轻微弯曲1.5e-4",
  rod((p) => [p[0] + 1.5e-4 * Math.sin((Math.PI * p[2]) / length), p[1], p[2]]),
  6e-5,
  false,
);
check(
  "明显弯曲中段",
  rod((p) => [p[0] + 0.012 * Math.sin((Math.PI * p[2]) / length), p[1], p[2]]),
  1e-6,
  false,
);
const u = rod((p) => {
  const a = (Math.PI * p[2]) / length;
  return [(0.025 + p[0]) * Math.cos(a), p[1], (0.025 + p[0]) * Math.sin(a)];
});
const uResult = check("单个闭合U形实心件", u, 1e-6, false, {
  endpoints: [
    [0.025, 0, 0],
    [-0.025, 0, 0],
  ],
  radius,
});
assert(uResult.topology?.closed);
assert.equal(uResult.topology?.componentCount, 1);
check(
  "整根直件轴线错误偏移",
  rod((p) => [p[0] + 8e-5, p[1], p[2]]),
  6e-5,
  false,
);
check(
  "整根直件长度错误",
  rod((p) => [p[0], p[1], p[2] * 0.96]),
  1e-6,
  false,
);
check(
  "半径/体积显著缺失",
  rod((p) => p, 0.6),
  1e-6,
  false,
);
check("缺少一个实际面", straight.slice(1), 1e-6, false);
check(
  "两个分离闭合组件",
  [
    ...straight,
    ...rod((p) => [p[0] + 0.03, p[1], p[2]]).map((t) => ({
      ...t,
      triangleIndex: t.triangleIndex + straight.length,
    })),
  ],
  1e-6,
  false,
);
check(
  "单面错误朝向",
  straight.map((t, i) =>
    i ? t : { ...t, vertices: [...t.vertices].reverse() },
  ),
  1e-6,
  false,
);
check(
  "零面积实际三角面",
  [
    ...straight,
    {
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      triangleIndex: straight.length,
    },
  ],
  1e-6,
  false,
);
check("索引外实际顶点超包络", straight, 1e-6, false, declaration, [
  ...straight.flatMap((t) => t.vertices),
  [0.02, 0, 0.02],
]);
check("非有限实际顶点", straight, 1e-6, false, declaration, [
  ...straight.flatMap((t) => t.vertices),
  [NaN, 0, 0],
]);
const report = {
  passed: true,
  analyticCases: results.length,
  results,
  scope: "只使用合成实际三角网格；未宣称当前 GLB 通过",
};
if (process.env.QA_OUT)
  fs.writeFileSync(process.env.QA_OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
