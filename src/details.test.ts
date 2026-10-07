import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  DETAIL_LIMITS,
  DETAIL_VIEWS,
  NEUTRAL_DETAIL_POSE,
  normalizeDetailPose,
  type DetailControl,
} from "./details";
import {
  INITIAL_EXPERIENCE,
  displayedUnfold,
  experienceReducer as reduce,
  type ExperienceAction,
} from "./experience";
import {
  applyDetailPose,
  applyModelPose,
  createModelRig,
  measureModelRig,
  GROUND_HEIGHT,
} from "./rig";
import { loadRuntimeRig } from "../qa/lib/runtime-motor-motion.mts";
import {
  applyCameraFrame,
  boxCorners,
  getDetailInspectionFrame,
} from "./inspection";

function openCargo() {
  let state = reduce(INITIAL_EXPERIENCE, { type: "detail", view: "cargo" });
  return reduce(state, { type: "detail-pose", control: "hatch", degrees: 55 });
}

test("细节模式保持静态装配姿态，排除飞行、倾转、拆解及自动环绕", () => {
  let state = reduce(INITIAL_EXPERIENCE, { type: "play-flight" });
  state = reduce(state, { type: "advance-flight", seconds: 21, loop: true });
  const before = displayedUnfold(state);
  state = reduce(state, { type: "set", key: "exploded", value: true });
  state = reduce(state, { type: "set", key: "autoRotate", value: true });
  state = reduce(state, { type: "detail", view: "wing" });
  assert.equal(state.playing, false);
  assert.equal(state.tilt.playing, false);
  assert.equal(state.exploded, false);
  assert.equal(state.autoRotate, false);
  assert.equal(state.jointSide, null);
  assert.equal(state.inspection, true);
  assert.equal(displayedUnfold(state), 1);
  assert.equal(state.detailReturnProgress, before);
});

test("细节动作只接受当前部件、有限数值和明确行程", () => {
  let state = reduce(INITIAL_EXPERIENCE, { type: "detail", view: "wing" });
  for (const control of ["hatch", "tail"] as const) {
    assert.equal(
      reduce(state, { type: "detail-pose", control, degrees: 8 }),
      state,
    );
  }
  for (const degrees of [NaN, Infinity, -Infinity]) {
    assert.equal(
      reduce(state, { type: "detail-pose", control: "inboard", degrees }),
      state,
    );
  }
  state = reduce(state, {
    type: "detail-pose",
    control: "inboard",
    degrees: 500,
  });
  assert.equal(state.detailPose.inboard, DETAIL_LIMITS.inboard[1]);
  state = reduce(state, {
    type: "detail-pose",
    control: "outboard",
    degrees: -500,
  });
  assert.equal(state.detailPose.outboard, DETAIL_LIMITS.outboard[0]);
  assert.deepEqual(
    normalizeDetailPose({ hatch: -80, tail: Infinity, outboard: NaN }),
    NEUTRAL_DETAIL_POSE,
  );
});

test("快速反复切换六种细节清零旧动作，退出恢复进入前精确整翼姿态", () => {
  let state = reduce(INITIAL_EXPERIENCE, { type: "enter-tilt" });
  state = reduce(state, {
    type: "tilt",
    action: { type: "scrub", progress: 0.317 },
  });
  for (let i = 0; i < 12; i++) {
    for (const { id, controls } of DETAIL_VIEWS) {
      state = reduce(state, { type: "detail", view: id });
      assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
      assert.equal(state.detailReturnProgress, 0.317);
      for (const control of controls)
        state = reduce(state, { type: "detail-pose", control, degrees: 8 });
    }
  }
  state = reduce(state, { type: "close-detail" });
  assert.equal(state.detailView, null);
  assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
  assert.equal(state.tilt.playing, false);
  assert.equal(displayedUnfold(state), 0.317);
});

test("普通视角、关节、飞行、整翼、拆解、自由观察及复位均关闭舱盖", () => {
  const exits: ExperienceAction[] = [
    { type: "close-detail" },
    { type: "reset" },
    { type: "inspect", view: "top" },
    { type: "joint", side: "L" },
    { type: "play-flight" },
    { type: "enter-tilt" },
    { type: "leave-tilt" },
    { type: "tilt", action: { type: "begin", direction: -1 } },
    { type: "tilt", action: { type: "scrub", progress: 0.52 } },
    { type: "tilt", action: { type: "reset" } },
    { type: "set", key: "cameraView", value: "front" },
    { type: "set", key: "cameraReset", value: (n) => n + 1 },
    { type: "set", key: "inspection", value: false },
    { type: "set", key: "exploded", value: true },
    { type: "set", key: "autoRotate", value: true },
    { type: "set", key: "time", value: 15 },
    { type: "set", key: "playing", value: true },
  ];
  for (const action of exits) {
    const result = reduce(openCargo(), action);
    assert.equal(result.detailView, null, JSON.stringify(action));
    assert.deepEqual(
      result.detailPose,
      NEUTRAL_DETAIL_POSE,
      JSON.stringify(action),
    );
  }
});

