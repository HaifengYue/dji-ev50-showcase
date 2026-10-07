/** 对生产GLB的真实叶片顶点检查；不以四元数标签充当旋向证据。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig, applyModelPose, applyMotorPose } from "./rig";
import { MOTOR_IDS, newMotorStates, stepMotor } from "./motors";
const signs = { L_Front: -1, R_Front: 1, L_Rear: 1, R_Rear: -1 } as const;
async function model() {
  const b = readFileSync(
    process.env.QA_MODEL ??
      new URL("../public/models/xp4.glb", import.meta.url),
  );
  const g = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
  return createModelRig(g.scene);
}
function meshVertex(mesh: T.Mesh, index: number) {
  return new T.Vector3()
    .fromBufferAttribute(mesh.geometry.getAttribute("position"), index)
    .applyMatrix4(mesh.matrixWorld);
}

test("四桨正时间步的实际叶尖沿各自固定电机轴产生约定的有向转角", async () => {
  const rig = await model();
  const parent = new T.Group();
  parent.rotation.set(0.3, -0.4, 0.7);
  parent.position.set(2, 3, -5);
  parent.add(rig.scene);
  for (const wing of [0, 0.37, 0.65, 1]) {
    applyModelPose(rig, wing);
    const states = newMotorStates();
    for (const id of MOTOR_IDS)
      states[id] = {
        rpm: 900,
        phase: 0.2,
        fold: 0,
        stage: "running",
        requested: true,
      };
    applyMotorPose(rig, states);
    parent.updateMatrixWorld(true);
    const rows = rig.props.map((prop) => {
      assert.equal(prop.spinSign, signs[prop.id]);
      assert.equal(prop.object.userData.handedness, prop.spinSign);
      const blade = rig.scene.getObjectByName(`Blade_${prop.id}_B`) as T.Mesh;
      const pos = blade.geometry.getAttribute("position");
      let index = 0;
      for (let i = 1; i < pos.count; i++)
        if (pos.getX(i) > pos.getX(index)) index = i;
      const center = prop.object.getWorldPosition(new T.Vector3());
      const start = rig.scene
        .getObjectByName(`MotorAxisStart_${prop.id}`)!
        .getWorldPosition(new T.Vector3());
      const axis = rig.scene
        .getObjectByName(`MotorAxisEnd_${prop.id}`)!
        .getWorldPosition(new T.Vector3())
        .sub(start)
        .normalize();
      const before = meshVertex(blade, index).sub(center);
      before.addScaledVector(axis, -before.dot(axis));
      states[prop.id] = stepMotor(
        states[prop.id],
        { targetRpm: 900, enabled: true },
        0.001,
      );
      return { prop, blade, index, center, axis, before };
    });
    applyMotorPose(rig, states);
    parent.updateMatrixWorld(true);
    for (const { prop, blade, index, center, axis, before } of rows) {
      const after = meshVertex(blade, index).sub(center);
      after.addScaledVector(axis, -after.dot(axis));
      const angle = Math.atan2(
        axis.dot(before.clone().cross(after)),
        before.dot(after),
      );
      assert.ok(
        Math.abs(angle - ((prop.spinSign * 900) / 60) * Math.PI * 2 * 0.001) <
          1e-7,
        `${prop.id} wing=${wing} 顶点有向转角${angle}`,
      );
      assert.ok(Math.abs(before.length() - after.length()) < 1e-7);
    }
  }
});

test("叶片真实截面具有朝速度方向的前缘、正轴几何螺距与径向扭转，两叶保持180度安装", async () => {
  const rig = await model();
  const sections = [
    [0.08, 0.014, 0.098, 14],
    [0.24, 0.057, 0.123, 10],
    [0.395, 0.1, 0.108, 7.5],
    [0.515, 0.129, 0.058, 6.5],
  ];
  for (const prop of rig.props) {
    const leaves = ["A", "B"].map(
      (letter) =>
        rig.scene.getObjectByName(`Blade_${prop.id}_${letter}`) as T.Mesh,
    );
    const points = leaves.map((leaf) => {
      const p = leaf.geometry.getAttribute("position");
      return Array.from({ length: p.count }, (_, i) =>
        new T.Vector3().fromBufferAttribute(p, i),
      );
    });
    const nearest = (list: T.Vector3[], point: T.Vector3[]) =>
      Math.max(
        ...point.map((p) => Math.min(...list.map((q) => p.distanceTo(q)))),
      );
    const mirrored = points[0].map((p) => new T.Vector3(-p.x, p.y, -p.z));
    assert.ok(
      nearest(points[1], mirrored) < 1e-6,
      `${prop.id} A/B未绕桨轴180度对应`,
    );
    for (const [x, sweep, chord, degrees] of sections) {
      const angle = (degrees * Math.PI) / 180;
      const leading = new T.Vector3(
        x,
        (chord / 2) * Math.sin(angle),
        -prop.spinSign * (-sweep + (chord / 2) * Math.cos(angle)),
      );
      const trailing = new T.Vector3(
        x,
        (-chord / 2) * Math.sin(angle),
        -prop.spinSign * (-sweep - (chord / 2) * Math.cos(angle)),
      );
      assert.ok(
        nearest(points[1], [leading, trailing]) < 1e-6,
        `${prop.id} 截面${x}端点与几何螺距不符`,
      );
      const advance = leading.y - trailing.y;
      const tangent = new T.Vector3(0, 0, -prop.spinSign);
      assert.ok(leading.clone().sub(trailing).dot(tangent) > 0 && advance > 0);
      assert.ok(
        Math.abs(
          (Math.atan2(advance, Math.abs(leading.z - trailing.z)) * 180) /
            Math.PI -
            degrees,
        ) < 1e-6,
      );
    }
  }
});

test("V15拒绝方向与几何手性脱离的节点契约", async () => {
  const rig = await model();
  rig.props[0].object.userData.handedness = -rig.props[0].spinSign;
  assert.throws(() => createModelRig(rig.scene), /手性契约不一致/);
});

test("真实连续桨叶保留28点根截面、56点叶身截面与单点圆尖，接回和包络由实际顶点证明", async () => {
  const rig = await model();
  for (const prop of rig.props) {
    const blade = rig.scene.getObjectByName(`Blade_${prop.id}_B`) as T.Mesh;
    assert.equal(blade.userData.propellerContinuityVersion, 1);
    const attribute = blade.geometry.getAttribute("position");
    const points = Array.from({ length: attribute.count }, (_, index) =>
      new T.Vector3().fromBufferAttribute(attribute, index),
    );
    const unique = (list: T.Vector3[]) => [
      ...new Map(
        list.map((point) => [point.toArray().join(","), point]),
      ).values(),
    ];
    const section = (x: number) =>
      unique(points.filter((point) => Math.abs(point.x - x) < 1e-7));
    assert.equal(section(0.08).length, 28, `${prop.id} 原根共用截面被改变`);
    for (const x of [0.24, 0.395, 0.515])
      assert.equal(section(x).length, 56, `${prop.id} 叶身截面未实体加密`);
    const tipX = Math.max(...points.map((point) => point.x));
    const tip = section(tipX);
    assert.equal(tip.length, 1, `${prop.id} 仍为平切端盖或出现重叠桨尖`);
    assert.ok(Math.abs(tipX - 0.5956363366507627) < 1e-6);
    assert.ok(Math.abs(tip[0].y) < 1e-6, "圆尖中心必须仍在实际桨盘内");
    assert.ok(Math.abs(tip[0].z - prop.spinSign * 0.14) < 1e-6);
    const radius = Math.max(
      ...points.map((point) => Math.hypot(point.x + 0.17, point.z)),
    );
    assert.ok(radius <= 0.78 + 1e-6 && radius >= 0.7783);
    const edgePoint = (x: number, leading: boolean) => {
      const ring = section(x);
      assert.ok(ring.length > 0, `${prop.id} 缺少真实截面 ${x}`);
      return ring.reduce((best, point) => {
        const direction = leading ? -prop.spinSign : prop.spinSign;
        return point.z * direction > best.z * direction ? point : best;
      });
    };
    for (const leading of [true, false]) {
      const a = edgePoint(0.054, leading);
      const b = edgePoint(0.08, leading);
      const c = edgePoint(0.08888888888888889, leading);
      const angle = b.clone().sub(a).angleTo(c.clone().sub(b));
      assert.ok(
        angle < (3 * Math.PI) / 180,
        `${prop.id} 真实接回边线仍有超过3度的折角`,
      );
    }
  }
});
