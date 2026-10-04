/** 源文件重新导出 + 实际 Meshopt 解码：逐网格双向顶点集合和材质对照。 */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
const paths = [
  "assets/blender/xp4-source.glb",
  process.env.TRANSWING_COMPARE_SOURCE ?? "public/models/xp4.glb",
  "qa/current/author/source-reexport.glb",
];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const bytes = paths.map((p) => fs.readFileSync(p));
assert(
  bytes[0].equals(bytes[2]),
  "Fresh Blender re-export differs from the authored source GLB",
);
const loaded = await Promise.all(
  bytes
    .slice(0, 2)
    .map((b) =>
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          "",
        ),
    ),
);
const players = loaded.map((g) => {
  assert.equal(g.animations.length, 2);
  assert.equal(
    g.animations.find((a) => a.name === "TRANSWING_Hover_Cruise_Hover").tracks
      .length,
    18,
  );
  assert.equal(
    g.animations.find((a) => a.name === "TRANSWING_Motors_Start_Stop").tracks
      .length,
    26,
  );
  const mixer = new T.AnimationMixer(g.scene);
  const action = mixer.clipAction(g.animations[0]);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return { g, mixer, action };
});
const meshMaps = loaded.map((g) => {
  const m = new Map();
  g.scene.traverse((o) => {
    if (o.isMesh) m.set(o.name, o);
  });
  return m;
});
assert.deepEqual(
  [...meshMaps[0].keys()].sort(),
  [...meshMaps[1].keys()].sort(),
);
const cell = 0.0003;
function points(mesh) {
  const a = mesh.geometry.attributes.position,
    n = mesh.geometry.attributes.normal,
    nm = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return Array.from({ length: a.count }, (_, i) => {
    const p = new T.Vector3()
      .fromBufferAttribute(a, i)
      .applyMatrix4(mesh.matrixWorld);
    p.qaNormal = new T.Vector3()
      .fromBufferAttribute(n, i)
      .applyNormalMatrix(nm);
    return p;
  });
}
let normalAngleMax = 0;
let currentNormalMesh = "",
  normalWorst = null;
function nearestBound(a, b) {
  const map = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const p of b) {
    const k = key(
      Math.floor(p.x / cell),
      Math.floor(p.y / cell),
      Math.floor(p.z / cell),
    );
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  let max = 0;
  for (const p of a) {
    const q = [
      Math.floor(p.x / cell),
      Math.floor(p.y / cell),
      Math.floor(p.z / cell),
    ];
    let min = Infinity;
    const candidates = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const v of map.get(key(q[0] + i, q[1] + j, q[2] + k)) ?? []) {
            const d = p.distanceTo(v);
            min = Math.min(min, d);
            candidates.push([d, v]);
          }
    assert(min < cell, `Vertex deviation ${min} exceeds ${cell}`);
    max = Math.max(max, min);
    const angles = candidates
      .filter(([d]) => d < 0.0001)
      .map(([, v]) => p.qaNormal.angleTo(v.qaNormal));
    const angle = Math.min(...angles);
    if (angle > normalAngleMax) {
      normalAngleMax = angle;
      normalWorst = {
        name: currentNormalMesh,
        angle,
        position: p.toArray(),
        nearestDistance: min,
        candidateCount: angles.length,
      };
    }
  }
  return max;
}
let globalMax = 0;
const checks = [];
for (const [clipName, times] of [
  [
    "TRANSWING_Hover_Cruise_Hover",
    [0, 1, 2, 79 / 24, 119 / 24, 6.1, 7.5, 199 / 24],
  ],
  ["TRANSWING_Motors_Start_Stop", [0, 0.5, 1, 1.5, 2.5, 4, 5, 5.5, 6.5, 7]],
]) {
  for (const p of players) {
    p.mixer.stopAllAction();
    p.action = p.mixer.clipAction(
      p.g.animations.find((a) => a.name === clipName),
    );
    p.action.setLoop(T.LoopOnce, 1);
    p.action.clampWhenFinished = true;
    p.action.play();
  }
  for (const time of times) {
    for (const p of players) {
      p.action.paused = false;
      p.mixer.setTime(time);
      p.g.scene.updateMatrixWorld(true);
    }
    let max = 0;
    for (const [name, a] of meshMaps[0]) {
      const b = meshMaps[1].get(name);
      currentNormalMesh = name;
      const pa = points(a),
        pb = points(b);
      max = Math.max(max, nearestBound(pa, pb), nearestBound(pb, pa));
      const am = a.material,
        bm = b.material;
      assert(
        am.color.distanceTo
          ? am.color.distanceTo(bm.color) < 1e-5
          : am.color
              .toArray()
              .every((v, i) => Math.abs(v - bm.color.toArray()[i]) < 1e-5),
      );
      assert(Math.abs(am.metalness - bm.metalness) < 1e-6);
      assert(Math.abs(am.roughness - bm.roughness) < 1e-6);
    }
    globalMax = Math.max(globalMax, max);
    checks.push({
      clipName,
      time,
      meshes: meshMaps[0].size,
      maxBidirectionalVertexDeviation: max,
    });
  }
}
console.log("NORMAL_WORST", normalWorst);
assert(
  normalAngleMax < 0.015,
  `World normal angular error ${normalAngleMax} exceeds .015rad`,
);
const report = {
  modelVersion: 24,
  passed: true,
  sourceBlend: "assets/blender/xp4.blend",
  sourceBlendSha256: sha(fs.readFileSync("assets/blender/xp4.blend")),
  currentSource: paths[0],
  currentSourceSha256: sha(bytes[0]),
  currentSourceBytes: bytes[0].length,
  acceptedRuntime: paths[1],
  acceptedRuntimeSha256: sha(bytes[1]),
  acceptedRuntimeBytes: bytes[1].length,
  reexportSha256: sha(bytes[2]),
  reexportByteIdentical: true,
  meshes: meshMaps[0].size,
  maxBidirectionalVertexDeviation: globalMax,
  positionTolerance: cell,
  maxWorldNormalAngularErrorRadians: normalAngleMax,
  normalAngleToleranceRadians: 0.015,
  normalMatchPositionTolerance: 0.0001,
  materialDifferences: [],
  checks,
  limitations:
    "两个实际动作共18个采样；对照源与运行时双向世界顶点、近邻顶点法线及PBR材质，另检查重新导出字节一致。不替代连续干涉证明、浏览器检查或硬件性能测试。",
};
fs.writeFileSync(
  process.env.TRANSWING_COMPARE_REPORT ??
    "qa/current/author/source-runtime-geometry.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
