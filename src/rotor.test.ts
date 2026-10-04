import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  createModelRig,
  applyModelPose,
  applyMotorPose,
  measureModelRig,
} from "./rig";

import { MOTOR_IDS, newMotorCommands, newMotorStates } from "./motors";

import {
  principalAxes,
  surfacePrincipalFrame,
} from "../qa/lib/runtime-geometry.mts";

async function loadModel() {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  return (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      )
  ).scene;
}

function meshVertices(object: THREE.Object3D) {
  const result: THREE.Vector3[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const vertices = child.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++)
      result.push(
        new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(child.matrixWorld),
      );
  });
  assert.ok(result.length > 0, `${object.name} 必须有真实网格`);
  return result;
}

const centroid = (points: THREE.Vector3[]) =>
  points
    .reduce((center, point) => center.add(point), new THREE.Vector3())
    .divideScalar(points.length);

function rotorGeometry(scene: THREE.Object3D, suffix: string) {
  const prop = scene.getObjectByName(`Prop_${suffix}`)!;
  const spinner = scene.getObjectByName(`Spinner_${suffix}`)!;
  const cowl = scene.getObjectByName(`Motor_cowl_${suffix}`)!;
  const nacelle = scene.getObjectByName(`Nacelle_${suffix}`)!;
  const spindle = scene.getObjectByName(`Motor_spindle_${suffix}`)!;
  assert.ok(
    prop && spinner && cowl && nacelle && spindle,
    `缺少动力组件 ${suffix}`,
  );
  // 真实盲孔的布尔三角化不均匀，必须对表面面积积分，不能给每个网格顶点等权。
  const frame = surfacePrincipalFrame(spinner);
  const axis = frame.axes[0].direction;
  const driveOrigin = prop.getWorldPosition(new THREE.Vector3());
  const offset = frame.center.clone().sub(driveOrigin);
  assert.ok(
    offset.clone().cross(axis).length() < 2e-5,
    `${suffix} 真实桨帽轴线必须与驱动原点同心`,
  );
  const axialExtents = meshVertices(spinner).map((point) =>
    point.clone().sub(driveOrigin).dot(axis),
  );
  assert.ok(
    Math.min(...axialExtents) < 0 && Math.max(...axialExtents) > 0,
    `${suffix} 驱动原点必须位于实际桨帽轴向范围内`,
  );
  // 桨盘参考平面仍取原驱动原点；只把实际桨帽轴线投影到该平面，不用盲孔表面质心改定义。
  const hub = frame.center.clone().addScaledVector(axis, -offset.dot(axis));
  const spindlePoints = meshVertices(spindle);
  const spindleAxis = principalAxes(spindlePoints)[2].direction;
  assert.ok(
    Math.abs(axis.dot(spindleAxis)) > 1 - 1e-7,
    `${suffix} 桨毂法向必须平行实际金属电机轴`,
  );
  assert.ok(
    centroid(spindlePoints).sub(hub).cross(axis).length() < 2e-5,
    `${suffix} 桨毂必须与实体电机轴同心`,
  );
  const cowlPoints = meshVertices(cowl);
  const cowlAxis = principalAxes(cowlPoints)[2].direction;
  const podAxis = principalAxes(meshVertices(nacelle))[2].direction;
  assert.ok(
    Math.abs(axis.dot(cowlAxis)) > 0.999,
    `${suffix} 桨毂与电机罩不共轴`,
  );
  assert.ok(
    Math.abs(axis.dot(podAxis)) > 0.998,
    `${suffix} 桨毂与动力舱不共轴`,
  );
  assert.ok(hub.distanceTo(prop.getWorldPosition(new THREE.Vector3())) < 2e-5);
  assert.ok(
    centroid(cowlPoints).sub(hub).cross(axis).length() < 0.01,
    `${suffix} 桨毂必须居中在电机罩截面，不只对齐空节点`,
  );
  return { prop, hub, axis };
}

