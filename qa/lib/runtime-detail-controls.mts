/** 真实reducer和已加载GLB驱动检查，不是浏览器或实体干涉验收。 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { loadRuntimeRig } from "./runtime-motor-motion.mts";
import {
  applyDetailPose,
  applyModelPose,
  measureModelRig,
  GROUND_HEIGHT,
} from "../../src/rig.ts";
import {
  INITIAL_EXPERIENCE,
  displayedUnfold,
  experienceReducer,
  type ExperienceAction,
  type ExperienceState,
} from "../../src/experience.ts";
import {
  DETAIL_VIEWS,
  DETAIL_LIMITS,
  NEUTRAL_DETAIL_POSE,
  controlsForDetail,
} from "../../src/details.ts";
import {
  getDetailInspectionFrame,
  applyCameraFrame,
  boxCorners,
} from "../../src/inspection.ts";

function assertDetailInterlocks(state: ExperienceState) {
  if (!state.detailView) {
    assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
    return;
  }
  assert.equal(state.playing, false);
  assert.equal(state.tilt.playing, false);
  assert.equal(state.exploded, false);
  assert.equal(state.autoRotate, false);
  assert.equal(displayedUnfold(state), 1);
  const enabled = controlsForDetail(state.detailView);
  for (const control of Object.keys(
    DETAIL_LIMITS,
  ) as (keyof typeof DETAIL_LIMITS)[]) {
    assert.ok(Number.isFinite(state.detailPose[control]));
    if (!enabled.includes(control)) assert.equal(state.detailPose[control], 0);
  }
}
function assertNeutralRig(
  rig: Awaited<ReturnType<typeof loadRuntimeRig>>["rig"],
) {
  for (const part of rig.details)
    assert.ok(
      part.object.quaternion.angleTo(part.quaternion) < 1e-7,
      `${part.object.name} must return to its exported neutral pose`,
    );
}
export async function verifyRuntimeDetailFaultInjection() {
  const legal = experienceReducer(INITIAL_EXPERIENCE, {
    type: "detail",
    view: "motors",
  });
  assertDetailInterlocks(legal);
  assert.throws(() =>
    assertDetailInterlocks({
      ...legal,
      detailPose: { ...NEUTRAL_DETAIL_POSE, hatch: 55 },
    }),
  );
  assert.throws(() => assertDetailInterlocks({ ...legal, playing: true }));
  assert.throws(() => assertDetailInterlocks({ ...legal, exploded: true }));
  const { rig } = await loadRuntimeRig();
  applyModelPose(rig, 0);
  assertNeutralRig(rig);
  for (const part of rig.details) {
    part.object.quaternion
      .copy(part.quaternion)
      .multiply(new THREE.Quaternion().setFromAxisAngle(part.axis, 0.08));
    assert.throws(() => assertNeutralRig(rig));
    part.object.quaternion.copy(part.quaternion);
  }
  return {
    rejected: true,
    invalidControlMixRejected: true,
    runningFlightRejected: true,
    explodedHatchRejected: true,
    individualLeakedPivotsRejected: rig.details.length,
  };
}

export async function runRuntimeDetailControls() {
  const { rig, sha256 } = await loadRuntimeRig();
  assert.equal(rig.details.length, 7);
  let modeTransitions = 0,
    pivotPoseChecks = 0,
    interruptedExits = 0,
    projectedCorners = 0;
  for (const progress of [0, 0.017, 0.25, 0.499, 0.75, 0.85, 0.999, 1]) {
    let state = experienceReducer(INITIAL_EXPERIENCE, { type: "enter-tilt" });
    state = experienceReducer(state, {
      type: "tilt",
      action: { type: "scrub", progress },
    });
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const view of DETAIL_VIEWS) {
        state = experienceReducer(state, { type: "detail", view: view.id });
        modeTransitions++;
        for (const control of view.controls) {
          state = experienceReducer(state, {
            type: "detail-pose",
            control,
            degrees: DETAIL_LIMITS[control][repeat % 2],
          });
        }
        assertDetailInterlocks(state);
        const stable = experienceReducer(state, {
          type: "tilt",
          action: { type: "tick", seconds: 0.1 },
        });
        assert.equal(stable, state);
        applyModelPose(rig, displayedUnfold(state), state.exploded);
        applyDetailPose(rig, state.detailPose);
        for (const part of rig.details) {
          const degrees = THREE.MathUtils.clamp(
            state.detailPose[part.group],
            ...part.range,
          );
          const expected = part.quaternion
            .clone()
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(
                part.axis,
                (part.sign * degrees * Math.PI) / 180,
              ),
            );
          assert.ok(part.object.quaternion.angleTo(expected) < 1e-7);
          assert.ok(part.object.position.distanceTo(part.position) < 1e-12);
          pivotPoseChecks++;
        }
      }
      state = experienceReducer(state, { type: "close-detail" });
      assert.equal(displayedUnfold(state), progress);
      assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
    }
    const exits: ExperienceAction[] = [
      { type: "reset" },
      { type: "close-detail" },
      { type: "play-flight" },
      { type: "inspect", view: "top" },
      { type: "joint", side: "R" },
      { type: "enter-tilt" },
      { type: "set", key: "exploded", value: true },
      { type: "set", key: "cameraReset", value: (n) => n + 1 },
    ];
    for (const action of exits) {
      let interrupted = experienceReducer(state, {
        type: "detail",
        view: "cargo",
      });
      interrupted = experienceReducer(interrupted, {
        type: "detail-pose",
        control: "hatch",
        degrees: 55,
      });
      interrupted = experienceReducer(interrupted, action);
      assertDetailInterlocks(interrupted);
      applyModelPose(rig, displayedUnfold(interrupted), interrupted.exploded);
      applyDetailPose(rig, interrupted.detailPose);
      for (const part of rig.details)
        assert.ok(part.object.quaternion.angleTo(part.quaternion) < 1e-7);
      interruptedExits++;
    }
  }
  const measurements = measureModelRig(rig);
  for (const view of DETAIL_VIEWS.filter(({ id }) => id !== "systems")) {
    const bounds = measurements.detailBounds[view.id];
    assert.equal(bounds.isEmpty(), false);
    for (const aspect of [0.32, 0.45, 0.75, 1, 1.6, 2.4]) {
      const camera = new THREE.OrthographicCamera();
      applyCameraFrame(
        camera,
        getDetailInspectionFrame(bounds, view.id, aspect),
        aspect,
      );
      for (const corner of boxCorners(bounds)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) < 0.76 && Math.abs(corner.y) < 0.76);
        projectedCorners++;
      }
    }
  }
  let minimumHatchGroundClearance = Infinity;
  for (let angle = 0; angle <= 55; angle += 0.5) {
    applyModelPose(rig, 1);
    applyDetailPose(rig, { hatch: angle });
    const minY =
      new THREE.Box3().setFromObject(rig.nodes.get("CargoHoodPivot")!.object)
        .min.y +
      measurements.groundOffset +
      measurements.detailLift;
    minimumHatchGroundClearance = Math.min(
      minimumHatchGroundClearance,
      minY - GROUND_HEIGHT,
    );
    assert.ok(minY - GROUND_HEIGHT > 0.139);
  }
  applyModelPose(rig, 0);
  const concept = readFileSync(
    new URL("../../public/models/nacelle-system-concept.glb", import.meta.url),
  );
  const sourceFiles = [
    "src/experience.ts",
    "src/details.ts",
    "src/rig.ts",
    "src/inspection.ts",
    "src/Scene.tsx",
    "src/App.tsx",
    "src/DetailPanel.tsx",
  ];
  return {
    passed: true,
    evidenceType:
      "Node numerical execution of actual reducer, model driver, GLB nodes and camera matrices; not browser interaction or independent solid interference proof",
    timestamp: new Date().toISOString(),
    assetSha256: sha256,
    conceptSha256: createHash("sha256").update(concept).digest("hex"),
    conceptBytes: concept.byteLength,
    sourceSha256: Object.fromEntries(
      sourceFiles.map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(new URL(`../../${file}`, import.meta.url)))
          .digest("hex"),
      ]),
    ),
    modeTransitions,
    pivotPoseChecks,
    interruptedExits,
    projectedCorners,
    mainPivots: rig.details.map((part) => ({
      name: part.object.name,
      group: part.group,
      axis: part.axis.toArray(),
      rangeDegrees: part.range,
      sign: part.sign,
    })),
    cargoInspectionLift: measurements.detailLift,
    minimumHatchGroundClearance,
    neutralFlightDefault: true,
    conceptIsSeparateLazyAsset: true,
    faultInjection: await verifyRuntimeDetailFaultInjection(),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await runRuntimeDetailControls();
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
