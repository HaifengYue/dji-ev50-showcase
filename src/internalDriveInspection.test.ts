import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import {
  createInternalDriveInspection,
  getInternalDriveInspectionFrame,
  INTERNAL_DRIVE_SHELL_NAMES,
} from "./internalDriveInspection";
import InternalDrivePanel from "./InternalDrivePanel";
import { applyCameraFrame, boxCorners } from "./inspection";
import { applyModelPose, measureModelRig } from "./rig";
import { loadRuntimeRig } from "../qa/lib/runtime-motor-motion.mts";

function makeInspectionFixture() {
  const root = new THREE.Group();
  for (const name of [
    ...INTERNAL_DRIVE_SHELL_NAMES,
    "FuselageAccessory",
    "Drive_Crossbeam",
    "Drive_NutCarriage",
    "Prop_R_Front",
  ]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.67 }),
    );
    mesh.name = name;
    mesh.position.set(1, 2, 3);
    mesh.castShadow = true;
    root.add(mesh);
  }
  root.getObjectByName("ActuatorSideSlot_R")!.visible = false;
  return root;
}

test("内部驱动只移开精确外壳白名单，机构、配件和旋桨保持原样", () => {
  const root = makeInspectionFixture();
  const original = root.children.map((object) => ({
    object,
    visible: object.visible,
    material: (object as THREE.Mesh).material,
    position: object.position.clone(),
    castShadow: object.castShadow,
  }));
  const view = createInternalDriveInspection(root);
  view.setActive(true);
  for (const record of original) {
    const shell = INTERNAL_DRIVE_SHELL_NAMES.some(
      (name) => name === record.object.name,
    );
    assert.equal(record.object.visible, shell ? false : record.visible);
    assert.equal((record.object as THREE.Mesh).material, record.material);
    assert.deepEqual(record.object.position, record.position);
    assert.equal(record.object.castShadow, record.castShadow);
    const material = record.material as THREE.MeshStandardMaterial;
    assert.equal(material.opacity, 0.67);
    assert.equal(material.transparent, true);
    assert.equal(material.depthWrite, true);
  }
  view.setActive(false);
  for (const record of original)
    assert.equal(record.object.visible, record.visible);
});

test("重复开关、重复进入、卸载清理可恢复本次进入前状态，不累计资源", () => {
  const root = makeInspectionFixture();
  const original = root.children.slice();
  const view = createInternalDriveInspection(root);
  const fuselage = root.getObjectByName("Fuselage")!;
  for (let i = 0; i < 40; i++) {
    fuselage.visible = i % 2 === 0;
    const before = root.children.map((object) => object.visible);
    view.setActive(true);
    view.setActive(true);
    if (i % 2) view.dispose();
    else view.setActive(false);
    view.setActive(false);
    assert.deepEqual(
      root.children.map((object) => object.visible),
      before,
    );
    assert.deepEqual(root.children, original);
  }
});

test("可选外壳节点缺失不影响关闭与卸载", () => {
  const root = new THREE.Group();
  const view = createInternalDriveInspection(root);
  assert.doesNotThrow(() => {
    view.setActive(true);
    view.setActive(false);
    view.dispose();
  });
});

test("内部驱动取景包含固定执行器、横梁和双侧连杆且不改变输入包围盒", () => {
  const internal = new THREE.Box3(
    new THREE.Vector3(-0.8, 0.3, -2.5),
    new THREE.Vector3(0.8, 0.9, -0.2),
  );
  const joints = {
    L: new THREE.Box3(
      new THREE.Vector3(-2.1, 0.1, -1.8),
      new THREE.Vector3(-0.5, 1.4, 1.6),
    ),
    R: new THREE.Box3(
      new THREE.Vector3(0.5, 0.1, -1.8),
      new THREE.Vector3(2.1, 1.4, 1.6),
    ),
  };
  const before = [internal, joints.L, joints.R].map((box) => box.clone());
  for (const aspect of [0.5, 0.8, 1.5, 2.5]) {
    const frame = getInternalDriveInspectionFrame(internal, joints, aspect)!;
    assert.ok(frame);
    const camera = new THREE.PerspectiveCamera(39, aspect, 0.002, 4000);
    applyCameraFrame(camera, frame, aspect);
    for (const box of [internal, joints.L, joints.R]) {
      for (const corner of boxCorners(box)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) < 0.8);
        assert.ok(Math.abs(corner.y) < 0.8);
        assert.ok(Math.abs(corner.z) < 1);
      }
    }
    assert.deepEqual([internal, joints.L, joints.R], before);
    assert.deepEqual(
      getInternalDriveInspectionFrame(internal, joints, aspect),
      frame,
    );
  }
  assert.equal(
    getInternalDriveInspectionFrame(
      new THREE.Box3(),
      { L: new THREE.Box3(), R: new THREE.Box3() },
      1,
    ),
    null,
  );
});