function spanCenters(
  blade: THREE.Object3D,
  hub: THREE.Vector3,
  axis: THREE.Vector3,
) {
  const points = meshVertices(blade);
  const center = centroid(points);
  const radial = center
    .clone()
    .sub(hub)
    .addScaledVector(axis, -center.clone().sub(hub).dot(axis))
    .normalize();
  const radii = points.map((point) => point.clone().sub(hub).dot(radial));
  const min = Math.min(...radii);
  const max = Math.max(...radii);
  const root = centroid(points.filter((_, i) => radii[i] <= min + 0.012));
  const tip = centroid(points.filter((_, i) => radii[i] >= max - 0.012));
  return { root, tip, points };
}

const suffixes = ["L_Front", "L_Rear", "R_Front", "R_Rear"];

test("实际网格的八片桨叶展向垂直电机轴，保留真实桨距和厚度", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  applyModelPose(rig, 0, false, 2, 1);
  let maxAxialSlope = 0;
  for (let step = 0; step <= 100; step++) {
    const progress = step / 100;
    applyModelPose(rig, progress, false, 0.037, 1);
    for (const suffix of suffixes) {
      const { hub, axis } = rotorGeometry(scene, suffix);
      for (const leaf of ["A", "B"]) {
        const blade = scene.getObjectByName(`Blade_${suffix}_${leaf}`)!;
        const { root, tip, points } = spanCenters(blade, hub, axis);
        const span = tip.clone().sub(root);
        const axialSlope = Math.abs(span.dot(axis)) / span.length();
        maxAxialSlope = Math.max(maxAxialSlope, axialSlope);
        assert.ok(
          axialSlope < Math.sin(THREE.MathUtils.degToRad(0.6)),
          `${suffix}_${leaf} @ ${progress} 展向偏离旋转平面 ${THREE.MathUtils.radToDeg(Math.asin(axialSlope))}°`,
        );
        const axial = points.map((point) => point.clone().sub(hub).dot(axis));
        assert.ok(
          Math.max(...axial) - Math.min(...axial) < 0.06,
          "不得以沿展向弯曲模拟停桨贴舱",
        );
        assert.ok(
          Math.max(...axial) - Math.min(...axial) > 0.001,
          "桨叶不能压成零厚度平面",
        );
      }
    }
  }
  assert.ok(maxAxialSlope < 0.011);
});

test("任意旋转相位和整翼状态下桨尖扫掠圆面法向与真实电机轴平行", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  for (const progress of [0, 0.17, 0.49, 0.74, 0.9, 1]) {
    for (const suffix of suffixes) {
      const prop = rig.props.find(
        ({ object }) => object.name === `Prop_${suffix}`,
      )!;
      const track: THREE.Vector3[] = [];
      let referenceHub: THREE.Vector3 | undefined;
      let referenceAxis: THREE.Vector3 | undefined;
      for (let step = 0; step < 32; step++) {
        prop.motor.fold = 0;
        prop.motor.phase = (step * Math.PI * 2) / 32;
        applyModelPose(rig, progress);
        const { hub, axis } = rotorGeometry(scene, suffix);
        referenceHub ??= hub;
        referenceAxis ??= axis;
        assert.ok(hub.distanceTo(referenceHub) < 2e-5, "桨毂绕轴偏心");
        assert.ok(
          Math.abs(axis.dot(referenceAxis)) > 1 - 1e-8,
          "旋转不能使主轴摆动",
        );
        const blade = scene.getObjectByName(`Blade_${suffix}_A`)!;
        track.push(spanCenters(blade, hub, axis).tip);
      }
      const diskNormal = principalAxes(track)[0].direction;
      assert.ok(Math.abs(diskNormal.dot(referenceAxis!)) > 1 - 1e-7);
      const center = centroid(track);
      const offset = center.sub(referenceHub!);
      assert.ok(
        offset.clone().cross(referenceAxis!).length() < 2e-5,
        "扫掠圆必须围绕电机轴",
      );
      const radii = track.map((point) =>
        point.clone().sub(referenceHub!).cross(referenceAxis!).length(),
      );
      assert.ok(
        Math.max(...radii) - Math.min(...radii) < 3e-5,
        "任意相位不得改变桨尖半径",
      );
    }
  }
});

