import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  boxCorners,
  createInspectionCamera,
  getInspectionFrame,
  INSPECTION_VIEWS,
  getPresentationFrame,
  getJointInspectionFrame,
  applyCameraFrame,
} from "./inspection";

test("正视、侧视与俯视严格对应机体三条正交轴", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-5, -0.6, -4),
    new THREE.Vector3(5, 3, 4),
  );
  for (const [view, axis] of [
    ["front", [0, 0, 1]],
    ["side", [1, 0, 0]],
    ["top", [0, 1, 0]],
  ] as const) {
    const frame = getInspectionFrame(bounds, view, 1.5);
    assert.ok(
      frame.position
        .clone()
        .sub(frame.target)
        .normalize()
        .distanceTo(new THREE.Vector3(...axis)) < 1e-10,
    );
  }
});

test("横屏与窄屏的所有检查视角完整容纳实际包围盒并保留边距", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-6, -0.6, -3),
    new THREE.Vector3(6, 3.6, 4.5),
  );
  for (const aspect of [0.55, 0.75, 1, 1.6, 2.5]) {
    for (const { id } of INSPECTION_VIEWS) {
      const frame = getInspectionFrame(bounds, id, aspect);
      const camera = new THREE.OrthographicCamera(
        (-frame.height * aspect) / 2,
        (frame.height * aspect) / 2,
        frame.height / 2,
        -frame.height / 2,
        0.1,
        180,
      );
      camera.position.copy(frame.position);
      camera.up.copy(frame.up);
      camera.lookAt(frame.target);
      camera.updateMatrixWorld(true);
      for (const corner of boxCorners(bounds)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) < 0.76, `${id}：横向越界`);
        assert.ok(Math.abs(corner.y) < 0.76, `${id}：纵向越界`);
        assert.ok(Math.abs(corner.z) < 1, `${id}：深度越界`);
      }
    }
  }
});

test("检查相机自主管理投影，切换画质或像素比不改变模型取景", () => {
  const camera = createInspectionCamera();
  assert.equal(camera.manual, true);
  assert.equal(camera.isOrthographicCamera, true);
});

test("俯视为严格 Y 轴正交投影，机头 +Z 朝上且高度变化不改变平面比例", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-5, -1, -3),
    new THREE.Vector3(5, 3, 3),
  );
  const frame = getInspectionFrame(bounds, "top", 1.5);
  const camera = createInspectionCamera();
  camera.left = (-frame.height * 1.5) / 2;
  camera.right = -camera.left;
  camera.top = frame.height / 2;
  camera.bottom = -camera.top;
  camera.position.copy(frame.position);
  camera.up.copy(frame.up);
  camera.lookAt(frame.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const nose = new THREE.Vector3(0, 0, 2).project(camera);
  const tail = new THREE.Vector3(0, 0, -2).project(camera);
  assert.ok(nose.y > tail.y);
  assert.ok(Math.abs(nose.x - tail.x) < 1e-10);
  const low = new THREE.Vector3(2, -1, 1).project(camera);
  const high = new THREE.Vector3(2, 4, 1).project(camera);
  assert.ok(Math.abs(low.x - high.x) < 1e-10);
  assert.ok(Math.abs(low.y - high.y) < 1e-10);
});

test("折叠首屏近景比完整航迹更近，宽窄屏均保留模型边距", () => {
  const folded = new THREE.Box3(
    new THREE.Vector3(-1.7, -0.6, -3),
    new THREE.Vector3(1.7, 2.5, 2.8),
  );
  const all = new THREE.Box3(
    new THREE.Vector3(-5.4, -0.6, -3),
    new THREE.Vector3(5.4, 2.5, 2.8),
  );
  for (const aspect of [0.55, 1, 1.8, 2.6]) {
    const close = getPresentationFrame(folded, aspect);
    const wide = getPresentationFrame(all, aspect, true);
    assert.ok(close.distance < wide.distance * 0.85);
    const camera = new THREE.PerspectiveCamera(39, aspect, 0.1, 180);
    camera.position.copy(close.position);
    camera.lookAt(close.target);
    camera.updateMatrixWorld(true);
    for (const corner of boxCorners(folded)) {
      corner.project(camera);
      assert.ok(Math.abs(corner.x) < 0.8);
      assert.ok(Math.abs(corner.y) < 0.8);
    }
  }
});

