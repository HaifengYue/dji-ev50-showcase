import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  createModelRig,
  applyModelPose,
  measureModelRig,
  GROUND_HEIGHT,
  getWingJoint,
  solveSpreaderZ,
} from "./rig";
import {
  boxCorners,
  getInspectionFrame,
  getPresentationFrame,
  getJointInspectionFrame,
  INSPECTION_VIEWS,
} from "./inspection";
import { getFlight, TOTAL } from "./flight";

async function loadModel() {
  const b = readFileSync(new URL("../public/models/xp4.glb", import.meta.url));
  return (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "")
  ).scene;
}

function makeLinkageScene() {
  const scene = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(5, 3, -2);
  parent.rotation.set(0.1, 0.9, -0.2);
  parent.add(scene);
  const spreader = new THREE.Group();
  spreader.name = "BraceSpreader";
  spreader.position.set(0, -0.5, -3);
  scene.add(spreader);
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.name = `WingPivot_${side}`;
    pivot.position.set(sign * 0.5, 0.8, 0.2);
    const body = new THREE.Object3D();
    body.name = `BraceBody_${side}`;
    body.position.set(sign * 0.2, 0, 0);
    spreader.add(body);
    const wing = new THREE.Object3D();
    wing.name = `BraceWing_${side}`;
    wing.position.set(sign * 0.35, -0.15, -0.12);
    pivot.add(wing);
    const rod = new THREE.Object3D();
    rod.name = `BraceRod_${side}`;
    scene.add(pivot, rod);
  }
  parent.updateMatrixWorld(true);
  return scene;
}

function assertLinkageClosed(
  rig: ReturnType<typeof createModelRig>,
  tolerance = 1e-6,
) {
  for (const { rod, body, wing, length } of rig.braces) {
    const start = body.getWorldPosition(new THREE.Vector3());
    const end = wing.getWorldPosition(new THREE.Vector3());
    assert.ok(
      rod.localToWorld(new THREE.Vector3()).distanceTo(start) < tolerance,
    );
    assert.ok(
      rod.localToWorld(new THREE.Vector3(0, length, 0)).distanceTo(end) <
        tolerance,
    );
    const localStart = rod.parent!.worldToLocal(start.clone());
    const localEnd = rod.parent!.worldToLocal(end.clone());
    assert.ok(Math.abs(localStart.distanceTo(localEnd) - length) < tolerance);
    assert.ok(rod.scale.equals(new THREE.Vector3(1, 1, 1)));
  }
}

function linkageSnapshot(rig: ReturnType<typeof createModelRig>) {
  return [
    rig.spreader!.object,
    ...rig.braces.flatMap(({ body, wing, rod }) => [body, wing, rod]),
  ].map((object) => ({
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  }));
}

function assertSameLinkage(
  actual: ReturnType<typeof linkageSnapshot>,
  expected: ReturnType<typeof linkageSnapshot>,
) {
  actual.forEach((pose, i) => {
    assert.ok(pose.position.distanceTo(expected[i].position) < 1e-10);
    assert.ok(
      1 - Math.abs(pose.quaternion.dot(expected[i].quaternion)) < 1e-12,
    );
    assert.ok(pose.scale.equals(expected[i].scale));
  });
}