function makeRotatedMotorScene() {
  const scene = new THREE.Group();
  scene.rotation.set(0.24, -0.38, 0.71);
  scene.position.set(-2, 1, 4);
  const motor = new THREE.Group();
  motor.rotation.set(0.81, 0.37, -0.21);
  scene.add(motor);
  const prop = new THREE.Group();
  prop.name = "Prop_L_Front";
  prop.position.set(0.3, -0.2, 0.7);
  prop.rotation.set(-0.73, 0.44, 0.58);
  motor.add(prop);
  const localAxis = new THREE.Vector3(0.3, 0.7, -0.5).normalize();
  for (const [label, amount] of [
    ["Start", -0.2],
    ["End", 0.2],
  ] as const) {
    const marker = new THREE.Object3D();
    marker.name = `MotorAxis${label}_L_Front`;
    marker.position
      .copy(localAxis)
      .multiplyScalar(amount)
      .applyQuaternion(prop.quaternion)
      .add(prop.position);
    motor.add(marker);
  }
  return { scene, prop, localAxis };
}

test("运行时从独立电机轴端点推导自转轴，不依赖局部 Y 或机翼/世界轴", () => {
  const { scene, prop, localAxis } = makeRotatedMotorScene();
  const rig = createModelRig(scene);
  assert.ok(rig.props[0].axis.distanceTo(localAxis) < 1e-10);
  const origin = prop.getWorldPosition(new THREE.Vector3());
  const tip = prop.localToWorld(localAxis.clone());
  const referenceAxis = tip.sub(origin).normalize();
  for (let i = 0; i < 1000; i++) {
    applyModelPose(rig, (i % 101) / 100, false, 0.013, 1);
    const actual = prop
      .localToWorld(localAxis.clone())
      .sub(prop.getWorldPosition(new THREE.Vector3()))
      .normalize();
    assert.ok(actual.distanceTo(referenceAxis) < 1e-10);
    assert.ok(Math.abs(prop.quaternion.length() - 1) < 1e-12);
  }
});

test("四机在任意翼角独立启动与停机，必须完全展开后转动、归零后折叠", async () => {
  const rig = createModelRig(await loadModel());
  const commands = newMotorCommands();
  for (const id of MOTOR_IDS) {
    applyMotorPose(rig, newMotorStates());
    commands[id] = { targetRpm: 1800, enabled: true };
    for (let i = 0; i < 200; i++) {
      applyModelPose(rig, (i % 101) / 100, false, 0.02, commands);
      for (const prop of rig.props) {
        if (prop.id !== id) assert.equal(prop.motor.fold, 1);
        if (prop.motor.rpm > 0) assert.equal(prop.motor.fold, 0);
      }
    }
    assert.equal(rig.props.find((prop) => prop.id === id)!.motor.rpm, 1800);
    commands[id] = { targetRpm: 0, enabled: false };
    for (let i = 0; i < 240; i++) {
      applyModelPose(rig, 1 - (i % 101) / 100, false, 0.02, commands);
      const motor = rig.props.find((prop) => prop.id === id)!.motor;
      if (motor.fold > 0) {
        assert.equal(motor.rpm, 0);
        assert.equal(motor.phase, 0);
      }
    }
    assert.equal(rig.props.find((prop) => prop.id === id)!.motor.fold, 1);
  }
});

test("缺失或偏心的轴线标记明确拒绝，不会静默改为世界轴旋转", () => {
  const { scene } = makeRotatedMotorScene();
  const end = scene.getObjectByName("MotorAxisEnd_L_Front")!;
  end.position.x += 1;
  assert.throws(() => createModelRig(scene), /偏离电机轴线/);
  end.removeFromParent();
  assert.throws(() => createModelRig(scene), /缺少独立电机轴线/);
});

test("取景范围包含所有活动桨的完整扫掠盘，静态折叠首帧保持近景", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const { bounds, groundOffset, foldedBounds } = measureModelRig(rig);
  const ground = new THREE.Vector3(0, groundOffset, 0);
  assert.ok(
    foldedBounds.getSize(new THREE.Vector3()).x <
      bounds.getSize(new THREE.Vector3()).x * 0.45,
  );
  for (let step = 0; step <= 40; step++) {
    for (let phase = 0; phase < 16; phase++) {
      for (const prop of rig.props) {
        prop.motor.fold = 0;
        prop.motor.phase = (phase * Math.PI) / 8;
      }
      applyModelPose(rig, step / 40);
      const actual = new THREE.Box3().setFromObject(scene).translate(ground);
      assert.ok(
        bounds.clone().expandByScalar(1e-5).containsBox(actual),
        `旋桨取景遗漏 @ ${step / 40}, phase ${phase}`,
      );
    }
  }
});