test("左右关节特写直接以实际轴心取景且保持镜像机位", () => {
  const left = getJointInspectionFrame(
    new THREE.Vector3(-1.35, 0.47, 1.3),
    "L",
    1.5,
  );
  const right = getJointInspectionFrame(
    new THREE.Vector3(1.35, 0.47, 1.3),
    "R",
    1.5,
  );
  assert.equal(left.target.x, -1.35);
  assert.equal(right.target.x, 1.35);
  assert.ok(left.position.x < left.target.x);
  assert.ok(right.position.x > right.target.x);
  assert.ok(Math.abs(left.height - right.height) < 1e-10);
});

test("减少动态效果直接提交相机终态，反复换俯视、正视和特写不继承错误缩放", () => {
  const camera = createInspectionCamera();
  const bounds = new THREE.Box3(
    new THREE.Vector3(-5, -1, -3),
    new THREE.Vector3(5, 3, 3),
  );
  for (let i = 0; i < 5; i++) {
    for (const view of ["top", "front", "side", "perspective"] as const) {
      const frame = getInspectionFrame(bounds, view, 1.5);
      camera.zoom = 3;
      applyCameraFrame(camera, frame, 1.5);
      assert.equal(camera.zoom, 1);
      assert.ok(camera.position.distanceTo(frame.position) < 1e-10);
      assert.ok(camera.up.distanceTo(frame.up) < 1e-10);
      assert.equal(camera.top, frame.height / 2);
      assert.ok(
        camera
          .getWorldDirection(new THREE.Vector3())
          .distanceTo(frame.target.clone().sub(frame.position).normalize()) <
          1e-10,
      );
    }
    const close = getJointInspectionFrame(
      new THREE.Vector3(1.35, 0.47, 1.3),
      "R",
      1.5,
    );
    applyCameraFrame(camera, close, 1.5);
    assert.equal(camera.top, close.height / 2);
  }
});

test("连杆特写按整段运动范围固定取景，左右和宽窄屏都不裁切", () => {
  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? -1 : 1;
    const position = new THREE.Vector3(sign * 1.35, 0.47, 1.3);
    const motionBounds = new THREE.Box3().setFromPoints([
      new THREE.Vector3(sign * 0.2, -0.3, -2.1),
      new THREE.Vector3(sign * 2.3, 1.7, 1.8),
    ]);
    for (const aspect of [0.55, 1, 1.8, 2.6]) {
      const frame = getJointInspectionFrame(
        position,
        side,
        aspect,
        motionBounds,
      );
      const camera = createInspectionCamera();
      applyCameraFrame(camera, frame, aspect);
      for (const corner of boxCorners(motionBounds)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) < 0.76, `${side} 连杆横向越界`);
        assert.ok(Math.abs(corner.y) < 0.76, `${side} 连杆纵向越界`);
      }
    }
  }
});

test("外部轨迹镜头随根位移平移，任意跳转保留机体投影和用户观察方向", async () => {
  const { translateCameraFrame } = await import("./inspection");
  const camera = new THREE.PerspectiveCamera(39, 1.8, 0.1, 180);
  const target = new THREE.Vector3(0, 1, 0);
  camera.position.set(20, 15, 20);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const quaternion = camera.quaternion.clone(),
    projected = target.clone().project(camera),
    relative = camera.position.clone().sub(target);
  for (const delta of [
    new THREE.Vector3(0, 3, 9),
    new THREE.Vector3(10000, -100, 1000),
    new THREE.Vector3(-10000, 100, -1000),
  ]) {
    translateCameraFrame(camera, target, delta);
    assert.ok(camera.position.clone().sub(target).distanceTo(relative) < 1e-9);
    assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7);
    assert.ok(target.clone().project(camera).distanceTo(projected) < 1e-9);
  }
  const before = camera.position.clone();
  assert.throws(() =>
    translateCameraFrame(camera, target, new THREE.Vector3(NaN, 0, 0)),
  );
  assert.ok(camera.position.equals(before));
});
