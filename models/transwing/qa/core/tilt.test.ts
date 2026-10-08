import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  INITIAL_TILT,
  tiltReducer,
  easeTilt,
  tiltPhase,
  TILT_DURATION,
} from "./tilt";
import { applyModelPose, createModelRig } from "./rig";

const tick = (state: typeof INITIAL_TILT, seconds: number) =>
  tiltReducer(state, { type: "tick", seconds });
test("独立倾转连续开始、精确暂停、无跳变反向并停在端点", () => {
  let state = tiltReducer(INITIAL_TILT, { type: "begin", direction: 1 });
  state = tick(state, TILT_DURATION / 2);
  assert.ok(Math.abs(state.progress - 0.5) < 1e-12);
  state = tiltReducer(state, { type: "pause" });
  assert.deepEqual(tick(state, 9), state);
  state = tiltReducer(state, { type: "begin", direction: -1 });
  assert.ok(Math.abs(state.progress - 0.5) < 1e-12);
  state = tick(state, TILT_DURATION / 4);
  assert.ok(Math.abs(state.progress - easeTilt(0.25)) < 1e-12);
  state = tick(state, 10);
  assert.equal(state.progress, 0);
  assert.equal(state.playing, false);
  state = tiltReducer(state, { type: "begin", direction: 1 });
  state = tick(state, TILT_DURATION);
  assert.equal(state.progress, 1);
  assert.equal(state.playing, false);
  assert.equal(
    tiltReducer(state, { type: "begin", direction: 1 }).playing,
    false,
  );
});
test("重复开始不改变当前进度、滑块中断播放、复位停在零点", () => {
  let state = tick(
    tiltReducer(INITIAL_TILT, { type: "begin", direction: 1 }),
    2,
  );
  assert.deepEqual(tiltReducer(state, { type: "begin", direction: 1 }), state);
  state = tiltReducer(state, { type: "scrub", progress: 0.72 });
  assert.equal(state.progress, 0.72);
  assert.equal(state.playing, false);
  assert.deepEqual(tick(state, 3), state);
  assert.equal(tiltReducer(state, { type: "scrub", progress: -1 }).progress, 0);
  assert.equal(tiltReducer(state, { type: "scrub", progress: 2 }).progress, 1);
  assert.deepEqual(tiltReducer(state, { type: "reset" }), INITIAL_TILT);
});
test("往返循环在两端反向并处理长时间步长及无效增量", () => {
  let state = tiltReducer(
    { ...INITIAL_TILT, repeat: true },
    { type: "begin", direction: 1 },
  );
  state = tick(state, TILT_DURATION);
  assert.equal(state.progress, 1);
  assert.equal(state.direction, -1);
  assert.equal(state.playing, true);
  state = tick(state, TILT_DURATION / 2);
  assert.ok(Math.abs(state.progress - 0.5) < 1e-12);
  state = tick(state, TILT_DURATION / 2);
  assert.equal(state.progress, 0);
  assert.equal(state.direction, 1);
  state = tick(state, TILT_DURATION * 4.5);
  assert.ok(Math.abs(state.progress - 0.5) < 1e-12);
  assert.equal(state.direction, 1);
  for (const delta of [0, -1, NaN, Infinity])
    assert.deepEqual(tick(state, delta), state);
  state = tiltReducer(state, { type: "repeat", enabled: false });
  assert.equal(tick(state, TILT_DURATION).playing, false);
});
test("控制器驱动实际 GLB 双翼倾转且机身固定、撑杆始终连接", async () => {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  const { scene } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
  const rig = createModelRig(scene);
  assert.equal(rig.wings.filter((w) => w.rest).length, 2);
  const body = scene.getObjectByName("Fuselage") ?? scene;
  const position = body.position.clone(),
    quaternion = body.quaternion.clone();
  let state = tiltReducer(INITIAL_TILT, { type: "begin", direction: 1 });
  for (let i = 0; i <= 60; i++) {
    applyModelPose(rig, state.progress);
    for (const wing of rig.wings) {
      const rest = wing.rest!;
      const expected = new THREE.Quaternion()
        .setFromAxisAngle(
          wing.axis,
          (-wing.side * Math.PI * 2 * state.progress) / 3,
        )
        .multiply(rest.quaternion);
      assert.ok(1 - Math.abs(expected.dot(rest.object.quaternion)) < 1e-10);
    }
    for (const { rod, body, wing, length } of rig.braces) {
      assert.ok(
        rod
          .localToWorld(new THREE.Vector3(0, length, 0))
          .distanceTo(wing.getWorldPosition(new THREE.Vector3())) < 1e-6,
      );
      assert.ok(
        rod
          .localToWorld(new THREE.Vector3())
          .distanceTo(body.getWorldPosition(new THREE.Vector3())) < 1e-8,
      );
    }
    assert.ok(body.position.equals(position));
    assert.ok(body.quaternion.equals(quaternion));
    state = tick(state, 0.1);
  }
});

test("平滑展开端点零速、任意手动姿态可反向且速度独立", () => {
  for (let i = 0; i <= 100; i++)
    assert.ok(Math.abs(easeTilt(tiltPhase(i / 100)) - i / 100) < 1e-12);
  const first = tick(
    tiltReducer(INITIAL_TILT, { type: "begin", direction: 1 }),
    0.01,
  );
  assert.ok(first.progress < 0.00001);
  for (const progress of [0.01, 0.32, 0.8, 0.99]) {
    const paused = tiltReducer(INITIAL_TILT, { type: "scrub", progress });
    const reverse = tiltReducer(paused, { type: "begin", direction: -1 });
    assert.equal(reverse.progress, progress);
    assert.ok(tick(reverse, 0.1).progress < progress);
  }
  const slow = tiltReducer(INITIAL_TILT, { type: "rate", value: 0.5 });
  assert.ok(
    Math.abs(
      tick(tiltReducer(slow, { type: "begin", direction: 1 }), TILT_DURATION)
        .progress - 0.5,
    ) < 1e-12,
  );
  for (const progress of [NaN, Infinity, -Infinity])
    assert.deepEqual(
      tiltReducer(INITIAL_TILT, { type: "scrub", progress }),
      INITIAL_TILT,
    );
});