test("飞行旋桨后手动跳转、反向、暂停与拆解复装保持整套桨毂和折叶一致", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const route = [
    0, 0.53, 0.79, 0.77, 1, 0.92, 0.84, 0.8, 0.74, 0.3, 0.84, 0.86, 0.1, 1, 0,
  ];
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const progress of route) {
      applyModelPose(rig, progress, false, 0.041, 1);
      for (const suffix of suffixes) rotorGeometry(scene, suffix);
      for (const prop of rig.props) {
        const expected = prop.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              prop.axis,
              prop.spinSign * prop.phase,
            ),
          );
        assert.ok(prop.object.quaternion.angleTo(expected) < 1e-7);
        if (prop.motor.fold > 0) {
          assert.equal(prop.motor.rpm, 0, "任意机位收桨时不得旋转");
          assert.equal(prop.motor.phase, 0, "收桨必须归零");
        }
      }
      const transforms = [...rig.props, ...rig.blades].map(({ object }) =>
        object.quaternion.clone(),
      );
      for (let frame = 0; frame < 5; frame++) applyModelPose(rig, progress);
      [...rig.props, ...rig.blades].forEach(({ object }, i) =>
        assert.ok(
          object.quaternion.angleTo(transforms[i]) < 1e-7,
          "暂停不得继续自转或重复寻位",
        ),
      );
      applyModelPose(rig, progress, true);
      applyModelPose(rig, progress);
      [...rig.props, ...rig.blades].forEach(({ object }, i) =>
        assert.ok(
          object.quaternion.angleTo(transforms[i]) < 1e-7,
          "拆解复装不得改变桨系相位",
        ),
      );
    }
  }
});

test("四桨停桨收拢姿态的真实叶片顶点不进入自身动力舱或电机罩", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  const doubleSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const ray = new THREE.Raycaster();
  for (const progress of [0.95, 0.97, 0.985, 0.995, 0.999, 1]) {
    applyModelPose(rig, progress);
    for (const suffix of suffixes) {
      const { hub, axis } = rotorGeometry(scene, suffix);
      const surfaces: THREE.Mesh[] = [];
      for (const prefix of ["Nacelle", "Motor_cowl"]) {
        scene.getObjectByName(`${prefix}_${suffix}`)!.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const surface = new THREE.Mesh(object.geometry, doubleSided);
          surface.matrixWorld.copy(object.matrixWorld);
          surfaces.push(surface);
        });
      }
      for (const leaf of ["A", "B"]) {
        const blade = scene.getObjectByName(`Blade_${suffix}_${leaf}`)!;
        for (const point of meshVertices(blade)) {
          const radial = point.clone().sub(hub);
          radial.addScaledVector(axis, -radial.dot(axis)).normalize();
          ray.set(point, radial);
          // 这些回转壳体的径向截面为凸形；从叶片点沿外径仍击中壳面，说明点在壳内。
          // 这是顶点穿入回归；完整三角形接触仍由独立 SAT 检查负责。
          const exits = ray.intersectObjects(surfaces, false);
          assert.ok(
            exits.every(({ distance }) => distance < 1e-6),
            `${suffix}_${leaf} @ ${progress} 折叠叶片进入自身舱体`,
          );
        }
      }
    }
  }
  doubleSided.dispose();
});

