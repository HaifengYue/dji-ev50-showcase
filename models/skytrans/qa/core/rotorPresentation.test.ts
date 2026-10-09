import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  SimulationRuntime,
  PROTOCOL,
  applyStatePatch,
  defaultSimulationState,
  type StateEnvelope,
} from './simulation';
import { MOTOR_IDS, stepMotors, type MotorStates } from './motors';
import { applyMotorPose, applyModelPose, createModelRig } from './rig';
import { createRotorExposure } from './rotorExposure';
const recording = readFileSync(
  new URL('../examples/python/full_flow.json', import.meta.url),
  'utf8',
);
const command = Object.fromEntries(MOTOR_IDS.map((id) => [id, { enabled: true, targetRpm: 1800 }]));
function live() {
  const runtime = new SimulationRuntime();
  runtime.connect();
  let revision = 0;
  let state = applyStatePatch(defaultSimulationState(), { motors: command });
  state.owner = 'external';
  const accept = (op: StateEnvelope['op'], dt = 0) => {
    if (op === 'step')
      state = {
        ...state,
        time: { ...state.time, seconds: state.time.seconds + dt },
      };
    runtime.accept({
      protocol: PROTOCOL,
      revision: revision++,
      op,
      state,
      ...(op === 'step' ? { dt } : {}),
    });
  };
  accept('set');
  accept('step', 2);
  return { runtime, accept };
}
const maxPhaseDifference = (a: MotorStates, b: MotorStates) =>
  Math.max(...MOTOR_IDS.map((id) => Math.abs(Math.sin((a[id].phase - b[id].phase) / 2))));

test('V15原1800 RPM/0.1秒输入仍积分三整圈，但真实快门样本覆盖多个相位', () => {
  const { runtime, accept } = live();
  const before = structuredClone(runtime.getSnapshot());
  accept('step', 0.1);
  const after = runtime.getSnapshot(),
    render = runtime.getRenderSample();
  assert.ok(maxPhaseDifference(before.actuators, after.actuators) < 1e-10);
  assert.deepEqual(render.actuators, after.actuators, '实时主模型不能为了平滑而延迟权威端点');
  assert.equal(render.exposure?.activeIds.length, 4);
  assert.equal(render.exposure?.samples.length, 16);
  assert.ok(maxPhaseDifference(render.exposure!.samples[0], render.exposure!.samples[15]) > 0.9);
  const authority = structuredClone(after);
  for (let i = 0; i < 100; i++) {
    runtime.advancePresentation(1 / 60);
    runtime.getRenderSample();
  }
  assert.deepEqual(runtime.getSnapshot(), authority, '帧刷新不能推进Python时钟、相位或revision');
  assert.equal(runtime.getRenderSample().exposure, null, '有限曝光过后不伪造继续转动');
});

test('外部暂停、断线、reset、seek和关闭立即取消快门且新step才恢复', () => {
  for (const operation of ['pause', 'reset', 'seek'] as const) {
    const { runtime, accept } = live();
    assert.ok(runtime.getRenderSample().exposure);
    accept(operation);
    assert.equal(runtime.getRenderSample().exposure, null);
  }
  const { runtime, accept } = live();
  const before = structuredClone(runtime.getSnapshot().actuators);
  runtime.setConnection('error', '测试断线');
  assert.equal(runtime.getRenderSample().exposure, null);
  assert.deepEqual(runtime.getSnapshot().actuators, before);
  runtime.setConnection('connected');
  assert.equal(runtime.getRenderSample().exposure, null, '仅重连不能伪造新运动');
  accept('step', 0.1);
  assert.ok(runtime.getRenderSample().exposure);
  runtime.resetLocal();
  assert.equal(runtime.getRenderSample().exposure, null);
});