function assertEyeFrame(
  rig: ReturnType<typeof createModelRig>,
  tolerance = 1e-9,
) {
  for (const { rod, body, wing } of rig.braces) {
    const inverseParent = rod.parent!.matrixWorld.clone().invert();
    const start = body
      .getWorldPosition(new THREE.Vector3())
      .applyMatrix4(inverseParent);
    const end = wing
      .getWorldPosition(new THREE.Vector3())
      .applyMatrix4(inverseParent);
    const longitudinal = end.clone().sub(start).normalize();
    const wingStud = new THREE.Vector3(0, 1, 0)
      .applyMatrix4(wing.matrixWorld)
      .applyMatrix4(inverseParent)
      .sub(end)
      .normalize();
    const expectedNormal = wingStud
      .clone()
      .addScaledVector(longitudinal, -wingStud.dot(longitudinal))
      .normalize();
    const actualNormal = new THREE.Vector3(0, 0, -1).applyQuaternion(
      rod.quaternion,
    );
    const actualLongitudinal = new THREE.Vector3(0, 1, 0).applyQuaternion(
      rod.quaternion,
    );
    assert.ok(
      actualNormal.distanceTo(expectedNormal) < tolerance,
      "杆眼法向应对齐翼端销轴的截面投影",
    );
    assert.ok(
      actualLongitudinal.distanceTo(longitudinal) < tolerance,
      "修正杆眼滚转不能偏转连杆轴线",
    );
    assert.ok(Math.abs(actualNormal.dot(actualLongitudinal)) < tolerance);
    assert.ok(Math.abs(rod.quaternion.length() - 1) < tolerance);
  }
}

test("偏轴翼端驱动共用滑架和刚性连杆，世界坐标变换不破坏两端闭合", () => {
  const rig = createModelRig(makeLinkageScene());
  assert.equal(rig.braces.length, 2);
  applyModelPose(rig, 0);
  const initial = linkageSnapshot(rig);
  const initialRods = rig.braces.map(({ rod }) => rod.quaternion.clone());
  for (let i = 0; i <= 100; i++) {
    applyModelPose(rig, i / 100);
    assertLinkageClosed(rig, 1e-9);
  }
  assert.ok(
    Math.abs(rig.spreader!.object.position.z - initial[0].position.z) > 0.05,
  );
  rig.braces.forEach(({ rod }, i) =>
    assert.ok(rod.quaternion.angleTo(initialRods[i]) > 0.05),
  );
  applyModelPose(rig, 0);
  assertSameLinkage(linkageSnapshot(rig), initial);
});

test("杆眼滚转由翼端销轴决定，任意姿态和往返都保持同一正交基", () => {
  const rig = createModelRig(makeLinkageScene());
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i <= 200; i++) {
      const progress = cycle % 2 ? 1 - i / 200 : i / 200;
      applyModelPose(rig, progress);
      assertLinkageClosed(rig);
      assertEyeFrame(rig);
    }
  }
});

test("拆解保持当前连杆和滑架原长原位，复装后恢复真实连接", () => {
  const rig = createModelRig(makeLinkageScene());
  for (const progress of [0, 0.19, 0.5, 0.83, 1, 0.4, 0]) {
    applyModelPose(rig, progress);
    const assembled = linkageSnapshot(rig);
    const ends = rig.braces.map(({ wing }) =>
      wing.getWorldPosition(new THREE.Vector3()),
    );
    applyModelPose(rig, progress, true);
    assertSameLinkage(linkageSnapshot(rig), assembled);
    rig.braces.forEach(({ rod, wing, length }, i) => {
      assert.ok(
        rod.localToWorld(new THREE.Vector3(0, length, 0)).distanceTo(ends[i]) <
          1e-9,
      );
      assert.ok(
        Math.abs(
          wing.getWorldPosition(new THREE.Vector3()).distanceTo(ends[i]) - 1.4,
        ) < 1e-9,
      );
    });
    applyModelPose(rig, progress);
    assertSameLinkage(linkageSnapshot(rig), assembled);
    assertLinkageClosed(rig, 1e-9);
  }
});

test("飞行位移、航向、侧倾和父级缩放不影响机体局部滑架求解", () => {
  const reference = createModelRig(makeLinkageScene());
  const actual = createModelRig(makeLinkageScene());
  const parent = actual.scene.parent!;
  for (const scale of [
    new THREE.Vector3(1.7, 1.7, 1.7),
    new THREE.Vector3(1.2, 0.8, 1.6),
  ]) {
    parent.scale.copy(scale);
    for (const progress of [0, 0.3, 1, 0.6, 0.6, 0.1, 0]) {
      parent.position.set(2 + progress * 7, 3 - progress, -8 + progress * 5);
      parent.rotation.set(0.11, 1.2 - progress * 2, progress * 0.42);
      parent.updateMatrixWorld(true);
      applyModelPose(reference, progress);
      applyModelPose(actual, progress, true);
      applyModelPose(actual, progress);
      assertLinkageClosed(actual, 1e-9);
      assertEyeFrame(actual);
      assertSameLinkage(linkageSnapshot(actual), linkageSnapshot(reference));
    }
  }
});