test("真实GLB在内部视图下继续同源联动，关闭后所有显示与材质属性原样恢复", async () => {
  const { rig } = await loadRuntimeRig();
  const { rig: baseline } = await loadRuntimeRig();
  assert.ok(rig.scene.getObjectByName("Drive_Crossbeam"));
  const view = createInternalDriveInspection(rig.scene);
  for (const name of INTERNAL_DRIVE_SHELL_NAMES)
    assert.ok(
      rig.scene.getObjectByName(name),
      `真实运行GLB须存在外壳节点 ${name}`,
    );
  const before = new Map<
    THREE.Object3D,
    { visible: boolean; material: unknown }
  >();
  rig.scene.traverse((object) => {
    before.set(object, {
      visible: object.visible,
      material: object instanceof THREE.Mesh ? object.material : null,
    });
  });
  for (const progress of [0, 0.125, 0.5, 0.875, 1, 0.5, 0]) {
    view.setActive(true);
    for (const name of INTERNAL_DRIVE_SHELL_NAMES)
      assert.equal(rig.scene.getObjectByName(name)!.visible, false, name);
    applyModelPose(rig, progress);
    applyModelPose(baseline, progress);
    rig.scene.traverse((object) => {
      const peer = baseline.scene.getObjectByName(object.name);
      assert.ok(peer, object.name);
      assert.ok(object.position.distanceTo(peer.position) < 1e-12);
      assert.deepEqual(
        object.quaternion.toArray(),
        peer.quaternion.toArray(),
        object.name,
      );
      assert.ok(object.scale.distanceTo(peer.scale) < 1e-12);
      if (
        /^(Drive_|Brace|Root|Wing|Fixed_root|Composite_wing)/.test(
          object.name,
        ) &&
        !INTERNAL_DRIVE_SHELL_NAMES.some((name) => name === object.name)
      )
        assert.equal(object.visible, peer.visible);
    });
    view.setActive(false);
    for (const [object, record] of before) {
      assert.equal(object.visible, record.visible, object.name);
      if (object instanceof THREE.Mesh)
        assert.equal(object.material, record.material, object.name);
    }
  }
});

test("真实全行程包围盒给内部驱动固定取景，运动中无需每帧重新测量", async () => {
  const { rig } = await loadRuntimeRig();
  const measurements = measureModelRig(rig);
  assert.ok(!measurements.internalDriveBounds.isEmpty());
  for (const aspect of [0.55, 1.5, 2.6]) {
    const frame = getInternalDriveInspectionFrame(
      measurements.internalDriveBounds,
      measurements.jointBounds,
      aspect,
    )!;
    const camera = new THREE.PerspectiveCamera(39, aspect, 0.002, 4000);
    applyCameraFrame(camera, frame, aspect);
    for (const box of [
      measurements.internalDriveBounds,
      measurements.jointBounds.L,
      measurements.jointBounds.R,
    ]) {
      for (const corner of boxCorners(box)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) < 0.8);
        assert.ok(Math.abs(corner.y) < 0.8);
      }
    }
  }
});

test("中文面板明确传动路径、概念布局边界与可恢复出口", () => {
  const markup = renderToStaticMarkup(
    createElement(InternalDrivePanel, {
      progress: 0.375,
      external: false,
      onClose: () => {},
    }),
  );
  for (const text of [
    "内部驱动检查",
    "38",
    "电机 / 减速箱",
    "丝杠",
    "中央横梁",
    "左右连杆",
    "内部布局为概念重建",
    "关闭内部驱动并恢复外壳",
    "展开、收拢或进度滑块",
  ])
    assert.ok(markup.includes(text), text);
});

test("外部模式面板只引导观察，不提供覆盖Python控制的操作", () => {
  const markup = renderToStaticMarkup(
    createElement(InternalDrivePanel, {
      progress: 0.5,
      external: true,
      onClose: () => {},
    }),
  );
  assert.ok(markup.includes("随 Python 输入联动"));
  assert.ok(markup.includes("不改变仿真"));
  assert.ok(!markup.includes('type="range"'));
  assert.ok(!markup.includes("展开、收拢或进度滑块"));
});
