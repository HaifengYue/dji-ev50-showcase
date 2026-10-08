import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import {
  CAMERA_NAVIGATION,
  CAMERA_CLIP_DEFAULTS,
  getCameraDepthRange,
  syncCameraDepthRange,
  resizeCameraProjection,
} from "./cameraNavigation";
import {
  applyCameraFrame,
  boxCorners,
  createInspectionCamera,
  getInspectionFrame,
  getPresentationFrame,
  translateCameraFrame,
} from "./inspection";

const bounds = new THREE.Box3(
  new THREE.Vector3(-6, -0.6, -4),
  new THREE.Vector3(6, 3.6, 4),
);

function navigation(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
) {
  const controls = new OrbitControls(camera);
  Object.assign(controls, CAMERA_NAVIGATION, { enableDamping: false });
  return controls;
}

// 仅驱动已安装 OrbitControls 的事件处理器；不是浏览器或真实触屏验收。
class ControlSurface extends EventTarget {
  style = { touchAction: "auto" };
  clientWidth = 900;
  clientHeight = 600;
  ownerDocument = new EventTarget();
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 900, height: 600 };
  }
  releasePointerCapture() {}
}
function dispatch(surface: EventTarget, type: string, data: object) {
  surface.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), data),
  );
}

test("透视缩放相对于当前目标限制在0.2–240，不受飞行世界坐标影响", () => {
  for (const offset of [
    new THREE.Vector3(),
    new THREE.Vector3(1e4, 100, -1e4),
  ]) {
    const camera = new THREE.PerspectiveCamera(39, 1.5);
    camera.position.copy(offset).add(new THREE.Vector3(0, 0, 20));
    const controls = navigation(camera);
    controls.target.copy(offset);
    controls.update();
    controls.dollyIn(1e-6);
    assert.ok(Math.abs(controls.getDistance() - 0.2) < 1e-9);
    controls.dollyOut(1e-6);
    assert.ok(Math.abs(controls.getDistance() - 240) < 1e-9);
    assert.ok(controls.minDistance < 6 / 20);
    assert.ok(controls.maxDistance > 70 * 3);
    controls.dispose();
  }
});

test("整机与局部正交检查共用0.08–40倍缩放且不改变正交方向", () => {
  for (const view of ["top", "front", "side", "perspective"] as const) {
    const camera = createInspectionCamera();
    const frame = getInspectionFrame(bounds, view, 1.5);
    applyCameraFrame(camera, frame, 1.5);
    const controls = navigation(camera);
    controls.target.copy(frame.target);
    controls.enableRotate = false;
    controls.update();
    const rotation = camera.quaternion.clone();
    controls.dollyIn(1e-6);
    assert.equal(camera.zoom, 40);
    controls.dollyOut(1e-6);
    assert.equal(camera.zoom, 0.08);
    assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
    controls.dispose();
  }
});

test("近景自适应裁面保留目标细节投影，放大能力为原6单位下限的30倍", () => {
  const target = new THREE.Vector3(1.35, 1.2, 1.3);
  const detail = new THREE.Box3(
    target.clone().addScalar(-0.008),
    target.clone().addScalar(0.008),
  );
  for (const aspect of [0.55, 1, 1.8, 2.6]) {
    const camera = new THREE.PerspectiveCamera(39, aspect);
    camera.position
      .copy(target)
      .add(new THREE.Vector3(0, 0, CAMERA_NAVIGATION.minDistance));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    syncCameraDepthRange(camera, target);
    assert.equal(camera.near, 0.005);
    for (const corner of boxCorners(detail)) {
      corner.project(camera);
      assert.ok(
        Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1 &&
          Math.abs(corner.z) < 1,
      );
    }
    const point = target.clone().add(new THREE.Vector3(0.008, 0, 0));
    const enlarged = point.clone().project(camera).x;
    camera.position.z = target.z + 6;
    camera.updateMatrixWorld(true);
    assert.ok(Math.abs(enlarged / point.project(camera).x - 30) < 1e-9);
  }
});

