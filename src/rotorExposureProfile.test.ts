import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig, applyModelPose, applyMotorPose } from "./rig";
import { createRotorExposure } from "./rotorExposure";
import {
  angularShutterCoverage,
  createBladeExposureProfile,
  createExposureGeometry,
} from "./rotorExposureProfile";
import { newMotorStates, MOTOR_IDS } from "./motors";
import { SimulationRuntime } from "./simulation";

async function model() {
  const b = readFileSync(new URL("../public/models/xp4.glb", import.meta.url));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
  return createModelRig(gltf.scene);
}

test("连续半圈曝光是归一化叶片占空比，任意角度无16重鬼影、无不透明圆盘", () => {
  for (const width of [0.02, 0.12, 0.3, 0.4])
    for (const spin of [-1, 1]) {
      const expected = width / Math.PI;
      for (let i = 0; i < 2048; i++)
        assert.ok(
          Math.abs(
            angularShutterCoverage(
              (i / 2048) * Math.PI * 2,
              -0.2,
              -0.2 + width,
              -spin * Math.PI,
              0,
            ) - expected,
          ) < 1e-12,
        );
      assert.ok(expected < 0.13);
    }
});

test("解析积分匹配密集真实时间采样，反向旋转与跨越相位零点连续", () => {
  for (const span of [0.4, 1.3, 2.9])
    for (const spin of [-1, 1])
      for (const angle of [-3.1, -1.7, -0.03, 0, 0.03, 1.5, 3.1]) {
        const start = spin * span,
          end = 0,
          min = -0.1,
          max = 0.18,
          n = 8192;
        let sum = 0;
        for (let i = 0; i < n; i++)
          sum += angularShutterCoverage(
            angle,
            min,
            max,
            start + ((end - start) * (i + 0.5)) / n,
            start + ((end - start) * (i + 0.5)) / n,
          );
        const exact = angularShutterCoverage(angle, min, max, start, end);
        assert.ok(Math.abs(exact - sum / n) < 2 / n);
        assert.ok(
          Math.abs(
            exact -
              angularShutterCoverage(angle + 2 * Math.PI, min, max, start, end),
          ) < 1e-12,
        );
      }
});

test("RPM改变弧长而非累加不透明度：空间积分守恒，连续区间分割不产生条纹", () => {
  for (const rpm of [600, 900, 1200, 1800]) {
    const span = Math.min(Math.PI, ((rpm / 60) * 2 * Math.PI) / 60),
      width = 0.2,
      n = 4096;
    let integrated = 0;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI;
      const full = angularShutterCoverage(angle, -0.1, 0.1, -span, 0);
      let segments = 0;
      for (let j = 0; j < 15; j++)
        segments +=
          angularShutterCoverage(
            angle,
            -0.1,
            0.1,
            (-span * (15 - j)) / 15,
            (-span * (14 - j)) / 15,
          ) / 15;
      assert.ok(Math.abs(full - segments) < 1e-12);
      integrated += full / n;
    }
    assert.ok(Math.abs(integrated - width / Math.PI) < 2e-6);
  }
});

test("轮廓来自实际部署叶片，保持渐尖/后掠及薄轴向包络，与当前折叶或整翼姿态无关", async () => {
  const rig = await model();
  const sourceTransforms = [...rig.nodes.values()].map((n) =>
    n.object.matrixWorld.elements.slice(),
  );
  const profiles = rig.props.map((p) => createBladeExposureProfile(rig, p));
  assert.deepEqual(
    [...rig.nodes.values()].map((n) => n.object.matrixWorld.elements),
    sourceTransforms,
  );
  for (const p of profiles) {
    assert.ok(Math.abs(p.rows[0].radius - 0.148) < 1e-4);
    assert.ok(Math.abs(p.rows.at(-1)!.radius - 0.78) < 1e-4);
    assert.ok(
      p.rows[48].maxAngle - p.rows[48].minAngle >
        p.rows[84].maxAngle - p.rows[84].minAngle,
    );
    assert.ok(p.rows.at(-1)!.maxAngle - p.rows.at(-1)!.minAngle < 1e-6);
    assert.ok(p.rows.every((r) => r.maxAxial - r.minAxial < 0.045));
    assert.ok(p.rows[48].maxAxial - p.rows[48].minAxial > 0.015);
    const geometry = createExposureGeometry(p);
    assert.ok(geometry.getAttribute("position").count < 26000);
    geometry.dispose();
  }
  applyModelPose(rig, 0.63);
  const states = newMotorStates();
  for (const id of MOTOR_IDS)
    states[id] = { ...states[id], fold: 0.7, phase: 2.3 };
  applyMotorPose(rig, states);
  rig.props.forEach((prop, i) =>
    assert.deepEqual(
      createBladeExposureProfile(rig, prop).rows,
      profiles[i].rows,
    ),
  );
});

test("停桨/收叶/清空与销毁立即撤销曝光，重建不会累积残影或释放原叶片资源", async () => {
  const rig = await model(),
    runtime = new SimulationRuntime();
  runtime.setLocal({ motors: { L_Front: { enabled: true, targetRpm: 1800 } } });
  runtime.stepLocal(2);
  const sample = runtime.getRenderSample();
  applyMotorPose(rig, sample.actuators);
  const originalGeometry = (
    rig.scene.getObjectByName("Blade_L_Front_A") as THREE.Mesh
  ).geometry;
  let originalDisposed = false;
  originalGeometry.addEventListener("dispose", () => {
    originalDisposed = true;
  });
  for (let repeat = 0; repeat < 3; repeat++) {
    const layer = createRotorExposure(rig);
    layer.update(sample.exposure);
    const mesh = rig.scene.getObjectByName(
      "Exposure_L_Front_Continuous",
    ) as THREE.Mesh;
    assert.ok(mesh.visible);
    layer.update(null);
    assert.equal(mesh.visible, false);
    assert.equal(rig.scene.getObjectByName("Blade_L_Front_A")!.visible, true);
    layer.update(sample.exposure);
    rig.props.find((p) => p.id === "L_Front")!.motor.fold = 0.2;
    layer.update(sample.exposure);
    assert.equal(mesh.visible, false, "过期曝光不能重新显示已经收折的叶片");
    rig.props.find((p) => p.id === "L_Front")!.motor.fold = 0;
    let geometryDisposed = false;
    mesh.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });
    layer.dispose();
    assert.equal(geometryDisposed, true);
    assert.equal(originalDisposed, false);
    assert.equal(
      rig.scene.getObjectByName("Exposure_L_Front_Continuous"),
      undefined,
    );
  }
});