test("不可闭合的刚性杆明确报错，不以缩放或静止端点掩盖", () => {
  assert.throws(
    () => solveSpreaderZ(new THREE.Vector3(2, 0, 0), new THREE.Vector3(), 1),
    /长度不足/,
  );
  const scene = makeLinkageScene();
  scene.remove(scene.getObjectByName("BraceSpreader")!);
  // 保留明确命名的锚点时，缺失滑架必须被识别为不兼容模型。
  for (const side of ["L", "R"]) {
    const body = new THREE.Object3D();
    body.name = `BraceBody_${side}`;
    scene.add(body);
  }
  assert.throws(() => createModelRig(scene), /缺少共用滑架/);
});

test("待命起落支点精确接地且所有转换姿态完整落在测量范围", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const { bounds, groundOffset } = measureModelRig(rig);
  const actualHover = new THREE.Box3().setFromObject(scene);
  assert.ok(Math.abs(actualHover.min.y + groundOffset - GROUND_HEIGHT) < 1e-8);
  for (let i = 0; i <= 100; i++) {
    applyModelPose(rig, i / 100);
    const actual = new THREE.Box3()
      .setFromObject(scene)
      .translate(new THREE.Vector3(0, groundOffset, 0));
    assert.ok(bounds.clone().expandByScalar(0.01).containsBox(actual));
  }
});

test("最终压缩模型全部转换形态在四个正交检查视角内均不裁切", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const { bounds, groundOffset } = measureModelRig(rig);
  for (const aspect of [0.55, 1.5, 2.3]) {
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
      for (let i = 0; i <= 20; i++) {
        applyModelPose(rig, i / 20);
        const actual = new THREE.Box3()
          .setFromObject(scene)
          .translate(new THREE.Vector3(0, groundOffset, 0));
        for (const corner of boxCorners(actual)) {
          corner.project(camera);
          assert.ok(Math.abs(corner.x) < 0.8, `${id}：机体横向裁切`);
          assert.ok(Math.abs(corner.y) < 0.8, `${id}：机体纵向裁切`);
          assert.ok(Math.abs(corner.z) < 1, `${id}：机体深度裁切`);
        }
      }
    }
  }
});

test("暂停不继续旋桨且重复手动切换形态不会积累翼面旋转", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  applyModelPose(rig, 0.5, false, 0.1, 1);
  const expected = rig.props.map(({ object }) => object.quaternion.clone());
  for (let i = 0; i < 20; i++) applyModelPose(rig, 0.5);
  rig.props.forEach(({ object }, i) =>
    assert.ok(object.quaternion.angleTo(expected[i]) < 1e-7),
  );
  applyModelPose(rig, 0);
  rig.wings.forEach(({ rest }) =>
    assert.ok(rest && rest.object.quaternion.angleTo(rest.quaternion) < 1e-7),
  );
});

