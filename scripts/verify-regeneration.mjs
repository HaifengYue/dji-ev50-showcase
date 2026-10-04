/** 比较全新目录重建与冻结源GLB的几何、法线、有向拓扑及动画。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const rebuilt = process.argv[2];
assert(rebuilt, "Pass the independently regenerated uncompressed GLB path");
const files = ["assets/blender/xp4-source.glb", rebuilt],
  bytes = files.map((p) => fs.readFileSync(p));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const gs = await Promise.all(
  bytes.map((b) =>
    new GLTFLoader().parseAsync(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "",
    ),
  ),
);
const maps = gs.map((g) => {
  g.scene.updateMatrixWorld(true);
  const m = new Map();
  g.scene.traverse((o) => {
    if (o.isMesh) m.set(o.name, o);
  });
  return m;
});
assert.deepEqual([...maps[0].keys()].sort(), [...maps[1].keys()].sort());
const f = (v) => Number(v.toFixed(8)).toString();
function signatures(o) {
  const p = o.geometry.attributes.position,
    n = o.geometry.attributes.normal,
    ix =
      o.geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i);
  const verts = Array.from({ length: p.count }, (_, i) =>
    [
      ...new T.Vector3().fromBufferAttribute(p, i).toArray(),
      ...new T.Vector3().fromBufferAttribute(n, i).toArray(),
    ]
      .map(f)
      .join(","),
  );
  const triangles = [];
  for (let i = 0; i < ix.length; i += 3) {
    const t = [verts[ix[i]], verts[ix[i + 1]], verts[ix[i + 2]]];
    triangles.push(
      [
        t.join("|"),
        [t[1], t[2], t[0]].join("|"),
        [t[2], t[0], t[1]].join("|"),
      ].sort()[0],
    );
  }
  return {
    vertices: hash(verts.sort().join("\n")),
    triangles: hash(triangles.sort().join("\n")),
    count: triangles.length,
  };
}
let triangles = 0;
for (const [name, a] of maps[0]) {
  const b = maps[1].get(name);
  assert.deepEqual(
    a.matrixWorld.elements,
    b.matrixWorld.elements,
    `Transform mismatch ${name}`,
  );
  const sa = signatures(a),
    sb = signatures(b);
  assert.deepEqual(
    sa,
    sb,
    `Position, normal or oriented topology mismatch ${name}`,
  );
  triangles += sa.count;
}
const animations = gs.map((g) =>
  g.animations.map((a) => ({
    name: a.name,
    duration: a.duration,
    tracks: a.tracks
      .map((t) => ({
        name: t.name,
        type: t.ValueTypeName,
        times: Array.from(t.times),
        values: Array.from(t.values),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })),
);
assert.deepEqual(animations[0], animations[1], "Animation track data differs");
const generatorFiles = [
  "generate_transwing.py",
  "wing_seam.py",
  "output_slot_profile.py",
  "preserved_surfaces.py",
  "slot_topology.py",
  "drive_layout.py",
  "data/preserved-front-surfaces.blend",
  "data/preserved-front-surfaces.json",
  "airframe_accessories.py",
  "airframe_refinements.py",
  "wing_surfaces.py",
  "central_wing_attachment.py",
  "embedded_joint_surfaces.py",
  "propeller_shape.py",
  "rotor_handedness.py",
  "linkage_geometry.py",
  "internal_drive.py",
  "output_slot_geometry.py",
  "joint_fairings.py",
  "surface_finish.py",
  "data/red-target-mapping.json",
  "data/red-target-footprint.json",
  "joint_endcaps.py",
  "hinge_supports.py",
  "control_supports.py",
  "surface_supports.py",
  "kinematics.py",
  "export-transition.py",
  "compress-model.mjs",
  "data/fixed-root-paint-encoding.json",
];
const regeneratedRoot = path.resolve(path.dirname(rebuilt), "../..");
const generatorHashes = generatorFiles.map((file) => {
  const current = fs.readFileSync(path.join("scripts", file)),
    rebuiltScript = fs.readFileSync(
      path.join(regeneratedRoot, "scripts", file),
    );
  assert(current.equals(rebuiltScript), `重建脚本与交付脚本不一致：${file}`);
  return { file, sha256: hash(current), rebuiltScriptIdentical: true };
});
const report = {
  passed: true,
  modelVersion: 24,
  regeneratedSourcePath: rebuilt,
  generatorHashes,
  sourceSha256: hash(bytes[0]),
  regeneratedSha256: hash(bytes[1]),
  sourceBytes: bytes[0].length,
  regeneratedBytes: bytes[1].length,
  byteIdentical: bytes[0].equals(bytes[1]),
  meshes: maps[0].size,
  renderedTriangles: triangles,
  meshTransformsEqual: true,
  vertexAndNormalMultisetsEqualAtDecimalPlaces: 8,
  orientedTriangleMultisetsEqual: true,
  animationTrackDataEqual: true,
  notes:
    "全新目录程序化重建；跨进程GLB包装及去重顺序可变化。逐命名网格的变换、顶点法线集合、有向三角拓扑和动作轨道必须相同。保存的Blender重新导出另行要求字节一致。",
};
fs.writeFileSync(
  "qa/current/author/generator-reproducibility.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
