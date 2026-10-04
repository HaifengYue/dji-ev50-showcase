/** 源/运行 GLB 的左右直输出件独立实际网格证据；不修改模型或现有 QA 门槛。 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  measureStraightOutput,
  type Point,
  type ActualTriangle,
} from "./straight-output-geometry.mts";

const sources = process.env.QA_MODEL
  ? [
      {
        source: process.env.QA_MODEL,
        kind:
          process.env.QA_MODEL_KIND ??
          (process.env.QA_MODEL.includes("source") ? "source" : "runtime"),
      },
    ]
  : [
      {
        source: process.env.QA_SOURCE_MODEL ?? "assets/blender/xp4-source.glb",
        kind: "source",
      },
      {
        source: process.env.QA_RUNTIME_MODEL ?? "public/models/xp4.glb",
        kind: "runtime",
      },
    ];
const out =
  process.env.QA_OUT ?? "qa/current/straight-output-report.json";
const reports: any[] = [];
const blenderToGltf = (p: number[]): Point => [p[0], p[2], -p[1]];
for (const { source, kind } of sources) {
  if (kind !== "source" && kind !== "runtime")
    throw new Error("QA_MODEL_KIND 必须是 source 或 runtime");
  const data = fs.readFileSync(source),
    sha256 = createHash("sha256").update(data).digest("hex");
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
  gltf.scene.updateMatrixWorld(true);
  const meshes: T.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as T.Mesh).isMesh) meshes.push(o as T.Mesh);
  });
  const frame = gltf.scene.getObjectByName("BraceSpreader");
  if (!frame) throw new Error("缺少实际 BraceSpreader 坐标系");
  const rows: any[] = [];
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const name = "BraceBodyCarriage_" + side,
      targets = meshes.filter((m) => m.name === name);
    if (targets.length !== 1) throw new Error(`${name} 必须恰好有一个实际网格`);
    const m = targets[0] as any;
    if (
      m.isSkinnedMesh ||
      m.isInstancedMesh ||
      m.morphTargetInfluences?.some((n: number) => n !== 0)
    )
      throw new Error("只支持实际刚性输出网格");
    const position = m.geometry.attributes.position,
      index = m.geometry.index;
    const transform = new T.Matrix4()
      .copy(frame.matrixWorld)
      .invert()
      .multiply(m.matrixWorld);
    const vertices: Point[] = Array.from(
      { length: position.count },
      (_, i) =>
        new T.Vector3(position.getX(i), position.getY(i), position.getZ(i))
          .applyMatrix4(transform)
          .toArray() as Point,
    );
    const count = index?.count ?? position.count;
    if (count % 3) throw new Error("实际三角索引数量无效");
    const triangles: ActualTriangle[] = [];
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      if (
        ids.some((n) => !Number.isInteger(n) || n < 0 || n >= vertices.length)
      )
        throw new Error("实际三角索引越界");
      triangles.push({
        triangleIndex: i / 3,
        vertices: ids.map((i) => vertices[i]),
      });
    }
    const endpointBlender: [Point, Point] = [
      [sign * 0.14004190266132355, -0.009227613918483257, 0.020408956333994865],
      [sign * 0.11999999731779099, -0.008999999612569809, 0.06700000166893005],
    ];
    const declaration = {
      endpoints: endpointBlender.map(blenderToGltf) as [Point, Point],
      radius: 0.007,
    };
    const measurement = measureStraightOutput(
      triangles,
      declaration,
      kind === "source" ? 1e-6 : 6e-5,
      vertices,
    );
    rows.push({
      name,
      coordinateFrame:
        "BraceSpreader 实际局部坐标，glTF [X,Z,-Y] 对应 Blender [X,Y,Z]",
      declaredExtrasOnly: {
        endpointsBlender: m.userData.straightOutputEndpointsLocal ?? null,
        radius: m.userData.straightOutputRadius ?? null,
      },
      actualGeometry: measurement,
      passed: measurement.passed,
    });
  }
  const r = {
    source,
    kind,
    sha256,
    sceneMeshCount: meshes.length,
    rows,
    passed: rows.length === 2 && rows.every((r) => r.passed),
  };
  reports.push(r);
  console.log(
    JSON.stringify({
      source,
      sha256,
      sceneMeshCount: r.sceneMeshCount,
      passed: r.passed,
      rows: rows.map((r) => ({
        name: r.name,
        passed: r.passed,
        counts: r.actualGeometry.counts,
        endpointDeviations: r.actualGeometry.endpointDeviations,
        centerlineMaximumDeviation:
          r.actualGeometry.centerline?.maximumDeviation,
        failures: r.actualGeometry.failures,
      })),
    }),
  );
}
const report = {
  passed: reports.length > 0 && reports.every((r) => r.passed),
  bothSourceAndRuntimeChecked:
    reports.some((r) => r.kind === "source") &&
    reports.some((r) => r.kind === "runtime"),
  reports,
  method:
    "先独立解码所有实际位置/索引并变换到输出滑架坐标，再用唯一真实顶点协方差恢复主轴，截全部实际三角面量测中心线；extras不充当几何证据",
  limitations: [
    "只证明本次哈希的直输出件几何门槛；连接、全行程碰撞、原运动保留仍为独立必要门槛",
    "未修改 SAT 1e-9、拓扑焊接1e-12、非零体积1e-10、三角面积1e-18",
  ],
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
if (!report.passed) process.exitCode = 1;