test("暂停保持当前静态细节，过期动画tick不能重启飞行或整翼", () => {
  let state = openCargo();
  state = reduce(state, { type: "set", key: "playing", value: false });
  state = reduce(state, { type: "tilt", action: { type: "pause" } });
  assert.equal(state.detailPose.hatch, 55);
  assert.equal(
    reduce(state, { type: "tilt", action: { type: "tick", seconds: 0.1 } }),
    state,
  );
  assert.equal(
    reduce(state, { type: "advance-flight", seconds: 0.1, loop: true }),
    state,
  );
  state = reduce(state, { type: "detail-neutral" });
  assert.equal(state.detailView, "cargo");
  assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
});

test("主GLB载入前选细节、改值、取消、复位和选概念均无残余姿态", async () => {
  for (const exit of ["close-detail", "reset"] as const) {
    let state = openCargo();
    state = reduce(state, { type: "detail", view: "systems" });
    state = reduce(state, { type: exit });
    // Simulate the first layout commit after the delayed primary GLB resolves.
    const { rig } = await loadRuntimeRig();
    measureModelRig(rig);
    applyModelPose(rig, displayedUnfold(state), state.exploded);
    applyDetailPose(rig, state.detailPose);
    assert.equal(displayedUnfold(state), 0);
    for (const part of rig.details)
      assert.ok(part.object.quaternion.angleTo(part.quaternion) < 1e-7);
  }
});

test("真实GLB含六个独立活动舵面及单独舱盖轴，默认全部中立关闭", async () => {
  const { rig } = await loadRuntimeRig();
  assert.equal(rig.details.length, 7);
  assert.equal(rig.details.filter((part) => part.group !== "hatch").length, 6);
  for (const part of rig.details) {
    assert.ok(Math.abs(part.axis.length() - 1) < 1e-10);
    assert.ok(part.range[0] >= DETAIL_LIMITS[part.group][0]);
    assert.ok(part.range[1] <= DETAIL_LIMITS[part.group][1]);
  }
  applyModelPose(rig, 0);
  for (const part of rig.details)
    assert.ok(part.object.quaternion.angleTo(part.quaternion) < 1e-7);
});

test("实际轴线驱动绝对限幅不累计、左右符号镜像且主飞行动作强制回中", async () => {
  const { rig } = await loadRuntimeRig();
  for (const unfold of [0, 0.5, 1]) {
    applyModelPose(rig, unfold);
    const before = rig.wings.map(({ rest }) => rest!.object.quaternion.clone());
    for (let i = 0; i < 60; i++) {
      applyDetailPose(rig, { inboard: 12, outboard: -12, tail: 6, hatch: 55 });
      for (const part of rig.details) {
        const requested = { inboard: 12, outboard: -12, tail: 6, hatch: 55 }[
          part.group
        ];
        const degrees = THREE.MathUtils.clamp(requested, ...part.range);
        const expected = part.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              part.axis,
              (degrees * part.sign * Math.PI) / 180,
            ),
          );
        assert.ok(part.object.quaternion.angleTo(expected) < 1e-7);
        assert.ok(part.object.position.distanceTo(part.position) < 1e-12);
      }
      rig.wings.forEach(({ rest }, j) =>
        assert.ok(rest!.object.quaternion.angleTo(before[j]) < 1e-7),
      );
    }
    applyModelPose(rig, unfold);
    for (const part of rig.details)
      assert.ok(part.object.quaternion.angleTo(part.quaternion) < 1e-7);
  }
});

test("错误细节铰轴必须拒绝，不能以装饰网格估计旋转轴", () => {
  for (const fault of ["missing", "zero", "offset", "parent"] as const) {
    const scene = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.name = "ControlPivot_L_Inboard";
    scene.add(pivot);
    if (fault !== "missing") {
      const start = new THREE.Group();
      start.name = "ControlAxisStart_L_Inboard";
      const end = new THREE.Group();
      end.name = "ControlAxisEnd_L_Inboard";
      end.position.x = fault === "zero" ? 0 : 1;
      (fault === "parent" ? pivot : scene).add(start, end);
      if (fault === "offset") pivot.position.y = 0.01;
    }
    assert.throws(() => createModelRig(scene), /轴线|轴参考/);
  }
});

