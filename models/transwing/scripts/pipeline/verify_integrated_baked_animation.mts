/** V27 candidate-only acceptance. No production transforms replace either baked clip. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as T from "../../../../threejs/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../../../threejs/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "../../../../threejs/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const STAGE = path.resolve(
  ROOT,
  process.env.TRANSWING_INTEGRATED_STAGE ??
    "build/model",
);
assert.ok(
  STAGE.startsWith(path.join(ROOT, "build") + path.sep),
  "V27 stage must remain in the candidate QA tree",
);
export const SIDES = ["L", "R"] as const;
export const IDS = ["L_Front", "L_Rear", "R_Front", "R_Rear"] as const;
export const DRIVE = [
  "Drive_ScrewRotor",
  "Drive_MotorRotor",
  "Drive_PlanetRotor_0",
  "Drive_PlanetRotor_1",
  "Drive_PlanetRotor_2",
];
export const sha = (bytes: Buffer) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export const qerror = (a: T.Quaternion, b: T.Quaternion) =>
  1 - Math.abs(a.clone().normalize().dot(b.clone().normalize()));
export const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
export const node = (scene: T.Object3D, name: string) => {
  const o = scene.getObjectByName(name);
  assert.ok(o, `Missing ${name}`);
  return o;
};
export const cv = (v: number[]) => new T.Vector3(v[0], v[2], -v[1]);
export async function loadCandidate(filename: string) {
  const file = path.join(STAGE, filename),
    bytes = fs.readFileSync(file);
  const model = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
  const mechanism = model.parser.json.extras?.annotatedMechanism;
  assert.equal(mechanism?.schema, "transwing.annotated-mechanism.final.v1");
  const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/data/current-model-contract.json'),'utf8'));
  assert.deepEqual(mechanism,contract.mechanism,'Persisted mechanism must match independently pinned current contract');
  assert.equal(mechanism.foldAngleDegrees, 120);
  assert.deepEqual(
    JSON.parse(model.scene.userData.annotatedMechanismJSON),
    mechanism,
  );
  return { file, sha256: sha(bytes), model, mechanism };
}
export function expectedMechanism(m: any, u: number, side: "L" | "R") {
  const sign = side === "R" ? 1 : -1,
    pivot = cv(m.actualRightPivot),
    anchor = cv(m.wingAnchorRightCruise),
    body = cv(m.bodyAnchorRightCruise);
  pivot.x *= sign;
  anchor.x *= sign;
  body.x *= sign;
  const axis = cv(m.rightAxisUnnormalized).normalize();
  axis.x *= sign;
  const quaternion = new T.Quaternion().setFromAxisAngle(
    axis,
    sign * T.MathUtils.degToRad(m.foldAngleDegrees) * (1 - u),
  );
  const wing = anchor.sub(pivot).applyQuaternion(quaternion).add(pivot);
  const radicand =
    m.rigidRodLength ** 2 - (wing.x - body.x) ** 2 - (wing.y - body.y) ** 2;
  assert.ok(radicand > 0, "Persisted V27 linkage has no real solution");
  body.z = wing.z - Math.sqrt(radicand);
  return { pivot, wing, body, axis, quaternion };
}
export function hierarchy(scene: T.Object3D) {
  const rows: any[] = [];
  const check = (name: string, parent: string) => {
    assert.equal(node(scene, name).parent?.name, parent, `${name} parent`);
    rows.push({ node: name, parent });
  };
  for (const side of SIDES) {
    for (const name of [
      "Composite_wing_",
      "WingLowerClosure_",
      "RootCarrierMoving_",
      "RootCarrierThrust_",
      "RootCarrierBridge_",
      "BraceWing_",
      "BraceWingSeat_",
    ])
      check(name + side, "WingPivot_" + side);
    check(`BraceBall_${side}_Wing`, "WingPivot_" + side);
    check(`BraceBall_${side}_Body`, "BraceSpreader");
    check("BraceBody_" + side, "BraceSpreader");
    for (const end of ["Body", "Root"])
      check(`BraceRodEye_${side}_${end}`, "BraceRod_" + side);
    for (const end of ["Front", "Rear"]) {
      for (const prefix of ["MotorAxisStart_", "MotorAxisEnd_", "Prop_"])
        check(prefix + side + "_" + end, "WingPivot_" + side);
      for (const leaf of ["A", "B"])
        check(`BladeFold_${side}_${end}_${leaf}`, `Prop_${side}_${end}`);
    }
    assert.equal(
      (node(scene, "WingLowerClosure_" + side) as T.Mesh).isMesh,
      undefined,
    );
  }
  for (const name of [
    "Drive_Crossbeam",
    "Drive_NutCarriage",
    "Drive_NutInternalThread",
    "Drive_GuideBushing_L",
    "Drive_GuideBushing_R",
    "Drive_OutputWeb",
  ])
    check(name, "BraceSpreader");
  check("Drive_LeadScrewThread", "Drive_ScrewRotor");
  for (let i = 0; i < 3; i++)
    check("Drive_PlanetRotor_" + i, "Drive_ScrewRotor");
  for (const name of [
    "Drive_ScrewRotor",
    "Drive_MotorRotor",
    "Drive_GuideRail_L",
    "Drive_GuideRail_R",
    "Drive_FrontTravelStop_L",
    "Drive_FrontTravelStop_R",
  ])
    assert.notEqual(node(scene, name).parent?.name, "BraceSpreader");
  return rows;
}
export function visibleJointAndAxisErrors(scene: T.Object3D) {
  let eye = 0,
    axis = 0;
  for (const side of SIDES)
    for (const [end, eyeEnd] of [
      ["Body", "Body"],
      ["Wing", "Root"],
    ]) {
      const a = new T.Box3()
        .setFromObject(node(scene, `BraceBall_${side}_${end}`))
        .getCenter(new T.Vector3());
      const b = new T.Box3()
        .setFromObject(node(scene, `BraceRodEye_${side}_${eyeEnd}`))
        .getCenter(new T.Vector3());
      eye = Math.max(eye, a.distanceTo(b));
    }
  for (const id of IDS) {
    const a = node(scene, "MotorAxisStart_" + id).getWorldPosition(
        new T.Vector3(),
      ),
      b = node(scene, "MotorAxisEnd_" + id).getWorldPosition(new T.Vector3()),
      hub = node(scene, "Prop_" + id).getWorldPosition(new T.Vector3());
    axis = Math.max(axis, hub.sub(a).cross(b.sub(a).normalize()).length());
  }
  return { eye, axis };
}
/** Actual mesh phases, not the historical sliderRestY extra or a receipt's claim. */
export function createThreadAudit(scene: T.Object3D) {
  scene.updateMatrixWorld(true);
  const rotor = node(scene, "Drive_ScrewRotor"),
    lead = rotor.userData.screwLead,
    k = (2 * Math.PI) / lead;
  const phase = (p: T.Vector3) => wrap(Math.atan2(p.x, p.y) + k * p.z);
  const bands = ["Drive_LeadScrewThread", "Drive_NutInternalThread"].map(
    (name) => {
      const owner = node(scene, name),
        inverse = rotor.matrixWorld.clone().invert(),
        points: T.Vector3[] = [],
        triangles: T.Vector3[][] = [],
        unique = new Map<string, T.Vector3>(),
        witnesses: { mesh: T.Mesh; local: T.Vector3; phase: number }[] = [];
      owner.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const attr = o.geometry.getAttribute("position"),
          matrix = inverse.clone().multiply(o.matrixWorld),
          local: T.Vector3[] = [];
        for (let i = 0; i < attr.count; i++) {
          const p = new T.Vector3().fromBufferAttribute(attr, i),
            world = p.clone().applyMatrix4(matrix);
          local.push(world);
          unique.set(world.toArray().join(","), world);
          if (i % Math.max(1, Math.floor(attr.count / 12)) === 0)
            witnesses.push({ mesh: o, local: p, phase: phase(world) });
        }
        const indices = o.geometry.index,
          n = indices?.count ?? attr.count;
        for (let i = 0; i < n; i += 3)
          triangles.push(
            [0, 1, 2].map((j) => local[indices ? indices.getX(i + j) : i + j]),
          );
      });
      points.push(...unique.values());
      assert.ok(points.length > 8);
      const phases = points.map(phase),
        center = Math.atan2(
          phases.reduce((s, p) => s + Math.sin(p), 0),
          phases.reduce((s, p) => s + Math.cos(p), 0),
        );
      let low = Infinity,
        high = -Infinity,
        minRadius = Infinity;
      for (const tri of triangles) {
        const raw = tri.map((p) => Math.atan2(p.x, p.y)),
          angles = raw.map((a) => raw[0] + wrap(a - raw[0])),
          span = Math.max(...angles) - Math.min(...angles);
        assert.ok(span < Math.PI);
        let lo = Math.min(...angles) + k * Math.min(...tri.map((p) => p.z)),
          hi = Math.max(...angles) + k * Math.max(...tri.map((p) => p.z));
        const shift =
          Math.round((center - (lo + hi) / 2) / (2 * Math.PI)) * 2 * Math.PI;
        lo += shift;
        hi += shift;
        low = Math.min(low, lo - center);
        high = Math.max(high, hi - center);
        minRadius = Math.min(
          minRadius,
          ...tri.map((p) => Math.hypot(p.x, p.y) * Math.cos(span / 2)),
        );
      }
      return {
        node: name,
        center,
        band: [low, high],
        minimumTriangleRadius: minRadius,
        uniqueVertices: points.length,
        triangles: triangles.length,
        witnesses,
      };
    },
  );
  const centerSeparation = Math.abs(wrap(bands[1].center - bands[0].center));
  const margin =
    centerSeparation -
    bands.reduce((s, b) => s + Math.max(...b.band.map(Math.abs)), 0);
  assert.ok(
    Math.abs(centerSeparation - Math.PI) < 5e-5,
    `New helix rest phase lost: separation ${centerSeparation}`,
  );
  assert.ok(margin > 0, "Male/female full triangle phase bands overlap");
  assert.ok(
    bands.every((b) => b.minimumTriangleRadius > 0),
    "Thread triangle angular cones must exclude the screw axis",
  );
  const check = () => {
    const inverse = rotor.matrixWorld.clone().invert();
    let error = 0;
    for (const b of bands)
      for (const w of b.witnesses) {
        const p = w.local
          .clone()
          .applyMatrix4(w.mesh.matrixWorld)
          .applyMatrix4(inverse);
        error = Math.max(error, Math.abs(wrap(phase(p) - w.phase)));
      }
    return error;
  };
  return {
    check,
    report: {
      method:
        "All loaded mesh triangles bounded in screw-frame atan2(x,y)+2*pi*z/lead; actual mesh witnesses track that phase during playback",
      lead,
      centerSeparation,
      restPhaseResidual: Math.abs(centerSeparation - Math.PI),
      conservativeMaterialBandGapRadians: margin,
      bands: bands.map(({ witnesses, ...b }) => ({
        ...b,
        phaseWitnesses: witnesses.length,
      })),
      scope:
        "Actual candidate GLB rest geometry and sampled playback only; no whole-aircraft collision, manufacturing or appearance acceptance",
    },
  };
}
function transitionU(frame: number) {
  const t =
    frame <= 79
      ? Math.max(0, Math.min(1, frame / 79))
      : frame <= 119
        ? 1
        : Math.max(0, Math.min(1, (199 - frame) / 80));
  return t * t * (3 - 2 * t);
}
function motorState(frame: number) {
  const ease = (x: number) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  };
  const fold =
    frame < 12
      ? 1
      : frame < 36
        ? 1 - ease((frame - 12) / 24)
        : frame < 132
          ? 0
          : frame < 156
            ? ease((frame - 132) / 24)
            : 1;
  let phase = 0;
  if (frame > 36 && frame < 60) {
    const x = (frame - 36) / 24;
    phase = 12 * (x ** 3 - 0.5 * x ** 4);
  } else if (frame >= 60 && frame < 96) phase = 6 + (12 * (frame - 60)) / 24;
  else if (frame >= 96 && frame < 120) {
    const x = (frame - 96) / 24;
    phase = 24 + 12 * (x - x ** 3 + 0.5 * x ** 4);
  } else if (frame >= 120 && frame < 132)
    phase = 30 + (10 * Math.PI - 30) * ease((frame - 120) / 12);
  else if (frame >= 132) phase = 10 * Math.PI;
  return { fold, phase };
}
// Frozen exporter authors quarter-frame knots and LINEAR quaternion channels.
// Independently regenerate the knot values, then interpolate their scalar angles.
// The live analytical ease curve is not the between-key glTF playback contract.
const motorTimes = Array.from({ length: 673 }, (_, i) => Math.fround(i / 96));
function serializedMotorState(time: number) {
  let lo = 0,
    hi = motorTimes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (motorTimes[mid] <= time) lo = mid;
    else hi = mid;
  }
  const t = T.MathUtils.clamp(
    (time - motorTimes[lo]) / (motorTimes[hi] - motorTimes[lo]),
    0,
    1,
  );
  const a = motorState(lo / 4),
    b = motorState(hi / 4);
  return {
    fold: T.MathUtils.lerp(a.fold, b.fold, t),
    phase: T.MathUtils.lerp(a.phase, b.phase, t),
  };
}

