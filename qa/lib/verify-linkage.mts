/** Independent V22 linkage geometry audit; real GLB nodes and production absolute solver. */
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
  solveSpreaderZ,
} from "../../src/rig.ts";
import { MOTOR_IDS, newMotorStates } from "../../src/motors.ts";
const out = process.env.QA_OUT ?? "qa/current/results/linkage-report.json";
const sources = ["public/models/xp4.glb", "assets/blender/xp4-source.glb"];
const reports: any[] = [],
  snapshots: any[] = [];
for (const source of sources) {
  const bytes = fs.readFileSync(source),
    g = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
  const rig = createModelRig(g.scene),
    rows: any[] = [],
    ranges: any = {};
  let maxLengthError = 0,
    maxEndpointError = 0,
    maxSymmetryError = 0,
    maxMotorEffect = 0,
    maxRevisitError = 0;
  const wp = (name: string) =>
    g.scene.getObjectByName(name)!.getWorldPosition(new T.Vector3());
  const sideAxes: any = {};
  for (const side of ["L", "R"]) sideAxes[side] = [];
  for (let i = 0; i <= 1000; i++) {
    const u = i / 1000;
    applyModelPose(rig, u);
    const state: any = {
      unfold: u,
      slider: rig.spreader!.object.position.toArray(),
      sides: {},
    };
    for (const b of rig.braces) {
      const body = wp("BraceBody_" + b.side),
        wing = wp("BraceWing_" + b.side),
        length = body.distanceTo(wing),
        direction = wing.clone().sub(body).normalize();
      const localAxis = new T.Vector3(0, 0, 1).transformDirection(
        b.rod.matrixWorld,
      );
      const wingPinAxis = new T.Vector3(0, 1, 0).transformDirection(
        b.wing.matrixWorld,
      );
      const bodyPin = g.scene.getObjectByName(
          "BraceBallPin_" + b.side + "_Body",
        )!,
        bodyPinAxis = new T.Vector3(0, 1, 0).transformDirection(
          bodyPin.matrixWorld,
        );
      const start = b.rod.localToWorld(new T.Vector3()),
        end = b.rod.localToWorld(new T.Vector3(0, b.length, 0));
      maxLengthError = Math.max(maxLengthError, Math.abs(length - b.length));
      maxEndpointError = Math.max(
        maxEndpointError,
        start.distanceTo(body),
        end.distanceTo(wing),
      );
      assert.deepEqual(b.rod.scale.toArray(), [1, 1, 1]);
      sideAxes[b.side].push(direction.toArray());
      state.sides[b.side] = {
        body: body.toArray(),
        wing: wing.toArray(),
        rodLength: b.length,
        direction: direction.toArray(),
        eyeNormal: localAxis.toArray(),
        bodyPinAxis: bodyPinAxis.toArray(),
        wingPinAxis: wingPinAxis.toArray(),
        bodyEyeMisalignmentDeg:
          (Math.acos(Math.min(1, Math.abs(localAxis.dot(bodyPinAxis)))) * 180) /
          Math.PI,
        wingEyeMisalignmentDeg:
          (Math.acos(Math.min(1, Math.abs(localAxis.dot(wingPinAxis)))) * 180) /
          Math.PI,
      };
    }
    maxSymmetryError = Math.max(
      maxSymmetryError,
      ...[0, 1, 2].map((k) =>
        Math.abs(
          state.sides.L.body[k] - (k === 0 ? -1 : 1) * state.sides.R.body[k],
        ),
      ),
      ...["body", "wing"].flatMap((key) =>
        [0, 1, 2].map((k) =>
          Math.abs(
            state.sides.L[key][k] - (k === 0 ? -1 : 1) * state.sides.R[key][k],
          ),
        ),
      ),
    );
    if ([0, 250, 500, 750, 1000].includes(i)) {
      const before = rig.braces.map((b) => [
        ...wp("BraceBody_" + b.side).toArray(),
        ...wp("BraceWing_" + b.side).toArray(),
      ]);
      for (const fold of [0, 0.5, 1]) {
        const motors = newMotorStates();
        for (const [idIndex, id] of MOTOR_IDS.entries())
          motors[id] = {
            rpm: fold === 0 ? 1800 : 0,
            phase: fold === 0 ? 0.37 * (idIndex + 1) : 0,
            fold,
            stage: fold ? "folding" : "running",
            requested: fold === 0,
          };
        applyMotorPose(rig, motors);
        for (const [j, b] of rig.braces.entries()) {
          const after = [
            ...wp("BraceBody_" + b.side).toArray(),
            ...wp("BraceWing_" + b.side).toArray(),
          ];
          maxMotorEffect = Math.max(
            maxMotorEffect,
            ...after.map((v, k) => Math.abs(v - before[j][k])),
          );
        }
      }
    }
    rows.push(state);
  }
  for (const i of [1000, 0, 750, 125, 500, 0, 1000]) {
    applyModelPose(rig, i / 1000);
    for (const b of rig.braces) {
      const expected = rows[i].sides[b.side];
      maxRevisitError = Math.max(
        maxRevisitError,
        wp("BraceBody_" + b.side).distanceTo(new T.Vector3(...expected.body)),
        wp("BraceWing_" + b.side).distanceTo(new T.Vector3(...expected.wing)),
      );
    }
  }
  console.log({
    source,
    maxLengthError,
    maxEndpointError,
    maxSymmetryError,
    maxMotorEffect,
    maxRevisitError,
  });
  assert(
    maxLengthError < 1e-6 &&
      maxEndpointError < 1e-6 &&
      maxSymmetryError < 1e-6 &&
      maxMotorEffect < 1e-9 &&
      maxRevisitError < 1e-9,
  );
  for (const side of ["L", "R"]) {
    const ss = rows.map((r) => r.sides[side]);
    const axes = sideAxes[side].map((a: any) => new T.Vector3(...a));
    let maxSwing = 0;
    for (const a of axes)
      for (const b of axes)
        maxSwing = Math.max(maxSwing, (a.angleTo(b) * 180) / Math.PI);
    ranges[side] = {
      length: ss[0].rodLength,
      rodDirectionAngularRangeDeg: maxSwing,
      bodyEyeMisalignmentDeg: [
        Math.min(...ss.map((s) => s.bodyEyeMisalignmentDeg)),
        Math.max(...ss.map((s) => s.bodyEyeMisalignmentDeg)),
      ],
      wingEyeMisalignmentDeg: [
        Math.min(...ss.map((s) => s.wingEyeMisalignmentDeg)),
        Math.max(...ss.map((s) => s.wingEyeMisalignmentDeg)),
      ],
      wingAnchorBox: [0, 1, 2].map((k) => [
        Math.min(...ss.map((s) => s.wing[k])),
        Math.max(...ss.map((s) => s.wing[k])),
      ]),
    };
  }
  let priorSlider = Infinity,
    maxBackwardStep = 0,
    minForwardStep = Infinity;
  for (let i = 0; i <= 10000; i++) {
    applyModelPose(rig, i / 10000);
    const z = rig.spreader!.object.position.z;
    if (i) {
      maxBackwardStep = Math.max(maxBackwardStep, z - priorSlider);
      minForwardStep = Math.min(minForwardStep, priorSlider - z);
    }
    priorSlider = z;
  }
  if (!process.env.QA_BASELINE_ONLY)
    assert(
      maxBackwardStep <= 1e-10,
      "Common linear stroke reverses near conversion endpoint",
    );
  const names: string[] = [];
  g.scene.traverse((o) => {
    if ((o as T.Mesh).isMesh && /^(Brace|Actuator)/.test(o.name))
      names.push(o.name);
  });
  reports.push({
    source,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sampleCount: rows.length,
    strokeMonotonicSamples: 10001,
    maxBackwardStep,
    minForwardStep,
    maxLengthError,
    maxEndpointError,
    maxSymmetryError,
    maxMotorEffect,
    maxRevisitError,
    sliderRange: [
      Math.min(...rows.map((r) => r.slider[2])),
      Math.max(...rows.map((r) => r.slider[2])),
    ],
    ranges,
    linkageMeshes: names,
    selectedStates: rows.filter((_, i) => [0, 250, 500, 750, 1000].includes(i)),
  });
  snapshots.push(rows);
}
const comparisons: any[] = [];
if (reports.length > 1) {
  for (const [a, b] of [
    [0, 1],
  ]) {
    let maxAnchorDeviation = 0,
      maxRodLengthDeviation = 0;
    for (let i = 0; i <= 1000; i++)
      for (const side of ["L", "R"]) {
        for (const key of ["body", "wing"])
          maxAnchorDeviation = Math.max(
            maxAnchorDeviation,
            new T.Vector3(...snapshots[a][i].sides[side][key]).distanceTo(
              new T.Vector3(...snapshots[b][i].sides[side][key]),
            ),
          );
        maxRodLengthDeviation = Math.max(
          maxRodLengthDeviation,
          Math.abs(
            snapshots[a][i].sides[side].rodLength -
              snapshots[b][i].sides[side].rodLength,
          ),
        );
      }
    comparisons.push({
      a: reports[a].source,
      b: reports[b].source,
      maxAnchorDeviation,
      maxRodLengthDeviation,
    });
      assert(
        maxAnchorDeviation < 1e-6 && maxRodLengthDeviation < 1e-6,
        "Source/runtime anchor trajectory differs",
      );
  }
}
assert.throws(() => solveSpreaderZ(new T.Vector3(2, 0, 0), new T.Vector3(), 1));
const report = {
  passed: true,
  reports,
  comparisons,
  impossibleFixedLengthRejected: true,
  limitations: [
    "1001 actual poses, fixed-length rods and common-slider closure; not manufacturing/strength certification",
    "Established production 1e-6 rod-end closure/left-right threshold preserved (baseline Float32 asymmetry already 3.34e-7); collision SAT remains separately 1e-9",
    "All rod-end spheres still require articulation because off-axis wing anchor changes both position and rod direction",
    "No real browser/mobile/device testing; native solver and assets only",
  ],
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