test("压缩模型保留独立刚性连杆控制节点且真实偏轴端点连续移动", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  assert.equal(rig.braces.length, 2);
  assert.ok(rig.spreader);
  const starts = rig.braces.map(({ rod, wing, side }) => {
    assert.equal(
      rod instanceof THREE.Mesh,
      false,
      "连杆控制节点不能被量化变换覆盖",
    );
    let count = 0;
    rod.traverse((child) => {
      if (child instanceof THREE.Mesh) count++;
    });
    assert.ok(count > 0, "连杆控制节点下必须存在可见网格");
    const axis = rig.wings.find((item) => item.name.endsWith(side))!.axis;
    const radial = wing.position
      .clone()
      .applyQuaternion(wing.parent!.quaternion);
    radial.addScaledVector(axis, -radial.dot(axis));
    assert.ok(radial.length() > 0.05, "翼端接头不能仍位于静止铰轴上");
    return {
      position: rod.position.clone(),
      quaternion: rod.quaternion.clone(),
      endpoint: wing.getWorldPosition(new THREE.Vector3()),
    };
  });
  for (let i = 0; i <= 100; i++) {
    applyModelPose(rig, i / 100);
    assertLinkageClosed(rig);
  }
  rig.braces.forEach(({ rod, wing }, i) => {
    assert.ok(
      rod.position.distanceTo(starts[i].position) > 0.05,
      "连杆机身端应随滑架移动",
    );
    assert.ok(
      rod.quaternion.angleTo(starts[i].quaternion) >
        THREE.MathUtils.degToRad(3),
      "连杆必须有可见摆动",
    );
    assert.ok(
      wing
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(starts[i].endpoint) > 0.05,
      "翼端应实际随翼面位移",
    );
  });
});

test("实际连杆在暂停、往返、任意跳转、拆解复装后都由当前进度唯一确定", async () => {
  const rig = createModelRig(await loadModel());
  const references = new Map<number, ReturnType<typeof linkageSnapshot>>();
  for (const progress of [0, 0.13, 0.5, 0.89, 1]) {
    applyModelPose(rig, progress);
    references.set(progress, linkageSnapshot(rig));
  }
  for (let cycle = 0; cycle < 12; cycle++) {
    for (const progress of [0, 0.5, 1, 0.89, 0.13, 0.5, 0.5, 0]) {
      applyModelPose(rig, progress, cycle % 2 === 1);
      applyModelPose(rig, progress);
      assertLinkageClosed(rig);
      assertSameLinkage(linkageSnapshot(rig), references.get(progress)!);
    }
  }
});

test("实际 GLB 在飞行父级位移、航向、侧倾及缩放下保持球头与杆眼连接", async () => {
  const scene = await loadModel();
  const reference = createModelRig(scene.clone(true));
  const parent = new THREE.Group();
  parent.add(scene);
  const rig = createModelRig(scene);
  for (const scale of [1, 1.7]) {
    parent.scale.setScalar(scale);
    for (const progress of [0, 0.13, 0.5, 1, 0.89, 0.5, 0.13, 0]) {
      parent.position.set(3 + progress, 2, -5 - 2 * progress);
      parent.rotation.set(0, -1.5 + 3 * progress, -0.2 + progress * 0.4);
      parent.updateMatrixWorld(true);
      applyModelPose(reference, progress);
      applyModelPose(rig, progress, true);
      applyModelPose(rig, progress);
      assertSameLinkage(linkageSnapshot(rig), linkageSnapshot(reference));
      assertLinkageClosed(rig, 2e-6);
      assertEyeFrame(rig);
      for (const side of ["L", "R"]) {
        for (const [ball, eye] of [
          ["Body", "Body"],
          ["Wing", "Root"],
        ]) {
          const ballNode = scene.getObjectByName(`BraceBall_${side}_${ball}`);
          const eyeNode = scene.getObjectByName(`BraceRodEye_${side}_${eye}`);
          assert.ok(ballNode && eyeNode, "缺少可见球头或杆眼");
          assert.ok(
            ballNode
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(eyeNode.getWorldPosition(new THREE.Vector3())) < 2e-6,
            `${side} ${ball} 球头与杆眼脱开`,
          );
        }
      }
    }
  }
});

test("折叠首帧与关节说明都源于实际模型，测量后恢复零展开", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const { foldedBounds, bounds, joints } = measureModelRig(rig);
  assert.ok(
    foldedBounds.getSize(new THREE.Vector3()).x <
      bounds.getSize(new THREE.Vector3()).x * 0.45,
  );
  for (const side of ["L", "R"] as const) {
    const joint = getWingJoint(rig, side)!;
    assert.ok(joint.position.distanceTo(joints[side]!.position) < 1e-10);
    assert.ok(Math.abs(joint.axis.length() - 1) < 1e-10);
    const wing = rig.wings.find((w) => w.name.endsWith(side))!;
    assert.ok(
      wing.rest!.object.quaternion.angleTo(wing.rest!.quaternion) < 1e-7,
    );
    assert.ok(Math.abs(joint.angle - (2 * Math.PI) / 3) < 1e-10);
  }
});

