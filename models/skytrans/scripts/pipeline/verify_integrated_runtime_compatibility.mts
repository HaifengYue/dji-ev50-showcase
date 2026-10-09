/** V27 staged geometry against the unmodified production rig and motor controller. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import * as T from "../../../../threejs/node_modules/three/build/three.module.js";
import {
  createModelRig,
  applyModelPose,
  measureModelRig,
  getWingJoint,
} from "../../../../threejs/src/aircraft/skytrans/core/rig.ts";
import { createRotorExposure } from "../../../../threejs/src/aircraft/skytrans/core/rotorExposure.ts";
import { createInternalDriveInspection } from "../../../../threejs/src/aircraft/skytrans/core/internalDriveInspection.ts";
import {
  runRuntimeMotionChecks,
  verifyRuntimeFaultInjection,
} from "../../qa/lib/runtime-rotor-motion.mts";
import {
  ROOT,
  STAGE,
  SIDES,
  IDS,
  sha,
  node,
  qerror,
  loadCandidate,
  expectedMechanism,
  hierarchy,
  visibleJointAndAxisErrors,
  createThreadAudit,
} from "./verify_integrated_baked_animation.mts";
const protectedPaths = [
  "../../threejs/src/aircraft/skytrans/core/rig.ts",
  "../../threejs/src/aircraft/skytrans/core/motors.ts",
  "../../threejs/src/aircraft/skytrans/core/details.ts",
  "../../threejs/src/aircraft/skytrans/core/rotorExposure.ts",
  "../../threejs/src/aircraft/skytrans/core/internalDriveInspection.ts",
  "qa/lib/runtime-rotor-motion.mts",
];
const protectedHashes = () =>
  Object.fromEntries(
    protectedPaths.map((p) => [p, sha(fs.readFileSync(path.join(ROOT, p)))]),
  );
const before = protectedHashes();
const report: any = {
  schema: "transwing.v27-integrated-runtime-compatibility.v1",
  revision: 27,
  passed: true,
  pipelineTrialOnly: true,
  productionSourceModified: false,
  browserPixelsTested: false,
  appearanceAccepted: false,
  globalMaterialCollisionAcceptanceImplied: false,
  thresholds: {
    rigidRodClosure: 1e-6,
    visibleEyeBallDistance: 2e-5,
    propHubToRealAxisDistance: 2e-6,
    threadPhaseDriftRadians: 5e-5,
  },
  productionAndExistingQAHashes: before,
  files: [],
};
const prior = process.env.QA_MODEL;
try {
  for (const filename of ["xp4-source.glb", "xp4.glb"]) {
    const row: any = { filename, passed: false, errors: [] };
    report.files.push(row);
    try {
      const { file, sha256, model, mechanism } = await loadCandidate(filename);
      row.sha256 = sha256;
      row.hierarchy = hierarchy(model.scene);
      const scene = model.scene,
        rig = createModelRig(scene);
      assert.equal(rig.props.length, 4);
      assert.equal(rig.blades.length, 8);
      assert.equal(rig.braces.length, 2);
      assert.equal(rig.internalDrive.length, 5);
      row.actualRenderMeshes = 0;
      scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          row.actualRenderMeshes++;
          const clone = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
          for (const m of Array.isArray(clone) ? clone : [clone]) m.dispose();
        }
      });
      row.aliases = [];
      row.persistentMechanism = {
        actualRightPivot: mechanism.actualRightPivot,
        wingAnchorRightCruise: mechanism.wingAnchorRightCruise,
        rigidRodLength: mechanism.rigidRodLength,
        actualTravel: mechanism.actualTravel,
      };
      for (const side of SIDES) {
        const owner = node(scene, "Composite_wing_" + side),
          alias = node(scene, "WingLowerClosure_" + side);
        assert.equal((alias as T.Mesh).isMesh, undefined);
        let primitives = 0;
        owner.traverse((o) => {
          if (o instanceof T.Mesh) {
            primitives++;
            assert.ok(o.geometry.getAttribute("position").count > 0);
          }
        });
        assert.ok(primitives > 0);
        row.aliases.push({
          side,
          ownerType: owner.type,
          renderPrimitives: primitives,
          aliasType: alias.type,
        });
        const joint = getWingJoint(rig, side)!;
        assert.ok(Math.abs(joint.angle - (Math.PI * 2) / 3) < 1e-10);
        assert.ok(
          joint.position.distanceTo(
            expectedMechanism(mechanism, 0, side).pivot,
          ) < 2e-6,
        );
        const start = node(scene, "RootAxisStart_" + side).getWorldPosition(
            new T.Vector3(),
          ),
          end = node(scene, "RootAxisEnd_" + side).getWorldPosition(
            new T.Vector3(),
          ),
          axis = end.sub(start).normalize();
        assert.ok(1 - Math.abs(joint.axis.dot(axis)) < 1e-10);
        assert.ok(
          joint.position.clone().sub(start).cross(axis).length() < 2e-6,
        );
      }
      const measured = measureModelRig(rig);
      assert.ok(!measured.bounds.isEmpty());
      const thread = createThreadAudit(scene);
      row.threadPhase = thread.report;
      row.legacyDriveMetadata = rig.internalDrive.map((d) => ({
        node: d.object.name,
        legacySliderRestY: d.object.userData.sliderRestY,
        currentRestY: -rig.spreader!.position.z,
        usedByProduction: false,
      }));
      let maximumClosure = 0,
        maximumEyeError = 0,
        maximumAxisError = 0,
        maximumPointError = 0,
        maximumWingQuaternionError = 0,
        maximumDriveQuaternionError = 0,
        maximumThreadPhaseDrift = 0,
        axisChecks = 0,
        boundsChecks = 0,
        minimumY = Infinity,
        maximumY = -Infinity,
        minimumFrontStopGap = Infinity;
      const fixedNames = [
          "Drive_MotorHousing",
          "Drive_ReductionHousing",
          "Drive_GuideRail_L",
          "Drive_GuideRail_R",
          "Drive_RingGear",
          "Drive_FrontTravelStop_L",
          "Drive_FrontTravelStop_R",
        ],
        fixed = new Map(
          fixedNames.map((name) => [
            name,
            node(scene, name).matrixWorld.clone(),
          ]),
        );
      const endpoints = [];
      row.actualFrontStops = [];
      for (const side of SIDES) {
        const stop = new T.Box3().setFromObject(
            node(scene, "Drive_FrontTravelStop_" + side),
          ),
          bushing = new T.Box3().setFromObject(
            node(scene, "Drive_GuideBushing_" + side),
          );
        row.actualFrontStops.push({
          side,
          stopBlenderYBounds: [-stop.max.z, -stop.min.z],
          stopCenterBlenderY: -(stop.min.z + stop.max.z) / 2,
          innerFaceBlenderY: -stop.min.z,
          bushingFrontFaceAtHoverBlenderY: -bushing.max.z,
          hoverGap: stop.min.z - bushing.max.z,
          method:
            "Loaded actual mesh world-space bounds, glTF Z negated to Blender Y",
        });
      }
      for (let i = 0; i <= 4000; i++) {
        const u = i / 4000;
        applyModelPose(rig, u);
        for (const { side, body, wing, rod, length } of rig.braces) {
          const a = body.getWorldPosition(new T.Vector3()),
            b = wing.getWorldPosition(new T.Vector3()),
            e = expectedMechanism(mechanism, u, side),
            error = Math.max(
              rod.localToWorld(new T.Vector3()).distanceTo(a),
              rod.localToWorld(new T.Vector3(0, length, 0)).distanceTo(b),
              Math.abs(a.distanceTo(b) - length),
            );
          maximumClosure = Math.max(maximumClosure, error);
          assert.ok(
            error < 1e-6,
            `Closed rigid rod failure ${side} at ${u}: ${error}`,
          );
          assert.ok(rod.scale.equals(new T.Vector3(1, 1, 1)));
          assert.ok(Math.abs(length - mechanism.rigidRodLength) < 2e-6);
          maximumPointError = Math.max(
            maximumPointError,
            a.distanceTo(e.body),
            b.distanceTo(e.wing),
          );
          maximumWingQuaternionError = Math.max(
            maximumWingQuaternionError,
            qerror(node(scene, "WingPivot_" + side).quaternion, e.quaternion),
          );
        }
        const errors = visibleJointAndAxisErrors(scene);
        maximumEyeError = Math.max(maximumEyeError, errors.eye);
        maximumAxisError = Math.max(maximumAxisError, errors.axis);
        for (const id of IDS) {
          const a = node(scene, "MotorAxisStart_" + id).getWorldPosition(
              new T.Vector3(),
            ),
            b = node(scene, "MotorAxisEnd_" + id).getWorldPosition(
              new T.Vector3(),
            ),
            axis = b.sub(a).normalize();
          if (i === 0) assert.ok(axis.y > 0.9999);
          if (i === 4000) assert.ok(axis.z > 0.9999);
          axisChecks++;
        }
        for (const d of rig.internalDrive) {
          const travel =
              rig.spreader!.position.z - rig.spreader!.object.position.z,
            q = d.quaternion
              .clone()
              .multiply(
                new T.Quaternion().setFromAxisAngle(
                  d.axis,
                  ((d.phaseSign * 2 * Math.PI * travel) / d.screwLead) *
                    d.phaseRatio,
                ),
              );
          maximumDriveQuaternionError = Math.max(
            maximumDriveQuaternionError,
            qerror(d.object.quaternion, q),
          );
          assert.ok(d.object.scale.equals(new T.Vector3(1, 1, 1)));
        }
        maximumThreadPhaseDrift = Math.max(
          maximumThreadPhaseDrift,
          thread.check(),
        );
        const y = -rig.spreader!.object.position.z;
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
        for (const name of fixedNames)
          assert.ok(
            node(scene, name).matrixWorld.equals(fixed.get(name)!),
            "Fixed drive hardware moved: " + name,
          );
        for (const side of SIDES) {
          const stop = new T.Box3().setFromObject(
              node(scene, "Drive_FrontTravelStop_" + side),
            ),
            bushing = new T.Box3().setFromObject(
              node(scene, "Drive_GuideBushing_" + side),
            );
          minimumFrontStopGap = Math.min(
            minimumFrontStopGap,
            stop.min.z - bushing.max.z,
          );
        }
        if (i % 10 === 0) {
          const current = new T.Box3()
            .setFromObject(scene)
            .translate(new T.Vector3(0, measured.groundOffset, 0));
          assert.ok(
            measured.bounds.clone().expandByScalar(0.01).containsBox(current),
          );
          boundsChecks++;
        }
        if ([0, 2000, 4000].includes(i))
          endpoints.push({
            unfold: u,
            wingAngleDegrees: 120 * u,
            sliderY: y,
            wingR: node(scene, "WingPivot_R").quaternion.toArray(),
            rootEyeWorld: new T.Box3()
              .setFromObject(node(scene, "BraceRodEye_R_Root"))
              .getCenter(new T.Vector3())
              .toArray(),
          });
      }
      Object.assign(row, {
        continuousParameterSamples: 4001,
        maximumRigidRodClosureError: maximumClosure,
        maximumVisibleEyeBallDistance: maximumEyeError,
        maximumPropHubToRealAxisDistance: maximumAxisError,
        maximumPersistentMechanismPointError: maximumPointError,
        maximumWingQuaternionError,
        maximumDriveQuaternionError,
        maximumThreadPhaseDriftRadians: maximumThreadPhaseDrift,
        actualMotorAxisChecks: axisChecks,
        boundsChecks,
        actualTravel: { minimumY, maximumY },
        minimumFrontStopBushingGap: minimumFrontStopGap,
        endpoints,
      });
      assert.ok(maximumEyeError <= 2e-5);
      assert.ok(maximumAxisError <= 2e-6);
      assert.ok(maximumPointError < 2e-6);
      assert.ok(maximumWingQuaternionError < 1e-10);
      assert.ok(maximumDriveQuaternionError < 1e-12);
      assert.ok(maximumThreadPhaseDrift < 5e-5);
      assert.ok(Math.abs(minimumY - mechanism.actualTravel.minimumY) < 2e-6);
      assert.ok(Math.abs(maximumY - mechanism.actualTravel.maximumY) < 2e-6);
      assert.ok(
        minimumFrontStopGap > 0.0039,
        "Actual updated front stop lacks its .004 concept-unit design gap",
      );
      for (const u of [0, 0.13, 0.5, 1, 0.89, 0.5, 0.13, 0]) {
        applyModelPose(rig, u);
        const snapshot = rig.braces.map((x) => ({
          position: x.rod.position.clone(),
          quaternion: x.rod.quaternion.clone(),
        }));
        applyModelPose(rig, u, true);
        applyModelPose(rig, u);
        rig.braces.forEach((x, i) => {
          assert.ok(x.rod.position.distanceTo(snapshot[i].position) < 1e-10);
          assert.ok(
            1 - Math.abs(x.rod.quaternion.dot(snapshot[i].quaternion)) < 1e-12,
          );
        });
      }
      row.explodedRestoreChecks = 8;
      const inspection = createInternalDriveInspection(scene);
      inspection.setActive(true);
      inspection.setActive(false);
      inspection.dispose();
      const exposure = createRotorExposure(rig);
      exposure.update(null);
      exposure.dispose();
      row.inspectionAndExposureLifecyclePassed = true;
    } catch (error) {
      row.errors.push({
        stage: "production-rig-and-continuous-pose-sweep",
        error: error instanceof Error ? error.stack : String(error),
      });
    }
    // Preserve the original independent motor QA, including deliberate unsafe folding.
    try {
      process.env.QA_MODEL = path.join(STAGE, filename);
      row.productionMotorMotion = await runRuntimeMotionChecks();
      row.productionMotionFaultInjection = await verifyRuntimeFaultInjection();
      assert.equal(row.productionMotorMotion.passed, true);
      assert.equal(row.productionMotionFaultInjection.rejected, true);
    } catch (error) {
      row.errors.push({
        stage: "production-motor-motion-and-fault-injection",
        error: error instanceof Error ? error.stack : String(error),
      });
    }
    row.passed = row.errors.length === 0;
    if (!row.passed) report.passed = false;
  }
} finally {
  if (prior === undefined) delete process.env.QA_MODEL;
  else process.env.QA_MODEL = prior;
}
assert.deepEqual(
  protectedHashes(),
  before,
  "Acceptance must never modify production or old QA",
);
fs.writeFileSync(
  path.join(STAGE, "RUNTIME_COMPATIBILITY_CHECK.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      ...report,
      files: report.files.map((r: any) => ({
        ...r,
        hierarchy: undefined,
        threadPhase: undefined,
        productionMotorMotion: r.productionMotorMotion
          ? {
              passed: r.productionMotorMotion.passed,
              poseChecks: r.productionMotorMotion.poseChecks,
              axisPlaneChecks: r.productionMotorMotion.axisPlaneChecks,
            }
          : undefined,
      })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