test("最远透视范围仍完整容纳整机且不会被远裁面或旧78单位雾吞没", () => {
  for (const aspect of [0.55, 1, 1.8, 2.6]) {
    const camera = new THREE.PerspectiveCamera(39, aspect);
    const target = bounds.getCenter(new THREE.Vector3());
    camera.position
      .copy(target)
      .add(new THREE.Vector3(0, 0, CAMERA_NAVIGATION.maxDistance));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const fog = new THREE.Fog("#d4e0eb", 30, 78);
    syncCameraDepthRange(camera, target, fog);
    for (const corner of boxCorners(bounds)) {
      const depth = -corner.clone().applyMatrix4(camera.matrixWorldInverse).z;
      assert.ok(depth < fog.near);
      corner.project(camera);
      assert.ok(
        Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1 &&
          Math.abs(corner.z) < 1,
      );
    }
  }
  assert.deepEqual(getCameraDepthRange(20), {
    near: 0.1,
    far: 600,
    fogNear: 30,
    fogFar: 78,
  });
  for (const distance of [-1, NaN, Infinity])
    assert.throws(() => getCameraDepthRange(distance));
});

test("Node合成滚轮事件锚定光标处细节，正交平移后不改变检查方向", () => {
  const camera = createInspectionCamera();
  camera.left = -3;
  camera.right = 3;
  camera.top = 2;
  camera.bottom = -2;
  camera.position.set(0, 0, 20);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const controls = navigation(camera);
  controls.enableRotate = false;
  const surface = new ControlSurface();
  controls.connect(surface as unknown as HTMLElement);
  const rotation = camera.quaternion.clone();
  const point = new THREE.Vector3(0.5, 0, 0).unproject(camera);
  dispatch(surface, "wheel", { clientX: 675, clientY: 300, deltaY: -1 });
  assert.ok(camera.zoom > 1);
  assert.ok(Math.abs(point.project(camera).x - 0.5) < 1e-9);
  assert.ok(controls.target.length() > 0);
  const before = controls.target.clone();
  dispatch(surface, "pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    button: 2,
    clientX: 450,
    clientY: 300,
  });
  dispatch(surface.ownerDocument, "pointermove", {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 500,
    clientY: 330,
  });
  dispatch(surface.ownerDocument, "pointerup", {
    pointerId: 1,
    pointerType: "mouse",
  });
  assert.ok(controls.target.distanceTo(before) > 0.1);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
  controls.dispose();
});

test("Node合成双指事件保留捏合缩放和平移，即使检查模式禁止旋转", () => {
  const camera = createInspectionCamera();
  applyCameraFrame(camera, getInspectionFrame(bounds, "front", 1.5), 1.5);
  const controls = navigation(camera);
  controls.target.copy(bounds.getCenter(new THREE.Vector3()));
  controls.enableRotate = false;
  controls.update();
  const surface = new ControlSurface();
  controls.connect(surface as unknown as HTMLElement);
  const rotation = camera.quaternion.clone();
  const before = controls.target.clone();
  for (const [pointerId, pageX] of [
    [1, 400],
    [2, 500],
  ])
    dispatch(surface, "pointerdown", {
      pointerId,
      pointerType: "touch",
      pageX,
      pageY: 300,
    });
  dispatch(surface.ownerDocument, "pointermove", {
    pointerId: 2,
    pointerType: "touch",
    pageX: 600,
    pageY: 300,
  });
  assert.equal(camera.zoom, 2);
  assert.ok(controls.target.distanceTo(before) > 0.1);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
  for (const pointerId of [1, 2])
    dispatch(surface.ownerDocument, "pointerup", {
      pointerId,
      pointerType: "touch",
    });
  controls.dispose();
});

