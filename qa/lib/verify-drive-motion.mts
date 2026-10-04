/** Actual runtime/source chain plus exported portable animation, independently deriving screw angles from slider travel. */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
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
  contract,
  contractPath,
  makeDriveAssertion,
} from "./drive-contract.mts";
const load = async (source: string) => {
  const b = fs.readFileSync(source),
    g = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "",
      );
  return {
    g,
    rig: createModelRig(g.scene),
    sha256: crypto.createHash("sha256").update(b).digest("hex"),
  };
};
const reports = [];
for (const source of [
  process.env.QA_SOURCE ?? "assets/blender/xp4-source.glb",
  process.env.QA_MODEL ?? "public/models/xp4.glb",
]) {
  console.log("Drive audit source", source);
  const { g, rig, sha256 } = await load(source),
    d = makeDriveAssertion(rig),
    states: any[] = [],
    unwrapped = new Map<string, number>(),
    previous = new Map<string, T.Quaternion>();
  let maximumStepAngle = 0;
  for (let i = 0; i <= 1000; i++) {
    applyModelPose(rig, i / 1000);
    const row = d.check();
    for (const r of contract.rotations) {
      const q = d.node(r.name).quaternion.clone();
      if (previous.has(r.name)) {
        const delta = previous.get(r.name)!.clone().invert().multiply(q);
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const axis = new T.Vector3(...r.localAxis).normalize(),
          angle =
            2 *
            Math.atan2(
              new T.Vector3(delta.x, delta.y, delta.z).dot(axis),
              delta.w,
            );
        assert(
          Math.abs(angle) < Math.PI / 2,
          "Sample spacing must resolve angular winding",
        );
        maximumStepAngle = Math.max(maximumStepAngle, Math.abs(angle));
        unwrapped.set(r.name, (unwrapped.get(r.name) ?? 0) + angle);
      }
      previous.set(r.name, q);
    }
    states.push({ unfold: i / 1000, ...row });
  }
  const accumulated = contract.rotations.map((r: any) => {
    const expected =
        states.at(-1).rows.find((s: any) => s.name === r.name)
          .expectedUnwrappedRadians -
        states[0].rows.find((s: any) => s.name === r.name)
          .expectedUnwrappedRadians,
      actual = unwrapped.get(r.name)!;
    assert(
      Math.abs(actual - expected) < 1e-7,
      `${r.name} total winding differs`,
    );
    return {
      name: r.name,
      actual,
      expected,
      error: Math.abs(actual - expected),
    };
  });
  for (const u of [1, 0, 0.9, 0.125, 0.5, 0, 1, 0.5]) {
    applyModelPose(rig, u);
    d.check();
    const before = JSON.stringify(
      contract.rotations.map((r: any) => d.node(r.name).quaternion.toArray()),
    );
    applyMotorPose(rig, newMotorStates());
    d.check();
    assert.equal(
      JSON.stringify(
        contract.rotations.map((r: any) => d.node(r.name).quaternion.toArray()),
      ),
      before,
    );
  }
  const beam = d.node("Drive_Crossbeam"),
    savedPosition = beam.position.clone();
  beam.position.x += 0.02;
  assert.throws(() => d.check(), /local translation changed/);
  beam.position.copy(savedPosition);
  const screw = d.node("Drive_ScrewRotor"),
    savedQuaternion = screw.quaternion.clone();
  screw.rotateZ(0.03);
  assert.throws(() => d.check(), /angle disagrees/);
  screw.quaternion.copy(savedQuaternion);
  d.check();
  // The baked reference's expected wing progress is determined by its documented frame timeline.
  const other = await load(source),
    clip = other.g.animations.find(
      (c) => c.name === "TRANSWING_Hover_Cruise_Hover",
    )!;
  assert(clip);
  for (const r of contract.rotations)
    assert(
      clip.tracks.some((t) => t.name === `${r.name}.quaternion`),
      `Missing portable rotation track ${r.name}`,
    );
  const bakedAssert = makeDriveAssertion(other.rig);
  const mix = new T.AnimationMixer(other.g.scene),
    action = mix.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const parity = [];
  let maxPosition = 0,
    maxQuaternion = 0;
  const names = [
    contract.slider,
    ...contract.rotations.map((r: any) => r.name),
    ...contract.rigidNodes,
  ];
  for (let i = 0; i <= 796; i++) {
    const frame = i / 4,
      t = frame <= 79 ? frame / 79 : frame <= 119 ? 1 : (199 - frame) / 80,
      u = t * t * (3 - 2 * t);
    mix.setTime(frame / 24);
    other.g.scene.updateMatrixWorld(true);
    applyModelPose(rig, u);
    for (const name of names) {
      const a = d.node(name),
        b = other.g.scene.getObjectByName(name)!;
      const pe = a
          .getWorldPosition(new T.Vector3())
          .distanceTo(b.getWorldPosition(new T.Vector3())),
        qe =
          1 -
          Math.abs(
            a
              .getWorldQuaternion(new T.Quaternion())
              .dot(b.getWorldQuaternion(new T.Quaternion())),
          );
      maxPosition = Math.max(maxPosition, pe);
      maxQuaternion = Math.max(maxQuaternion, qe);
      assert(pe < 1e-5, `Baked/runtime position ${name}: ${pe}`);
      assert(qe < 1e-7, `Baked/runtime quaternion ${name}: ${qe}`);
    }
    if (i % 199 === 0) parity.push({ frame, unfold: u });
  }
  let maxBakedDriveError = 0;
  for (let i = 0; i <= 1592; i++) {
    mix.setTime(i / 8 / 24);
    other.g.scene.updateMatrixWorld(true);
    const state = bakedAssert.check();
    maxBakedDriveError = Math.max(
      maxBakedDriveError,
      ...state.rows.map((r) => r.qerror),
    );
  }
  reports.push({
    source,
    sha256,
    samples: 1001,
    disconnectedBeamFaultRejected: true,
    incorrectScrewAngleFaultRejected: true,
    maximumStepAngle,
    accumulated,
    selectedStates: states.filter((_, i) => i % 250 === 0),
    baked: {
      samples: 797,
      arbitrarySubframeDriveChecks: 1593,
      maxBakedDriveError,
      trackCount: clip.tracks.length,
      maxPosition,
      maxQuaternion,
      selectedStates: parity,
    },
    passed: true,
  });
}
const report = {
  passed: true,
  contractPath,
  contract,
  reports,
  limitations: [
    "1001 ordered poses resolve winding; non-sequential repeats and independent rotor reset check deterministic drive states",
    "797 actual exported quarter-frame states compare world transforms with runtime; 1593 eighth-frame states check baked slider/rotation synchronization, including between keyframes; no continuous collision claim",
    "Lead and ratios are concept visualization parameters, not production actuator selection, contact stress, torque or speed feasibility",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/drive-motion-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