test("实际当前模型在折叠近景、完整飞行航迹和左右关节特写中取景稳定", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const measured = measureModelRig(rig);
  for (const aspect of [0.55, 1, 1.8, 2.6]) {
    const folded = getPresentationFrame(measured.foldedBounds, aspect);
    const camera = new THREE.PerspectiveCamera(39, aspect, 0.1, 180);
    camera.position.copy(folded.position);
    camera.lookAt(folded.target);
    camera.updateMatrixWorld(true);
    for (const corner of boxCorners(measured.foldedBounds)) {
      corner.project(camera);
      assert.ok(Math.abs(corner.x) < 0.8 && Math.abs(corner.y) < 0.8);
    }
    const flightFrame = getPresentationFrame(measured.bounds, aspect, true);
    camera.position.copy(flightFrame.position);
    camera.lookAt(flightFrame.target);
    camera.updateMatrixWorld(true);
    for (let time = 0; time <= TOTAL; time += 0.5) {
      const flight = getFlight(time);
      applyModelPose(rig, flight.unfold);
      const pose = new THREE.Matrix4().compose(
        new THREE.Vector3(
          flight.x,
          measured.groundOffset + flight.altitude * 0.32,
          flight.z,
        ),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, flight.yaw, flight.bank),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      const actual = new THREE.Box3().setFromObject(scene);
      for (const corner of boxCorners(actual)) {
        corner.applyMatrix4(pose).project(camera);
        assert.ok(Math.abs(corner.x) < 1, `${aspect} 横向飞行裁切 @ ${time}`);
        assert.ok(Math.abs(corner.y) < 1, `${aspect} 纵向飞行裁切 @ ${time}`);
      }
    }
    for (const side of ["L", "R"] as const) {
      const center = measured.joints[side]!.position.clone().add(
        new THREE.Vector3(0, measured.groundOffset, 0),
      );
      const frame = getJointInspectionFrame(
        center,
        side,
        aspect,
        measured.jointBounds[side],
      );
      const close = new THREE.OrthographicCamera(
        (-frame.height * aspect) / 2,
        (frame.height * aspect) / 2,
        frame.height / 2,
        -frame.height / 2,
        0.1,
        180,
      );
      close.position.copy(frame.position);
      close.lookAt(frame.target);
      close.updateMatrixWorld(true);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        applyModelPose(rig, progress);
        for (const name of [
          `RootHingeShaft_${side}`,
          `RootCarrierMoving_${side}`,
          `RootBearingFixed_${side}_Front`,
          `RootBearingFixed_${side}_Rear`,
          `BraceRod_${side}`,
          "BraceSpreader",
        ]) {
          const object = scene.getObjectByName(name);
          assert.ok(object, `缺少关节实体 ${name}`);
          const actual = new THREE.Box3()
            .setFromObject(object)
            .translate(new THREE.Vector3(0, measured.groundOffset, 0));
          for (const corner of boxCorners(actual)) {
            corner.project(close);
            assert.ok(
              Math.abs(corner.x) < 0.95 && Math.abs(corner.y) < 0.95,
              `${name} 特写裁切`,
            );
          }
        }
      }
    }
  }
});

test("从拆解转入关节特写不会继承上一帧机翼分离偏移", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const original = getWingJoint(rig, "R")!;
  applyModelPose(rig, 0.6, true);
  const fromExploded = getWingJoint(rig, "R")!;
  assert.ok(fromExploded.position.distanceTo(original.position) < 1e-10);
  assert.ok(fromExploded.axis.distanceTo(original.axis) < 1e-10);
});