test('JSON原0.1秒step内解析重建真正中间相位，暂停和定位无漂移', () => {
  const runtime = new SimulationRuntime();
  runtime.replay(recording);
  runtime.playReplay(true);
  runtime.advanceReplay(2);
  const before = structuredClone(runtime.getSnapshot());
  runtime.advanceReplay(1 / 120);
  const middle = runtime.getRenderSample();
  assert.deepEqual(runtime.getSnapshot(), before, '部分step不能假冒已处理下一条命令');
  assert.ok(maxPhaseDifference(middle.actuators, before.actuators) > 0.6);
  const expected = stepMotors(before.actuators, before.state.motors, 1 / 120);
  assert.ok(maxPhaseDifference(expected, middle.actuators) < 1e-10);
  assert.ok(Math.abs(middle.state.time.seconds - before.state.time.seconds - 1 / 120) < 1e-9);
  runtime.playReplay(false);
  const frozen = structuredClone(runtime.getRenderSample());
  runtime.advanceReplay(30);
  assert.deepEqual(runtime.getRenderSample(), frozen);
  assert.equal(frozen.exposure, null);
  runtime.replayAt(0);
  assert.equal(runtime.getRenderSample().state.time.seconds, 0);
  assert.ok(MOTOR_IDS.every((id) => runtime.getRenderSample().actuators[id].fold === 1));
});

test('0.1×慢放只改变整条记录播放速率，保留1800模拟RPM与真实相位并可看清旋转', () => {
  const runtime = new SimulationRuntime();
  runtime.replay(recording);
  runtime.playReplay(true);
  runtime.advanceReplay(2);
  runtime.setReplayRate(0.1);
  const before = runtime.getRenderSample();
  runtime.advanceReplay(1 / 60);
  const after = runtime.getRenderSample();
  assert.ok(Math.abs(after.state.time.seconds - before.state.time.seconds - 1 / 600) < 1e-9);
  assert.equal(after.actuators.L_Front.rpm, 1800);
  assert.ok(
    Math.abs(after.actuators.L_Front.phase - before.actuators.L_Front.phase - Math.PI / 10) < 1e-9,
  );
  assert.equal(after.exposure, null, '慢放显示180RPM低于快门阈值，应看到实体桨叶');
  assert.throws(() => runtime.setReplayRate(0.5 as never));
  runtime.setReplayRate(1);
  runtime.setRotorShutter(false);
  runtime.advanceReplay(0.01);
  assert.equal(runtime.getRenderSample().exposure, null);
});

test('四机快门只显示真正运转的电机，收叶和0RPM不假转', () => {
  const runtime = new SimulationRuntime();
  runtime.setLocal({ motors: { R_Rear: { targetRpm: 1800, enabled: true } } });
  runtime.stepLocal(0.3);
  assert.equal(runtime.getRenderSample().exposure, null);
  runtime.stepLocal(2);
  assert.deepEqual(runtime.getRenderSample().exposure?.activeIds, ['R_Rear']);
  runtime.setLocal({ motors: { R_Rear: { targetRpm: 0, enabled: false } } });
  runtime.stepLocal(5);
  assert.equal(runtime.getRenderSample().exposure, null);
  assert.equal(runtime.getSnapshot().actuators.R_Rear.fold, 1);
});

test('V16连续快门遵守spinSign，不改变真实GLB权威节点与实体叶片几何', async () => {
  const bytes = readFileSync(new URL('../public/models/xp4.glb', import.meta.url));
  const scene = (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  ).scene;
  const rig = createModelRig(scene);
  const { runtime, accept } = live();
  accept('step', 0.1);
  const sample = runtime.getRenderSample();
  applyModelPose(rig, 0.47);
  applyMotorPose(rig, sample.actuators);
  const authority = rig.props.map((prop) => prop.object.matrixWorld.clone());
  const exposure = createRotorExposure(rig);
  exposure.update(sample.exposure);
  rig.props.forEach((prop, i) => {
    assert.deepEqual(prop.object.matrixWorld.elements, authority[i].elements);
    const source = scene.getObjectByName(`Blade_${prop.id}_A`) as THREE.Mesh;
    assert.equal(source.visible, false);
    const layer = scene.getObjectByName(`Exposure_${prop.id}_Continuous`) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    assert.ok(layer.visible);
    assert.equal(layer.parent, prop.object);
    assert.equal(layer.castShadow, false);
    assert.equal(layer.material.depthTest, true);
    assert.equal(layer.material.depthWrite, false);
    assert.equal(layer.material.side, THREE.FrontSide);
    assert.equal(layer.userData.normalizedShutterCoverage, true);
    assert.equal(
      layer.geometry.getAttribute('rotorXY').count,
      layer.geometry.getAttribute('position').count,
    );
    const bounds = layer.material.uniforms.phaseBounds.value as THREE.Vector2[];
    assert.equal(bounds.length, 15);
    assert.ok(Math.abs(bounds[0].x + prop.spinSign * Math.PI) < 1e-8);
    assert.ok(Math.abs(bounds[14].y) < 1e-12);
    for (let j = 0; j < 14; j++) assert.equal(bounds[j].y, bounds[j + 1].x);
    assert.equal(source.geometry, (rig.nodes.get(source.name)!.object as THREE.Mesh).geometry);
    assert.ok(
      layer.userData.profile.every(
        (row: { radius: number; maxAxial: number; minAxial: number }) =>
          row.radius < 0.781 && row.maxAxial - row.minAxial < 0.045,
      ),
    );
  });
  exposure.update(null);
  assert.ok(rig.props.every((prop) => scene.getObjectByName(`Blade_${prop.id}_A`)!.visible));
  exposure.dispose();
  assert.equal(scene.getObjectByName('Exposure_L_Front_Continuous'), undefined);
});

