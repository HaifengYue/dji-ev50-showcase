import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyModelPose, applyMotorPose, createModelRig } from './rig';
import { MOTOR_IDS, newMotorStates } from './motors';
import {
  ROTOR_EXPOSURE_PRESENTATION,
  createRotorExposure,
  rotorExposureDisplayAlpha,
  rotorExposureStyle,
  ROTOR_EXPOSURE_FRAGMENT_SHADER,
} from './rotorExposure';
import { SCENE_LIGHTING, SCENE_TONE_MAPPING_EXPOSURE } from './sceneLighting';
import { angularShutterCoverage, createBladeExposureProfile } from './rotorExposureProfile';
import { SimulationRuntime } from './simulation';

async function model() {
  const bytes = readFileSync(new URL('../public/models/xp4.glb', import.meta.url));
  return createModelRig(
    (
      await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    ).scene,
  );
}

test('显示传递与真实覆盖分离，透明度上限明确且不生成不透明桨盘', () => {
  const p = ROTOR_EXPOSURE_PRESENTATION;
  assert.equal(rotorExposureDisplayAlpha(0), 0);
  assert.equal(rotorExposureDisplayAlpha(1), 1);
  assert.equal(rotorExposureDisplayAlpha(-0.1), 0);
  assert.equal(rotorExposureDisplayAlpha(1.1), 1);
  for (let i = 1; i <= 1000; i++) {
    const coverage = i / 1000;
    const displayed = rotorExposureDisplayAlpha(coverage);
    assert.ok(displayed >= coverage - 1e-12);
    assert.ok(displayed <= coverage * p.contrast + 1e-12);
    assert.ok(displayed >= rotorExposureDisplayAlpha((i - 1) / 1000));
    assert.ok(Math.abs(rotorExposureDisplayAlpha(coverage, 1) - coverage) < 1e-12);
  }
  for (let c = 0; c <= 20; c++)
    for (let r = 0; r <= 40; r++)
      for (const grazing of [0, 0.5, 1]) {
        const style = rotorExposureStyle(c / 20, 0.7, r / 40, grazing);
        assert.ok(style.alpha >= 0 && style.alpha <= 0.42);
        assert.ok(style.lightMix >= 0 && style.lightMix <= 1);
      }
  for (const radial of [-1, 0, 0.3, 0.94, 1, 2])
    assert.equal(rotorExposureStyle(0, 1, radial, 1).alpha, 0);
  for (const radial of [-1, 0, 1, 2]) assert.equal(rotorExposureStyle(1, 1, radial, 1).alpha, 0);
  // Uniform half-turn exposure still integrates exact normalized blade occupancy.
  for (const width of [0.02, 0.12, 0.3, 0.4])
    for (let i = 0; i < 2048; i++) {
      const coverage = angularShutterCoverage((i * Math.PI) / 1024, 0, width, -Math.PI, 0);
      assert.ok(Math.abs(coverage - width / Math.PI) < 1e-12);
    }
  assert.match(ROTOR_EXPOSURE_FRAGMENT_SHADER, /rawCoverage \+= value \/ 15.0/);
  assert.match(ROTOR_EXPOSURE_FRAGMENT_SHADER, /if \(i >= 12\) recentCoverage \+= value \/ 3.0/);
  assert.ok(
    !/sin\(|cos\(|time|random/.test(ROTOR_EXPOSURE_FRAGMENT_SHADER.replace(/\/\/[^\n]*/g, '')),
    '纹理不使用额外相位时钟或人造角向条纹',
  );
});

test('实际桨外圈从约1–3%透明度提高为有界淡亮边，天空与绿地各有可辨明暗层', async () => {
  const rig = await model();
  const profile = createBladeExposureProfile(rig, rig.props[0]);
  const carbon = new THREE.Color(ROTOR_EXPOSURE_PRESENTATION.carbonColor),
    pale = new THREE.Color(ROTOR_EXPOSURE_PRESENTATION.rimColor);
  const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const sky = luminance(new THREE.Color(0xd7e3e9)),
    ground = luminance(new THREE.Color(0x566b2a));
  for (const i of [84, 90, 94]) {
    const row = profile.rows[i],
      coverage = (row.maxAngle - row.minAngle) / Math.PI;
    const style = rotorExposureStyle(coverage, coverage, i / 96);
    assert.ok(style.alpha > 0.15 && style.alpha <= 0.42);
    assert.ok(style.alpha > rotorExposureDisplayAlpha(coverage, 1.35) * 4);
  }
  const rim = rotorExposureStyle(0.015, 0.08, 0.94);
  const rimLuminance = luminance(carbon.clone().lerp(pale, rim.lightMix));
  assert.ok((rimLuminance - ground) * rim.alpha > 0.09, '暗地面上有淡亮外缘');
  const face = rotorExposureStyle(0.05, 0.05, 0.65);
  const faceLuminance = luminance(carbon.clone().lerp(pale, face.lightMix));
  assert.ok((sky - faceLuminance) * face.alpha > 0.08, '亮天空上有淡暗扫掠层');
  assert.ok(
    rotorExposureStyle(0.03, 0.1, 0.5, 1).alpha > rotorExposureStyle(0.03, 0.1, 0.5, 0).alpha,
    '侧视只增强对比，不加厚几何',
  );
});

test('V17机库仅轻调光比，保留背景与曝光，天空灯光不改', () => {
  assert.equal(SCENE_LIGHTING.hangar.background, '#d4e0eb');
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

test('四个真实桨毂和铰臂继承同一有符号轴相位，没有独立慢转或局部漂移', async () => {
  const rig = await model();
  applyModelPose(rig, 0.47);
  const states = newMotorStates();
  const saved = rig.props.map((prop) => {
    const spinner = rig.scene.getObjectByName(`Spinner_${prop.id}`)!;
    assert.equal(spinner.parent, prop.object);
    for (const leaf of ['A', 'B'])
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
  for (const id of MOTOR_IDS) states[id] = { ...states[id], fold: 0, phase: 0.73, rpm: 1800 };
  applyMotorPose(rig, states);
  rig.props.forEach((prop, i) => {
    const expected = prop.quaternion
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(prop.axis, prop.spinSign * 0.73));
    assert.ok(prop.object.quaternion.angleTo(expected) < 1e-7);
    const { spinner, local, before } = saved[i];
    assert.deepEqual(spinner.matrix.elements, local.elements);
    const expectedWorld = prop.object.matrixWorld.clone().multiply(local);
    assert.deepEqual(spinner.matrixWorld.elements, expectedWorld.elements);
    assert.notDeepEqual(spinner.matrixWorld.elements, before.elements);
  });
});

test('显示增强只改新增快门材质，暂停即清除，不改权威电机、桨毂和叶片资源', async () => {
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
  const spinner = rig.scene.getObjectByName('Spinner_L_Front') as THREE.Mesh;
  const material = spinner.material;
  const exposure = createRotorExposure(rig);
  exposure.update(sample.exposure);
  const mesh = rig.scene.getObjectByName('Exposure_L_Front_Continuous') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  assert.equal(mesh.material.uniforms.displayContrast.value, ROTOR_EXPOSURE_PRESENTATION.contrast);
  assert.equal(mesh.material.uniforms.maxAlpha.value, 0.42);
  assert.equal(mesh.material.toneMapped, false);
  assert.equal(mesh.renderOrder, ROTOR_EXPOSURE_PRESENTATION.renderOrder);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false);
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
  assert.equal(rig.scene.getObjectByName('Blade_L_Front_A')!.visible, true);
  exposure.dispose();
  runtime.dispose();
});