export async function verifyBakedAnimation() {
  const report: any = {
    schema: "transwing.v27-integrated-baked-animation.v1",
    revision: 27,
    passed: true,
    pipelineTrialOnly: true,
    browserPixelsTested: false,
    appearanceAccepted: false,
    jointMaterialAcceptanceImplied: false,
    thresholds: {
      visibleEyeBallDistance: 2e-5,
      propHubToRealAxisDistance: 2e-6,
      driveQuaternionError: 1e-10,
      threadPhaseDriftRadians: 5e-5,
    },
    files: [],
  };
  for (const filename of ["xp4-source.glb", "xp4.glb"]) {
    const row: any = { filename, passed: false };
    report.files.push(row);
    try {
      const { model, mechanism, sha256 } = await loadCandidate(filename);
      row.sha256 = sha256;
      row.persistedMechanism = {
        actualRightPivot: mechanism.actualRightPivot,
        wingAnchorRightCruise: mechanism.wingAnchorRightCruise,
        bodyAnchorRightCruise: mechanism.bodyAnchorRightCruise,
        rigidRodLength: mechanism.rigidRodLength,
        actualTravel: mechanism.actualTravel,
      };
      row.hierarchy = hierarchy(model.scene);
      row.clips = [];
      const faultScene = model.scene.clone(true);
      node(faultScene, "Drive_LeadScrewThread").rotateZ(0.05);
      faultScene.updateMatrixWorld(true);
      assert.throws(() => createThreadAudit(faultScene), /rest phase lost/);
      row.threadRestPhaseFaultInjection = {
        rejected: true,
        injectedMaleThreadRotationRadians: 0.05,
      };
      assert.deepEqual(model.animations.map((c) => c.name).sort(), [
        "TRANSWING_Hover_Cruise_Hover",
        "TRANSWING_Motors_Start_Stop",
      ]);
      for (const clip of model.animations) {
        const motors = clip.name.includes("Motors"),
          scene = model.scene.clone(true),
          mixer = new T.AnimationMixer(scene),
          action = mixer.clipAction(clip);
        action.setLoop(T.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        const rest = new Map<string, T.Quaternion>(
          [...DRIVE, ...IDS.map((id) => "Prop_" + id)].map((name) => [
            name,
            node(scene, name).quaternion.clone(),
          ]),
        );
        const sliderRest = node(scene, "BraceSpreader").position.z,
          phaseAudit = createThreadAudit(scene);
        let maximumEyeError = 0,
          maximumAxisError = 0,
          maximumDriveQuaternionError = 0,
          maximumThreadPhaseDrift = 0,
          maximumMechanismPointError = 0,
          maximumWingQuaternionError = 0,
          maximumEndpointMotorQuaternionError = 0,
          maximumEndpointFoldQuaternionError = 0,
          maximumMotorQuaternionError = 0,
          maximumFoldQuaternionError = 0,
          stationaryFoldChecks = 0,
          minimumSliderY = Infinity,
          maximumSliderY = -Infinity;
        const end = motors ? 168 : 199,
          endpointFrames = motors
            ? [0, 12, 36, 60, 96, 120, 132, 156, 168]
            : [0, 79, 119, 199];
        assert.ok(Math.abs(clip.duration - end / 24) < 1e-6);
        const times = new Set<number>(
          Array.from({ length: 4001 }, (_, i) => (clip.duration * i) / 4000),
        );
        for (let i = 0; i <= end * 4; i++) times.add(i / 96);
        endpointFrames.forEach((f) =>
          times.add(Math.min(clip.duration, f / 24)),
        );
        const driveTracks = [];
        for (const name of DRIVE) {
          const track = clip.tracks.find(
            (t) => t.name === name + ".quaternion",
          );
          assert.ok(track, `${clip.name} missing ${name}`);
          let maxStep = 0;
          for (let i = 1; i < track.times.length; i++) {
            const qa = new T.Quaternion().fromArray(track.values, (i - 1) * 4),
              qb = new T.Quaternion().fromArray(track.values, i * 4);
            maxStep = Math.max(maxStep, qa.angleTo(qb));
          }
          assert.ok(maxStep <= 0.7001);
          for (
            let i = 0;
            i < track.times.length - 1;
            i += Math.max(1, Math.floor(track.times.length / 1024))
          )
            times.add((track.times[i] + track.times[i + 1]) / 2);
          driveTracks.push({
            name,
            keys: track.times.length,
            maximumKeyAngle: maxStep,
          });
        }
        if (motors)
          for (const track of clip.tracks.filter((t) =>
            /^(Prop_|BladeFold_)/.test(t.name),
          )) {
            assert.equal(track.times.length, motorTimes.length);
            for (let i = 0; i < motorTimes.length; i++)
              assert.equal(
                track.times[i],
                motorTimes[i],
                "Frozen motor knot time changed",
              );
          }
        const endpoints = [];
        // Monotonic playback preserves LoopOnce semantics. Endpoint is genuinely clamped.
        for (const time of [...times].sort((a, b) => a - b)) {
          mixer.setTime(time);
          scene.updateMatrixWorld(true);
          const frame = time * 24,
            u = motors ? 0 : transitionU(frame),
            e = visibleJointAndAxisErrors(scene);
          maximumEyeError = Math.max(maximumEyeError, e.eye);
          maximumAxisError = Math.max(maximumAxisError, e.axis);
          const slider = node(scene, "BraceSpreader");
          minimumSliderY = Math.min(minimumSliderY, -slider.position.z);
          maximumSliderY = Math.max(maximumSliderY, -slider.position.z);
          for (const side of SIDES) {
            const expected = expectedMechanism(mechanism, u, side);
            maximumWingQuaternionError = Math.max(
              maximumWingQuaternionError,
              qerror(
                node(scene, "WingPivot_" + side).quaternion,
                expected.quaternion,
              ),
            );
            maximumMechanismPointError = Math.max(
              maximumMechanismPointError,
              node(scene, "BraceWing_" + side)
                .getWorldPosition(new T.Vector3())
                .distanceTo(expected.wing),
              node(scene, "BraceBody_" + side)
                .getWorldPosition(new T.Vector3())
                .distanceTo(expected.body),
            );
            assert.ok(
              node(scene, "BraceRod_" + side).scale.distanceTo(
                new T.Vector3(1, 1, 1),
              ) < 1e-7,
            );
          }
          for (const name of DRIVE) {
            const o = node(scene, name),
              extra = o.userData,
              q = rest
                .get(name)!
                .clone()
                .multiply(
                  new T.Quaternion().setFromAxisAngle(
                    new T.Vector3(
                      ...(extra.driveAxis as [number, number, number]),
                    ),
                    ((extra.phaseSign *
                      2 *
                      Math.PI *
                      (sliderRest - slider.position.z)) /
                      extra.screwLead) *
                      extra.phaseRatio,
                  ),
                );
            maximumDriveQuaternionError = Math.max(
              maximumDriveQuaternionError,
              qerror(o.quaternion, q),
            );
          }
          maximumThreadPhaseDrift = Math.max(
            maximumThreadPhaseDrift,
            phaseAudit.check(),
          );
          if (motors) {
            const expectedState = serializedMotorState(time);
            for (const id of IDS) {
              const prop = node(scene, "Prop_" + id),
                expected = rest
                  .get("Prop_" + id)!
                  .clone()
                  .multiply(
                    new T.Quaternion().setFromAxisAngle(
                      new T.Vector3(0, 1, 0),
                      prop.userData.spinSign * expectedState.phase,
                    ),
                  );
              maximumMotorQuaternionError = Math.max(
                maximumMotorQuaternionError,
                qerror(prop.quaternion, expected),
              );
              for (const leaf of ["A", "B"]) {
                const blade = node(scene, `BladeFold_${id}_${leaf}`),
                  foldQ = new T.Quaternion().setFromAxisAngle(
                    new T.Vector3(0, 0, 1),
                    ((leaf === "A" ? 1 : -1) * expectedState.fold * Math.PI) /
                      2,
                  );
                maximumFoldQuaternionError = Math.max(
                  maximumFoldQuaternionError,
                  qerror(blade.quaternion, foldQ),
                );
                if (blade.quaternion.angleTo(new T.Quaternion()) > 1e-5) {
                  assert.ok(
                    qerror(prop.quaternion, rest.get("Prop_" + id)!) < 1e-10,
                    "Baked prop must stay parked while blade is folded",
                  );
                  stationaryFoldChecks++;
                }
              }
            }
          }

          const endpoint = endpointFrames.find(
            (f) => Math.abs(frame - f) < 1e-5,
          );
          if (endpoint !== undefined) {
            const motor = motors ? motorState(endpoint) : null,
              folds: any = {};
            for (const id of IDS) {
              if (motor) {
                const p = node(scene, "Prop_" + id),
                  expected = rest
                    .get("Prop_" + id)!
                    .clone()
                    .multiply(
                      new T.Quaternion().setFromAxisAngle(
                        new T.Vector3(0, 1, 0),
                        p.userData.spinSign * motor.phase,
                      ),
                    );
                maximumEndpointMotorQuaternionError = Math.max(
                  maximumEndpointMotorQuaternionError,
                  qerror(p.quaternion, expected),
                );
              }
              for (const leaf of ["A", "B"]) {
                const blade = node(scene, `BladeFold_${id}_${leaf}`),
                  fold = motor
                    ? motor.fold
                    : id.endsWith("Rear")
                      ? Math.max(0, (u - 0.85) / 0.15)
                      : 0,
                  expected = new T.Quaternion().setFromAxisAngle(
                    new T.Vector3(0, 0, 1),
                    ((leaf === "A" ? 1 : -1) * fold * Math.PI) / 2,
                  );
                maximumEndpointFoldQuaternionError = Math.max(
                  maximumEndpointFoldQuaternionError,
                  qerror(blade.quaternion, expected),
                );
                folds[`${id}_${leaf}`] = blade.quaternion.toArray();
              }
            }
            endpoints.push({
              frame: endpoint,
              time,
              unfold: u,
              sliderPosition: slider.position.toArray(),
              wingR: node(scene, "WingPivot_R").quaternion.toArray(),
              screw: node(scene, "Drive_ScrewRotor").quaternion.toArray(),
              motorState: motor,
              bladeQuaternions: folds,
            });
          }
        }
        const result = {
          name: clip.name,
          channels: clip.tracks.length,
          duration: clip.duration,
          samples: times.size,
          maximumVisibleEyeBallDistance: maximumEyeError,
          maximumPropHubToRealAxisDistance: maximumAxisError,
          maximumDriveQuaternionError,
          maximumThreadPhaseDriftRadians: maximumThreadPhaseDrift,
          maximumMechanismPointError,
          maximumWingQuaternionError,
          maximumEndpointMotorQuaternionError,
          maximumEndpointFoldQuaternionError,
          maximumMotorQuaternionError,
          maximumFoldQuaternionError,
          stationaryFoldChecks,
          motorPoseReference: motors
            ? "Independent analytical values at the frozen 673 Float32 quarter-frame knots, with linear angle interpolation matching glTF quaternion SLERP"
            : null,
          actualSliderYRange: [minimumSliderY, maximumSliderY],
          driveTracks,
          threadPhase: phaseAudit.report,
          endpoints,
        };
        row.clips.push(result);
        assert.ok(
          maximumEyeError <= 2e-5,
          `Visible eye/ball gap ${maximumEyeError}`,
        );
        assert.ok(
          maximumAxisError <= 2e-6,
          `Prop hub axis gap ${maximumAxisError}`,
        );
        assert.ok(
          maximumDriveQuaternionError < 1e-10,
          `Drive quaternion error ${maximumDriveQuaternionError}`,
        );
        assert.ok(
          maximumThreadPhaseDrift < 5e-5,
          `Thread phase drift ${maximumThreadPhaseDrift}`,
        );
        assert.ok(
          maximumMechanismPointError < 2e-5,
          `Persisted mechanism differs from playback ${maximumMechanismPointError}`,
        );
        assert.ok(maximumWingQuaternionError < 1e-9);
        assert.ok(maximumEndpointMotorQuaternionError < 1e-10);
        assert.ok(maximumEndpointFoldQuaternionError < 1e-10);
        assert.ok(maximumMotorQuaternionError < 1e-10);
        assert.ok(maximumFoldQuaternionError < 1e-10);
        for (const f of endpointFrames)
          assert.ok(
            endpoints.some((e) => e.frame === f),
            `Missing complete action boundary ${f}`,
          );
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
      }
      row.passed = true;
    } catch (error) {
      row.error = error instanceof Error ? error.stack : String(error);
      report.passed = false;
    }
  }
  fs.writeFileSync(
    path.join(STAGE, "BAKED_ANIMATION_CHECK.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        files: report.files.map((r: any) => ({
          ...r,
          hierarchy: undefined,
          clips: r.clips?.map((c: any) => ({
            ...c,
            endpoints: undefined,
            threadPhase: undefined,
            driveTracks: undefined,
          })),
        })),
      },
      null,
      2,
    ),
  );
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await verifyBakedAnimation();
  if (!report.passed) process.exitCode = 1;
}