test('set暂停和销毁也停止呈现残影，不依赖pause专用操作', () => {
  const { runtime, accept } = live();
  const snapshot = runtime.getSnapshot();
  const state = {
    ...snapshot.state,
    time: { ...snapshot.state.time, paused: false },
  };
  runtime.accept({ protocol: PROTOCOL, revision: 100, op: 'set', state });
  runtime.accept({
    protocol: PROTOCOL,
    revision: 101,
    op: 'step',
    state,
    dt: 0.1,
  });
  assert.ok(runtime.getRenderSample().exposure);
  runtime.accept({
    protocol: PROTOCOL,
    revision: 102,
    op: 'set',
    state: { ...state, time: { ...state.time, paused: true } },
  });
  assert.equal(runtime.getRenderSample().exposure, null);
  const replay = new SimulationRuntime();
  replay.replay(recording);
  replay.playReplay(true);
  replay.advanceReplay(2.01);
  assert.ok(replay.getRenderSample().exposure);
  replay.dispose();
  assert.equal(replay.getSnapshot().replayPlaying, false);
  assert.equal(replay.getRenderSample().exposure, null);
});

test('增强层四桨共四次draw预算，更新复用材质/几何/相位uniform，后桨与停车无亮边', async () => {
  const bytes = readFileSync(new URL('../public/models/xp4.glb', import.meta.url));
  const rig = createModelRig(
    (
      await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    ).scene,
  );
  const runtime = new SimulationRuntime();
  runtime.setLocal({
    motors: {
      L_Front: { enabled: true, targetRpm: 1800 },
      R_Front: { enabled: true, targetRpm: 1800 },
    },
  });
  runtime.stepLocal(2);
  const sample = runtime.getRenderSample();
  applyModelPose(rig, 1);
  applyMotorPose(rig, sample.actuators);
  const layer = createRotorExposure(rig);
  const meshes = rig.props.map(
    (prop) =>
      rig.scene.getObjectByName(`Exposure_${prop.id}_Continuous`) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.ShaderMaterial
      >,
  );
  const saved = meshes.map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material,
    bounds: mesh.material.uniforms.phaseBounds.value,
  }));
  const authority = structuredClone(runtime.getSnapshot());
  for (let i = 0; i < 120; i++) layer.update(sample.exposure);
  meshes.forEach((mesh, i) => {
    assert.equal(mesh.geometry, saved[i].geometry);
    assert.equal(mesh.material, saved[i].material);
    assert.equal(mesh.material.uniforms.phaseBounds.value, saved[i].bounds);
    assert.equal(mesh.geometry.groups.length, 0, '单材质、单draw');
    assert.equal(mesh.visible, rig.props[i].id.endsWith('Front'));
    assert.equal(mesh.userData.geometryBudget.triangles, 9600);
    assert.equal(mesh.userData.geometryBudget.vertices, 4850);
  });
  assert.equal(
    meshes.reduce((sum, mesh) => sum + mesh.geometry.index!.count / 3, 0),
    38400,
  );
  assert.equal(meshes.filter((mesh) => mesh.visible).length, 2, '巡航只画两个真实运转的前桨层');
  assert.deepEqual(runtime.getSnapshot(), authority);
  layer.update(null);
  assert.ok(meshes.every((mesh) => !mesh.visible));
  layer.dispose();
  runtime.dispose();
});
