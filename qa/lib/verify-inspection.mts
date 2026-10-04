/** Real GLB inspection hide/restore lifecycle. Deliberately not a browser click test. */
import assert from "node:assert/strict";
import {acceptedReference, verifyOriginalCode} from "../current/reference-records.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  createModelRig,
  applyModelPose,
  applyMotorPose,
} from "../../src/rig.ts";
import { newMotorStates } from "../../src/motors.ts";
import {
  createInternalDriveInspection,
  INTERNAL_DRIVE_SHELL_NAMES,
} from "../../src/internalDriveInspection.ts";
// 用明确的已验收源码指纹核对当前实现；下方80轮真实对象生命周期检查保持。
const inspectionReference = acceptedReference().data.codeFingerprints.find(
  (row: any) => row.originalPath === "src/internalDriveInspection.ts",
);
assert(inspectionReference, "精简参照缺少内部观察层源码指纹");
const inspectionCode = verifyOriginalCode(
  "src/internalDriveInspection.ts",
  inspectionReference.sha256,
);
const b = fs.readFileSync("public/models/xp4.glb"),
  g = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
const rig = createModelRig(g.scene);
const nodes: T.Object3D[] = [];
g.scene.traverse((o) => nodes.push(o));
assert(
  nodes.some((n) => n.name === "Drive_Crossbeam"),
  "Final V22 geometry required",
);
const targets = new Set<string>(INTERNAL_DRIVE_SHELL_NAMES);
assert.equal(targets.size, 16, "Reviewed view-only shell/decoration set");
assert(
  ![...targets].some(
    (n) =>
      /^(Brace|Root|Composite_wing|V_tail|Drive_)/.test(n) &&
      n !== "Drive_ReductionHousing",
  ),
  "Never hide mechanical parts to conceal contact",
);
for (const name of targets)
  assert(
    g.scene.getObjectByName(name),
    `Final inspection target missing: ${name}`,
  );
for (const name of JSON.parse(
  fs.readFileSync("qa/contracts/model-refinement.json", "utf8"),
).geometryChanges)
  assert.equal(
    g.scene.getObjectByName(name)?.visible,
    true,
    `${name} must be visible before inspection; geometry fixes cannot be hidden`,
  );
const snapshot = () =>
  nodes.map((o: any) => ({
    object: o,
    name: o.name,
    visible: o.visible,
    material: o.material,
    geometry: o.geometry,
    position: o.position.toArray(),
    quaternion: o.quaternion.toArray(),
    scale: o.scale.toArray(),
    castShadow: o.castShadow,
    receiveShadow: o.receiveShadow,
    renderOrder: o.renderOrder,
  }));
const compare = (before: ReturnType<typeof snapshot>, active = false) => {
  const after = snapshot();
  for (let i = 0; i < before.length; i++) {
    const a = after[i],
      z = before[i];
    assert.strictEqual(a.object, z.object);
    assert.strictEqual(a.material, z.material);
    assert.strictEqual(a.geometry, z.geometry);
    for (const k of [
      "position",
      "quaternion",
      "scale",
      "castShadow",
      "receiveShadow",
      "renderOrder",
    ] as const)
      assert.deepEqual(a[k], z[k], `${z.name}.${k}`);
    assert.equal(
      a.visible,
      active && targets.has(z.name) ? false : z.visible,
      `${z.name}.visible`,
    );
  }
  assert.equal(nodes.length, before.length);
};
const layer = createInternalDriveInspection(g.scene),
  rows = [];
for (let cycle = 0; cycle < 80; cycle++) {
  const u = [0, 0.125, 0.5, 0.875, 1, 0.25][cycle % 6];
  applyModelPose(rig, u, cycle % 7 === 0);
  applyMotorPose(rig, newMotorStates());
  // Pre-existing hidden shell/slot must be retained, never forcibly shown by close.
  for (const name of targets)
    g.scene.getObjectByName(name)!.visible = cycle % 9 !== 0;
  const before = snapshot();
  layer.setActive(true);
  compare(before, true);
  layer.setActive(true);
  compare(before, true);
  layer.setActive(false);
  compare(before);
  layer.setActive(false);
  compare(before);
  rows.push({ cycle, unfold: u, exploded: cycle % 7 === 0, restored: true });
}
const before = snapshot();
layer.setActive(true);
layer.dispose();
compare(before);
layer.dispose();
compare(before);
const report = {
  passed: true,
  runtimeSha256: crypto.createHash("sha256").update(b).digest("hex"),
  cycles: rows,
  acceptedInspectionCode: inspectionCode,
  objectCount: nodes.length,
  onlyHiddenNames: [...targets],
  materialAndGeometryIdentityPreserved: true,
  positionQuaternionScalePreserved: true,
  preexistingVisibilityRestored: true,
  disposeWhileActiveRestored: true,
  limitations: [
    "Actual GLB/production Three.js lifecycle, repeat enter/leave and interrupted disposal; no WebGL/browser/React event dispatch or UI clicks",
    "App mode routing and Python view ownership verified separately in source unit tests; these checks do not represent a browser end-to-end test",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/inspection-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