test("深度更新及外部平移保留用户缩放、平移目标与方向，重置仍恢复预设", () => {
  const camera = createInspectionCamera();
  const frame = getInspectionFrame(bounds, "top", 1.5);
  applyCameraFrame(camera, frame, 1.5);
  const target = frame.target.clone();
  translateCameraFrame(camera, target, new THREE.Vector3(2, 0, -1));
  camera.zoom = 40;
  camera.updateProjectionMatrix();
  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  const relative = camera.position.clone().sub(target);
  for (let i = 0; i < 60; i++) syncCameraDepthRange(camera, target);
  assert.ok(camera.position.equals(position));
  assert.equal(camera.zoom, 40);
  translateCameraFrame(camera, target, new THREE.Vector3(10000, -20, 10000));
  syncCameraDepthRange(camera, target);
  assert.ok(camera.position.clone().sub(target).distanceTo(relative) < 1e-9);
  assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7);
  assert.equal(camera.zoom, 40);
  applyCameraFrame(camera, frame, 1.5);
  target.copy(frame.target);
  assert.ok(camera.position.equals(frame.position));
  assert.ok(target.equals(frame.target));
  assert.equal(camera.zoom, 1);
});

test("极远正交视景切回透视的等效起点仍在裁面内，最终预设不受扩大范围影响", () => {
  for (const aspect of [0.55, 1, 1.8]) {
    const frame = getInspectionFrame(bounds, "top", aspect);
    const fromHeight = frame.height / CAMERA_NAVIGATION.minZoom;
    const fromDistance =
      fromHeight / (2 * Math.tan(THREE.MathUtils.degToRad(19.5)));
    const camera = new THREE.PerspectiveCamera(
      39,
      aspect,
      CAMERA_CLIP_DEFAULTS.near,
      CAMERA_CLIP_DEFAULTS.far,
    );
    camera.position
      .copy(frame.target)
      .add(new THREE.Vector3(0, fromDistance, 0));
    camera.up.set(0, 0, 1);
    camera.lookAt(frame.target);
    camera.updateMatrixWorld(true);
    syncCameraDepthRange(camera, frame.target);
    assert.ok(Math.abs(frame.target.clone().project(camera).z) < 1);
    const final = getPresentationFrame(bounds, aspect, true);
    applyCameraFrame(camera, final, aspect);
    syncCameraDepthRange(camera, final.target);
    for (const corner of boxCorners(bounds)) {
      corner.project(camera);
      assert.ok(
        Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1 &&
          Math.abs(corner.z) < 1,
      );
    }
  }
});

test("反复改变视景比例只更新投影，保留自由/正交镜头的位置、目标、倍率与方向", () => {
  for (const camera of [
    new THREE.PerspectiveCamera(39, 1.5, 0.1, 600),
    createInspectionCamera(),
  ]) {
    camera.position.set(-12.7, -3.5, 18.2);
    camera.up.set(0.1, 1, 0.2).normalize();
    const controls = navigation(camera);
    controls.target.set(1.23, 0.7, -0.82);
    camera.lookAt(controls.target);
    camera.zoom = 2.7;
    camera.updateProjectionMatrix();
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    const target = controls.target.clone();
    const up = camera.up.clone();
    for (const aspect of [0.4, 1.5, 2.8, 0.7, 1.5]) {
      resizeCameraProjection(camera, aspect);
      syncCameraDepthRange(camera, controls.target);
      assert.ok(camera.position.equals(position));
      assert.ok(camera.quaternion.equals(rotation));
      assert.ok(camera.up.equals(up));
      assert.ok(controls.target.equals(target));
      assert.equal(camera.zoom, 2.7);
      if (camera instanceof THREE.PerspectiveCamera) {
        assert.equal(camera.aspect, aspect);
      } else {
        assert.ok(
          Math.abs(
            (camera.right - camera.left) / (camera.top - camera.bottom) -
              aspect,
          ) < 1e-12,
        );
      }
    }
    controls.dispose();
  }
});