test("折叶穿入检查能拒绝人为缩小铰点半径的错误几何", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  scene.getObjectByName("BladeFold_L_Rear_A")!.position.x = -0.1;
  applyModelPose(rig, 1);
  const { hub, axis } = rotorGeometry(scene, "L_Rear");
  const original = scene.getObjectByName("Nacelle_L_Rear") as THREE.Mesh;
  assert.ok(original instanceof THREE.Mesh);
  const doubleSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const pod = new THREE.Mesh(original.geometry, doubleSided);
  pod.matrixWorld.copy(original.matrixWorld);
  const ray = new THREE.Raycaster();
  const penetrations = meshVertices(
    scene.getObjectByName("Blade_L_Rear_A")!,
  ).filter((point) => {
    const radial = point.clone().sub(hub);
    radial.addScaledVector(axis, -radial.dot(axis)).normalize();
    ray.set(point, radial);
    return ray
      .intersectObject(pod, false)
      .some(({ distance }) => distance > 1e-6);
  });
  assert.ok(penetrations.length > 0, "回归检查必须能识别实际穿入，不能假通过");
  doubleSided.dispose();
});

test("面积二阶矩轴估计不随局部重剖分或重复共点改变", () => {
  const base = new THREE.BoxGeometry(2, 0.4, 1).toNonIndexed();
  const positions = base.getAttribute("position");
  const rebuilt: number[] = [];
  function appendTriangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    depth: number,
  ) {
    if (!depth) {
      rebuilt.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      return;
    }
    const ab = a.clone().add(b).multiplyScalar(0.5);
    const bc = b.clone().add(c).multiplyScalar(0.5);
    const ca = c.clone().add(a).multiplyScalar(0.5);
    appendTriangle(a, ab, ca, depth - 1);
    appendTriangle(ab, b, bc, depth - 1);
    appendTriangle(ca, bc, c, depth - 1);
    appendTriangle(ab, bc, ca, depth - 1);
  }
  for (let i = 0; i < positions.count; i += 3) {
    const tri = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(positions, i + j),
    );
    appendTriangle(tri[0], tri[1], tri[2], i === 0 ? 4 : 0);
  }
  const repeated = new THREE.Vector3().fromBufferAttribute(positions, 0);
  for (let i = 0; i < 50; i++)
    for (let j = 0; j < 3; j++) rebuilt.push(...repeated.toArray());
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(rebuilt, 3),
  );
  const a = new THREE.Mesh(base),
    b = new THREE.Mesh(geometry);
  for (const object of [a, b]) {
    object.position.set(3, -2, 7);
    object.rotation.set(0.37, -0.28, 0.61);
    object.updateMatrixWorld(true);
  }
  const before = surfacePrincipalFrame(a),
    after = surfacePrincipalFrame(b);
  before.axes.forEach((axis, i) => {
    assert.ok(
      Math.abs(axis.value - after.axes[i].value) < 1e-9,
      "面积二阶矩不能受剖分密度影响",
    );
    assert.ok(
      1 - Math.abs(axis.direction.dot(after.axes[i].direction)) < 1e-12,
    );
  });
  assert.ok(before.center.distanceTo(after.center) < 1e-8);
  assert.ok(
    1 -
      Math.abs(
        principalAxes(meshVertices(a))[0].direction.dot(
          principalAxes(meshVertices(b))[0].direction,
        ),
      ) >
      1e-5,
    "故意不均匀采样应能暴露旧等权点PCA的缺陷",
  );
});

test("面积积分轴检查仍拒绝人为倾斜真实桨帽，不以容差放宽掩盖偏轴", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  applyModelPose(rig, 0);
  const spinner = scene.getObjectByName("Spinner_L_Front")!;
  const driveOrigin = scene
    .getObjectByName("Prop_L_Front")!
    .getWorldPosition(new THREE.Vector3());
  // 围绕真实驱动原点倾斜，避免压缩网格的局部原点使故障先变成偏心。
  const worldTilt = new THREE.Matrix4()
    .makeTranslation(driveOrigin.x, driveOrigin.y, driveOrigin.z)
    .multiply(new THREE.Matrix4().makeRotationX(0.02))
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -driveOrigin.x,
        -driveOrigin.y,
        -driveOrigin.z,
      ),
    );
  const tiltedLocal = spinner
    .parent!.matrixWorld.clone()
    .invert()
    .multiply(worldTilt)
    .multiply(spinner.matrixWorld);
  tiltedLocal.decompose(spinner.position, spinner.quaternion, spinner.scale);
  scene.updateMatrixWorld(true);
  assert.throws(
    () => rotorGeometry(scene, "L_Front"),
    /桨毂法向必须平行实际金属电机轴/,
  );
});