test("近看镜头按各部件全行程包络取景，宽屏和窄屏都不裁切", async () => {
  const { rig } = await loadRuntimeRig();
  const measurements = measureModelRig(rig);
  for (const { id } of DETAIL_VIEWS.filter(({ id }) => id !== "systems")) {
    const bounds = measurements.detailBounds[id];
    assert.equal(bounds.isEmpty(), false, id);
    for (const aspect of [0.45, 1, 2.4]) {
      const camera = new THREE.OrthographicCamera();
      const frame = getDetailInspectionFrame(bounds, id, aspect);
      applyCameraFrame(camera, frame, aspect);
      for (const corner of boxCorners(bounds)) {
        corner.project(camera);
        assert.ok(Math.abs(corner.x) <= 0.76 && Math.abs(corner.y) <= 0.76, id);
      }
    }
  }
});

test("舱盖完整55度包络悬空检视不穿地板，退出恢复正常groundOffset", async () => {
  const { rig } = await loadRuntimeRig();
  const measurements = measureModelRig(rig);
  assert.ok(measurements.detailLift >= 0.18);
  for (let degrees = 0; degrees <= 55; degrees += 1) {
    applyModelPose(rig, 1);
    applyDetailPose(rig, { hatch: degrees });
    const hood = new THREE.Box3().setFromObject(
      rig.nodes.get("CargoHoodPivot")!.object,
    );
    hood.translate(
      new THREE.Vector3(
        0,
        measurements.groundOffset + measurements.detailLift,
        0,
      ),
    );
    assert.ok(hood.min.y >= GROUND_HEIGHT + 0.139, `hatch=${degrees}`);
  }
  applyModelPose(rig, 0);
  const normal =
    new THREE.Box3().setFromObject(rig.scene).min.y + measurements.groundOffset;
  assert.ok(Math.abs(normal - GROUND_HEIGHT) < 1e-7);
});

test("互锁回归拒绝非法舱盖混控、飞行/拆解并行及任何一个残留偏转pivot", async () => {
  const { verifyRuntimeIndependentControlFaultInjection } =
    await import("../qa/lib/runtime-independent-controls.mts");
  const report = await verifyRuntimeIndependentControlFaultInjection();
  assert.equal(report.rejected, true);
  assert.equal(report.invalidControlMixRejected, true);
  assert.equal(report.runningFlightRejected, true);
  assert.equal(report.explodedHatchRejected, true);
  assert.equal(report.individualLeakedPivotsRejected, 7);
});

test("六类细节React静态标记及320px源码约束持续保留退出与换行", async () => {
  const { checkDetailUiSource } =
    await import("../qa/lib/runtime-ui-source-check.mts");
  const report = checkDetailUiSource();
  assert.equal(report.passed, true);
  assert.equal(report.tabs.length, 6);
  assert.equal(report.mobileSourceEstimate.rows, 2);
});

test("可选概念模块错误边界仅显示局部错误，返回按钮清理细节并恢复主机", async () => {
  const { ConceptBoundary } = await import("./Scene");
  let state = reduce(INITIAL_EXPERIENCE, { type: "detail", view: "systems" });
  const boundary = new ConceptBoundary({
    children: "concept",
    onClose: () => {
      state = reduce(state, { type: "close-detail" });
    },
  });
  assert.equal(boundary.render(), "concept");
  boundary.state = ConceptBoundary.getDerivedStateFromError();
  const fallback = boundary.render() as {
    props: {
      children: {
        props: {
          children: { type: string; props: { onClick?: () => void } }[];
        };
      };
    };
  };
  const button = fallback.props.children.props.children.find(
    (element) => element.type === "button",
  );
  assert.ok(button?.props.onClick);
  button.props.onClick();
  assert.equal(state.detailView, null);
  assert.deepEqual(state.detailPose, NEUTRAL_DETAIL_POSE);
  assert.equal(displayedUnfold(state), 0);
});

test("独立电机电调概念模块Meshopt解码与Float32原始几何、材质和拓扑完全等价", async () => {
  const { checkConceptCompression } =
    await import("../qa/lib/runtime-concept-compression-check.mts");
  const report = await checkConceptCompression(
    new URL(
      "../assets/blender/nacelle-system-concept-source.glb",
      import.meta.url,
    ),
  );
  assert.equal(report.passed, true);
  assert.equal(report.meshopt, true);
  assert.equal(report.quantized, false);
  assert.equal(report.meshCount, 20);
  assert.equal(report.triangles, 3144);
  assert.ok(report.runtimeBytes < report.sourceBytes);
});
