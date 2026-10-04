/** Independent source/runtime local linkage vertex and animation comparison. */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig, applyModelPose } from "../../src/rig.ts";
const paths = ["assets/blender/xp4-source.glb", "public/models/xp4.glb"];
const models = await Promise.all(
  paths.map(async (source) => {
    const b = fs.readFileSync(source),
      g = await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          "",
        );
    return {
      source,
      sha256: crypto.createHash("sha256").update(b).digest("hex"),
      g,
      rig: createModelRig(g.scene),
    };
  }),
);
const driveRestNames = [
  "Drive_ScrewRotor",
  "Drive_MotorRotor",
  "Drive_PlanetRotor_0",
  "Drive_PlanetRotor_1",
  "Drive_PlanetRotor_2",
];
const driveRestTransforms = driveRestNames.map((name) => {
  const [a, b] = models.map((m) => m.g.scene.getObjectByName(name)!);
  for (const key of ["position", "quaternion", "scale"] as const)
    assert.deepEqual(
      a[key].toArray(),
      b[key].toArray(),
      `${name} static ${key} lost exact source values in compression`,
    );
  return {
    name,
    sourceQuaternion: a.quaternion.toArray(),
    runtimeQuaternion: b.quaternion.toArray(),
    exact: true,
  };
});
const keys = (m: any) => {
  const names: string[] = [];
  m.g.scene.traverse((o: any) => {
    if (
      o.isMesh &&
      /^(Drive_|Brace|ActuatorSideSlot|Blade_hinge_(pin|arm)|ControlHinge|ControlFlexure|ControlHorn|CargoHinge|CargoLatch|Dorsal_antenna|Landing_wear_tip|Pod_wing_saddle|RootBearingHousing|RootFairing)/.test(
        o.name,
      )
    )
      names.push(o.name);
  });
  return names.sort();
};
const names = keys(models[0]);
assert.deepEqual(names, keys(models[1]));
assert(
  names.some((n) => n.startsWith("Drive_")),
  "Missing V22 geometry",
);
function points(mesh: T.Mesh) {
  const pos = mesh.geometry.getAttribute("position");
  return Array.from({ length: pos.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld),
  );
}
const cell = 0.0003;
function nearest(a: T.Vector3[], b: T.Vector3[]) {
  const buckets = new Map<string, T.Vector3[]>(),
    key = (q: number[]) => q.join(",");
  for (const p of b) {
    const k = key(p.toArray().map((v) => Math.floor(v / cell)));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(p);
  }
  let max = 0;
  for (const p of a) {
    const q = p.toArray().map((v) => Math.floor(v / cell));
    let best = Infinity;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const v of buckets.get(key([q[0] + i, q[1] + j, q[2] + k])) ??
            [])
            best = Math.min(best, p.distanceTo(v));
    assert(best < cell);
    max = Math.max(max, best);
  }
  return max;
}
const poses: any[] = [];
for (const u of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
  models.forEach((m) => applyModelPose(m.rig, u));
  const rows = [];
  for (const name of names) {
    const [a, b] = models.map((m) => m.g.scene.getObjectByName(name) as T.Mesh);
    assert.equal(a.parent?.name, b.parent?.name);
    const ma = a.material as any,
      mb = b.material as any;
    for (const key of ["metalness", "roughness", "opacity"])
      assert.equal(ma[key], mb[key]);
    assert.deepEqual(ma.color.toArray(), mb.color.toArray());
    const pa = points(a),
      pb = points(b);
    rows.push({
      name,
      maxBidirectionalWorldVertexError: Math.max(
        nearest(pa, pb),
        nearest(pb, pa),
      ),
    });
  }
  poses.push({
    unfold: u,
    meshes: rows,
    maxBidirectionalWorldVertexError: Math.max(
      ...rows.map((r) => r.maxBidirectionalWorldVertexError),
    ),
  });
}
const animationComparisons = [];
assert.deepEqual(
  models[0].g.animations.map((c) => c.name),
  models[1].g.animations.map((c) => c.name),
);
for (const c of models[0].g.animations) {
  const d = models[1].g.animations.find((a) => a.name === c.name)!;
  assert.deepEqual(
    c.tracks.map((t) => t.name),
    d.tracks.map((t) => t.name),
  );
  let maxError = 0;
  for (const t of c.tracks) {
    const s = d.tracks.find((r) => r.name === t.name)!;
    assert.deepEqual(Array.from(t.times), Array.from(s.times));
    assert.equal(t.values.length, s.values.length);
    for (let i = 0; i < t.values.length; i++)
      maxError = Math.max(maxError, Math.abs(t.values[i] - s.values[i]));
  }
  assert(maxError < 1e-6);
  animationComparisons.push({
    clip: c.name,
    tracks: c.tracks.length,
    maxSampleError: maxError,
  });
}
const report = {
  passed: true,
  sources: models.map((m) => ({ source: m.source, sha256: m.sha256 })),
  linkageMeshCount: names.length,
  driveRestTransforms,
  poses,
  maximumError: Math.max(
    ...poses.map((p) => p.maxBidirectionalWorldVertexError),
  ),
  positionTolerance: cell,
  animationComparisons,
  limitations: [
    "All actual internal drive and linkage meshes in 7 poses, exact parent/material contracts and both complete animation track sets",
    "0.0003 vertex-neighbor bound is preserved source-compression verification bound, not collision epsilon",
    "Whole-airframe source re-export parity checked separately by model generation verification",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/local-parity-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
