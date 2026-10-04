/** 显式局部范围：直槽、相邻贴壳装饰与低置驱动；主翼轨迹、轴心及杆球中心保持。 */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const paths = [
  "qa/v24/baseline/xp4-source-v23.glb",
  "assets/blender/xp4-source.glb",
];
const bytes = paths.map((p) => fs.readFileSync(p));
const models = await Promise.all(
  bytes.map((b) =>
    new GLTFLoader().parseAsync(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "",
    ),
  ),
);
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex"),
  num = (x) => Number(x.toFixed(8)).toString();
const maps = models.map((g) => {
  const m = new Map();
  g.scene.traverse((o) => m.set(o.name, o));
  return m;
});
const geometryAllowed =
  /^(Fuselage|ActuatorSideSlot_[LR]|Lower_fuselage_join(?:00[123])?|Tail_boom_join|Drive_.+|BraceBodyCarriage_[LR])$/;
const removed = /^NO_OLD_NODES_MAY_BE_REMOVED$/;
const added = /^NO_NEW_NODES_MAY_BE_ADDED$/;
const transformAllowed =
  /^(Drive_.+|BraceBodyCarriage_[LR])$/;
function signature(o) {
  const p = o.geometry.attributes.position,
    n = o.geometry.attributes.normal,
    ix =
      o.geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i),
    v = Array.from({ length: p.count }, (_, i) =>
      [p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)]
        .map(num)
        .join(","),
    );
  const tri = [];
  for (let i = 0; i < ix.length; i += 3) {
    const q = [v[ix[i]], v[ix[i + 1]], v[ix[i + 2]]];
    tri.push(
      [
        q.join("|"),
        [q[1], q[2], q[0]].join("|"),
        [q[2], q[0], q[1]].join("|"),
      ].sort()[0],
    );
  }
  return {
    corners: sha(v.sort().join("\n")),
    triangles: sha(tri.sort().join("\n")),
    triangleCount: tri.length,
  };
}
const untouched = [],
  changes = [],
  removedNodes = [],
  addedNodes = [],
  transformChanges = [],
  exportRoundoff = [],
  failures = [];
for (const [name, a] of maps[0]) {
  const b = maps[1].get(name);
  if (!b) {
    if (removed.test(name)) removedNodes.push(name);
    else failures.push({ name, reason: "undeclared missing node" });
    continue;
  }
  if (a.isMesh) {
    const before = signature(a),
      after = signature(b),
      equal = JSON.stringify(before) === JSON.stringify(after);
    (geometryAllowed.test(name) ? changes : untouched).push({
      name,
      equal,
      before,
      after,
    });
    if (!geometryAllowed.test(name) && !equal)
      failures.push({
        name,
        reason: "undeclared geometry/corner-normal change",
      });
    const mat = (o) => {
      const m = o.material;
      return {
        name: m.name,
        color: m.color.toArray(),
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: m.opacity,
        side: m.side,
      };
    };
    if (JSON.stringify(mat(a)) !== JSON.stringify(mat(b)))
      failures.push({ name, reason: "material changed" });
  }
  if (a.parent?.name !== b.parent?.name)
    failures.push({ name, reason: "parent changed" });
  a.updateMatrix();
  b.updateMatrix();
  if (
    a.matrix.elements.some((v, i) => Math.abs(v - b.matrix.elements[i]) > 1e-9)
  ) {
    transformChanges.push(name);
    if (!transformAllowed.test(name)) {
      failures.push({ name, reason: "undeclared local transform change" });
    }
  }
}
for (const [name] of maps[1])
  if (!maps[0].has(name)) {
    if (added.test(name)) addedNodes.push(name);
    else failures.push({ name, reason: "undeclared new node" });
  }
const movingTracks =
  /^NO_ANIMATION_TRACKS_MAY_CHANGE\./;
const aa = models.map((m) =>
  m.animations.map((c) => ({
    name: c.name,
    duration: c.duration,
    tracks: c.tracks
      .filter((t) => !movingTracks.test(t.name))
      .map((t) => ({
        name: t.name,
        times: Array.from(t.times),
        values: Array.from(t.values),
      })),
  })),
);
if (JSON.stringify(aa[0]) !== JSON.stringify(aa[1]))
  failures.push({ reason: "unrelated animation track data changed" });
const report = {
  modelVersion: 24,
  passed: !failures.length,
  sourceSha256: sha(bytes[1]),
  baselineSha256: sha(bytes[0]),
  unchangedGeometryAndCornerNormals: untouched,
  declaredGeometryChanges: changes,
  removedNodes,
  addedNodes,
  declaredTransformChanges: transformChanges,
  exportMatrixRoundoff: exportRoundoff,
  numericalSideEffects: [],
  unrelatedAnimationTrackDataEqual:
    JSON.stringify(aa[0]) === JSON.stringify(aa[1]),
  failures,
  note: "按用户新图允许低置Drive总成与两侧单直件，以及既定5个直槽网格变化；其余网格、全部材质/父级及原球心/翼轨迹/动作严格保持。驱动和直件只允许已声明的局部静态变换；不豁免实体或碰撞检查",
};
fs.writeFileSync(
  "qa/current/author/preservation.json",
  JSON.stringify(report, null, 2),
);
console.log({
  passed: report.passed,
  untouched: untouched.length,
  changes: changes.length,
  removedNodes,
  addedNodes,
  failures,
});
assert.ok(report.passed);
