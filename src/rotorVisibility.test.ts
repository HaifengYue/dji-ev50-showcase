import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { applyModelPose, applyMotorPose, createModelRig } from "./rig";
import { MOTOR_IDS, newMotorStates } from "./motors";
import {
  ROTOR_EXPOSURE_PRESENTATION,
  createRotorExposure,
  rotorExposureDisplayAlpha,
} from "./rotorExposure";
import { SCENE_LIGHTING, SCENE_TONE_MAPPING_EXPOSURE } from "./sceneLighting";
import { angularShutterCoverage } from "./rotorExposureProfile";
import { SimulationRuntime } from "./simulation";

async function model() {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  return createModelRig(
    (
      await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          "",
        )
    ).scene,
  );
}

test("V17显示对比度有界、单调且保留透明端点，不把半圈曝光变成实体桨盘", () => {
  assert.equal(rotorExposureDisplayAlpha(0), 0);
  assert.equal(rotorExposureDisplayAlpha(1), 1);
  assert.equal(rotorExposureDisplayAlpha(-0.1), 0);
  assert.equal(rotorExposureDisplayAlpha(1.1), 1);
  for (let i = 1; i <= 1000; i++) {
    const coverage = i / 1000;
    const displayed = rotorExposureDisplayAlpha(coverage);
    assert.ok(displayed >= coverage - 1e-12);
    assert.ok(displayed <= coverage * 1.35 + 1e-12);
    assert.ok(displayed >= rotorExposureDisplayAlpha((i - 1) / 1000));
    assert.ok(
      Math.abs(rotorExposureDisplayAlpha(coverage, 1) - coverage) < 1e-12,
    );
  }
  for (const width of [0.02, 0.12, 0.3, 0.4]) {
    const expected = rotorExposureDisplayAlpha(width / Math.PI);
    assert.ok(expected < 0.17);
    for (let i = 0; i < 2048; i++) {
      const coverage = angularShutterCoverage(
        (i * Math.PI) / 1024,
        0,
        width,
        -Math.PI,
        0,
      );
      assert.ok(
        Math.abs(rotorExposureDisplayAlpha(coverage) - expected) < 1e-12,
      );
    }
  }
});

test("V17机库仅轻调光比，保留背景与曝光，天空灯光不改", () => {
  assert.equal(SCENE_LIGHTING.hangar.background, "#d4e0eb");
  assert.equal(SCENE_TONE_MAPPING_EXPOSURE, 0.94);
  assert.equal(SCENE_LIGHTING.hangar.ambient, 0.32);
  assert.equal(SCENE_LIGHTING.hangar.hemisphere.intensity, 0.68);
  assert.equal(SCENE_LIGHTING.hangar.coolFill.intensity, 32);
  assert.equal(SCENE_LIGHTING.hangar.sun.intensity, 2.35);
  assert.deepEqual(
    [
      SCENE_LIGHTING.sky.ambient,
      SCENE_LIGHTING.sky.hemisphere.intensity,
      SCENE_LIGHTING.sky.sun.intensity,
      SCENE_LIGHTING.sky.coolFill.intensity,
      SCENE_LIGHTING.sky.topReflection,
      SCENE_LIGHTING.sky.sideReflection,
    ],
    [0.55, 0.85, 2.7, 28, 2.8, 1.6],
  );
});

test("四个真实桨毂和铰臂继承同一有符号轴相位，没有独立慢转或局部漂移", async () => {
  const rig = await model();
  applyModelPose(rig, 0.47);
  const states = newMotorStates();
  const saved = rig.props.map((prop) => {
    const spinner = rig.scene.getObjectByName(`Spinner_${prop.id}`)!;
    assert.equal(spinner.parent, prop.object);
    for (const leaf of ["A", "B"])
      assert.equal(
        rig.scene.getObjectByName(`Blade_hinge_arm_${prop.id}_${leaf}`)!.parent,
        prop.object,
      );
    return {
      spinner,
      local: spinner.matrix.clone(),
      before: spinner.matrixWorld.clone(),
    };
  });
  for (const id of MOTOR_IDS)
    states[id] = { ...states[id], fold: 0, phase: 0.73, rpm: 1800 };
  applyMotorPose(rig, states);
  rig.props.forEach((prop, i) => {
    const expected = prop.quaternion
      .clone()
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          prop.axis,
          prop.spinSign * 0.73,
        ),
      );
    assert.ok(prop.object.quaternion.angleTo(expected) < 1e-7);
    const { spinner, local, before } = saved[i];
    assert.deepEqual(spinner.matrix.elements, local.elements);
    const expectedWorld = prop.object.matrixWorld.clone().multiply(local);
    assert.deepEqual(spinner.matrixWorld.elements, expectedWorld.elements);
    assert.notDeepEqual(spinner.matrixWorld.elements, before.elements);
  });
});

test("显示增强只改新增快门材质，暂停即清除，不改权威电机、桨毂和叶片资源", async () => {
  const rig = await model();
  const runtime = new SimulationRuntime();
  runtime.setLocal({ motors: { L_Front: { enabled: true, targetRpm: 1800 } } });
  runtime.stepLocal(2);
  const sample = runtime.getRenderSample();
  applyMotorPose(rig, sample.actuators);
  const authority = structuredClone(runtime.getSnapshot());
  const transforms = [...rig.nodes.values()].map(({ object }) =>
    object.matrixWorld.elements.slice(),
  );
  const spinner = rig.scene.getObjectByName("Spinner_L_Front") as THREE.Mesh;
  const material = spinner.material;
  const exposure = createRotorExposure(rig);
  exposure.update(sample.exposure);
  const mesh = rig.scene.getObjectByName(
    "Exposure_L_Front_Continuous",
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  assert.equal(mesh.material.uniforms.displayContrast.value, 1.35);
  assert.equal(
    mesh.material.uniforms.carbonColor.value.getHex(),
    ROTOR_EXPOSURE_PRESENTATION.carbonColor,
  );
  assert.equal(mesh.material.blending, THREE.NormalBlending);
  assert.equal(mesh.userData.normalizedShutterCoverage, true);
  assert.deepEqual(
    [...rig.nodes.values()].map(({ object }) => object.matrixWorld.elements),
    transforms,
  );
  assert.deepEqual(runtime.getSnapshot(), authority);
  assert.equal(spinner.material, material);
  exposure.update(null);
  assert.equal(mesh.visible, false);
  assert.equal(rig.scene.getObjectByName("Blade_L_Front_A")!.visible, true);
  exposure.dispose();
  runtime.dispose();
});
