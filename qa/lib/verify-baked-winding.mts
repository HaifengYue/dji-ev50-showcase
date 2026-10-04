/** Resolve every exported drive-key interval and total winding; quaternion endpoint equivalence alone cannot detect lost turns. */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig } from "../../src/rig.ts";
import {
  contract,
  makeDriveAssertion,
  contractPath,
} from "./drive-contract.mts";
const sources = process.env.QA_MODEL
  ? [process.env.QA_MODEL]
  : ["assets/blender/xp4-source.glb", "public/models/xp4.glb"];
const reports: any[] = [];
for (const source of sources) {
  const b = fs.readFileSync(source),
    g = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "",
      );
  const rig = createModelRig(g.scene),
    d = makeDriveAssertion(rig),
    clip = g.animations.find((c) => c.name === "TRANSWING_Hover_Cruise_Hover")!;
  assert(clip);
  const sliderTrack = clip.tracks.find(
    (t) => t.name === contract.slider + ".position",
  )!;
  assert(sliderTrack);
  const si = sliderTrack.createInterpolant(new Float64Array(3));
  const slider = (t: number) =>
    new T.Vector3(...Array.from(si.evaluate(t))).dot(
      new T.Vector3(...contract.sliderAxis).normalize(),
    );
  const rows = [];
  let maximumKeyPhaseError = 0,
    maximumMidpointPhaseError = 0,
    maximumResolvableExpectedStep = 0;
  for (const spec of contract.rotations) {
    const track = clip.tracks.find(
      (t) => t.name === spec.name + ".quaternion",
    )!;
    assert(track);
    const qi = track.createInterpolant(new Float64Array(4)),
      axis = new T.Vector3(...spec.localAxis).normalize(),
      rest = d.node(spec.name).quaternion.clone().normalize(),
      restSlider = d.slider.position.dot(d.axis);
    const times = Array.from(track.times),
      at = (t: number) =>
        new T.Quaternion(...Array.from(qi.evaluate(t))).normalize();
    assert(
      times.length > 797,
      "Long travel must have more than old quarter-frame samples: " + spec.name,
    );
    const phase = (t: number) =>
      ((slider(t) - restSlider) / contract.lead) * 2 * Math.PI * spec.ratio;
    let accumulated = 0,
      pathLength = 0,
      maxStep = 0,
      maxIncrementError = 0,
      maxAccumulationError = 0,
      maxKeyQerror = 0,
      maxMidQerror = 0;
    const segments: any[] = [],
      checkpoints = [0, 79 / 24, 119 / 24, 199 / 24];
    let segmentStartTime = times[0],
      segmentStartAccum = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i],
        q = at(t),
        want = rest
          .clone()
          .multiply(new T.Quaternion().setFromAxisAngle(axis, phase(t)))
          .normalize(),
        qe = 1 - Math.abs(q.dot(want));
      maxKeyQerror = Math.max(maxKeyQerror, qe);
      assert(qe < 1e-10, `${spec.name} key phase qerror ${qe} at ${t}`);
      if (!i) continue;
      const t0 = times[i - 1],
        q0 = at(t0),
        delta = q0.clone().invert().multiply(q);
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const actual =
          2 *
          Math.atan2(
            new T.Vector3(delta.x, delta.y, delta.z).dot(axis),
            delta.w,
          ),
        expected = phase(t) - phase(t0);
      // Demand independent slider-derived expected step below pi/2, not merely wrapped measured angle.
      assert(
        Math.abs(expected) < Math.PI / 2,
        `${spec.name} undersampled ${expected} rad; shortest quaternion arc loses winding`,
      );
      maximumResolvableExpectedStep = Math.max(
        maximumResolvableExpectedStep,
        Math.abs(expected),
      );
      maxStep = Math.max(maxStep, Math.abs(actual));
      const incError = Math.abs(actual - expected);
      maxIncrementError = Math.max(maxIncrementError, incError);
      assert(
        incError < 6e-5,
        `${spec.name} key increment differs: ${incError}`,
      );
      accumulated += actual;
      pathLength += Math.abs(actual);
      const accError = Math.abs(accumulated - (phase(t) - phase(times[0])));
      maxAccumulationError = Math.max(maxAccumulationError, accError);
      assert(
        accError < 6e-5,
        `${spec.name} accumulated winding differs: ${accError}`,
      );
      for (const fraction of [1 / 3, 1 / 2, 2 / 3]) {
        const mid = t0 + (t - t0) * fraction,
          mq = at(mid),
          mw = rest
            .clone()
            .multiply(new T.Quaternion().setFromAxisAngle(axis, phase(mid)))
            .normalize(),
          me = 1 - Math.abs(mq.dot(mw));
        maxMidQerror = Math.max(maxMidQerror, me);
        assert(
          me < 1e-10,
          `${spec.name} fractional drive qerror ${me} at ${mid}`,
        );
      }
      for (const boundary of checkpoints.slice(1))
        if (Math.abs(t - boundary) < 1e-6) {
          segments.push({
            from: segmentStartTime,
            to: t,
            actualRadians: accumulated - segmentStartAccum,
            expectedRadians: phase(t) - phase(segmentStartTime),
            actualTurns: (accumulated - segmentStartAccum) / (2 * Math.PI),
          });
          segmentStartTime = t;
          segmentStartAccum = accumulated;
        }
    }
    // Explicit span endpoint interpolation verifies complete outstroke and return even if exact plateau boundary is absent in a sample grid.
    const extrema = [
        Math.min(...times.map(phase)),
        Math.max(...times.map(phase)),
      ],
      expectedPath = 2 * (extrema[1] - extrema[0]);
    assert(
      Math.abs(pathLength - expectedPath) < 2e-4,
      `${spec.name} total angular path loses turns`,
    );
    maximumKeyPhaseError = Math.max(maximumKeyPhaseError, maxKeyQerror);
    maximumMidpointPhaseError = Math.max(
      maximumMidpointPhaseError,
      maxMidQerror,
    );
    rows.push({
      name: spec.name,
      keyframes: times.length,
      fractionalChecks: (times.length - 1) * 3,
      maxKeyQerror,
      maxMidQerror,
      maximumActualStep: maxStep,
      maxIncrementError,
      maxAccumulationError,
      finalAccumulatedRadians: accumulated,
      absoluteAngularPathRadians: pathLength,
      expectedAbsoluteAngularPathRadians: expectedPath,
      completeOutstrokeTurns: (extrema[1] - extrema[0]) / (2 * Math.PI),
      segments,
    });
  }
  const motorClip = g.animations.find(
    (c) => c.name === "TRANSWING_Motors_Start_Stop",
  );
  assert(motorClip);
  const secondarySlider = motorClip.tracks.find(
    (t) => t.name === contract.slider + ".position",
  );
  assert(secondarySlider);
  const secondarySliderI = secondarySlider.createInterpolant(
      new Float64Array(3),
    ),
    secondaryRows = [];
  for (const spec of contract.rotations) {
    const track = motorClip.tracks.find(
      (t) => t.name === spec.name + ".quaternion",
    );
    assert(track);
    const qi = track.createInterpolant(new Float64Array(4)),
      axis = new T.Vector3(...spec.localAxis).normalize(),
      rest = d.node(spec.name).quaternion.clone().normalize(),
      restSlider = d.slider.position.dot(d.axis),
      times = Array.from(track.times),
      samples = [
        ...times,
        ...times
          .slice(1)
          .flatMap((t, i) =>
            [1 / 3, 1 / 2, 2 / 3].map((f) => times[i] + (t - times[i]) * f),
          ),
      ];
    let maximum = 0;
    for (const t of samples) {
      const travel =
          new T.Vector3(...Array.from(secondarySliderI.evaluate(t))).dot(
            d.axis,
          ) - restSlider,
        q = new T.Quaternion(...Array.from(qi.evaluate(t))).normalize(),
        expected = rest
          .clone()
          .multiply(
            new T.Quaternion().setFromAxisAngle(
              axis,
              (travel / contract.lead) * 2 * Math.PI * spec.ratio,
            ),
          )
          .normalize(),
        error = 1 - Math.abs(q.dot(expected));
      maximum = Math.max(maximum, error);
      assert(
        error < 1e-10,
        `Secondary motor demonstration must retain synchronized drive phase: ${spec.name}/${t}/${error}`,
      );
    }
    secondaryRows.push({
      name: spec.name,
      keyframes: times.length,
      totalPhaseChecks: samples.length,
      maximumQerror: maximum,
    });
  }
  reports.push({
    source,
    sha256: crypto.createHash("sha256").update(b).digest("hex"),
    lead: contract.lead,
    rows,
    maximumKeyPhaseError,
    maximumMidpointPhaseError,
    maximumResolvableExpectedStep,
    secondaryMotorClip: { name: motorClip.name, rows: secondaryRows },
    passed: true,
  });
}
const report = {
  passed: true,
  contractPath,
  reports,
  quaternionErrorDefinition:
    "1 - abs(dot(normalized actual quaternion, normalized expected quaternion))",
  maximumQuaternionError: 1e-10,
  limitations: [
    "All actual drive keys and one-third, midpoint and two-third interval samples measured against actual Float32 slider interpolation; independent expected angular steps must resolve winding before quaternion unwrapping",
    "Full absolute angular path and cumulative error prevent net-zero closed-cycle totals masking a lost outstroke/return turn",
    "Finite exported intervals remain numerical visualization evidence, not actuator load or speed feasibility",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/baked-winding-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
