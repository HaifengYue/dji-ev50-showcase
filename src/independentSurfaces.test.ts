import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import DetailPanel from "./DetailPanel";
import {
  DETAIL_CONTROL_LABELS,
  NEUTRAL_DETAIL_POSE,
  detailSurfaces,
  normalizeDetailPose,
} from "./details";
import { INITIAL_EXPERIENCE, experienceReducer as reduce } from "./experience";
import { applyDetailPose, applyModelPose, applySurfacePose } from "./rig";
import { loadRuntimeRig } from "../qa/lib/runtime-motor-motion.mts";
import {
  PROTOCOL,
  SimulationRuntime,
  applyStatePatch,
  defaultSimulationState,
  parseRecording,
  validateState,
} from "./simulation";
import {
  SURFACE_CONTROLS,
  resolveSurfacePatch,
  type SurfaceControl,
} from "./surfaces";

const controls = Object.keys(SURFACE_CONTROLS) as SurfaceControl[];
const sixAngles = {
  L_Inboard: 2,
  R_Inboard: -3,
  L_Outboard: 4,
  R_Outboard: -5,
  Tail_L: 6,
  Tail_R: -7,
};

test("独立细节输入保留旧分组兼容，显式单片零值优先且各自限幅", () => {
  const pose = normalizeDetailPose({
    inboard: 8,
    inboard_L: 0,
    outboard: -7,
    outboard_R: 99,
    tail: 9,
    tail_L: NaN,
    hatch: 99,
  });
  assert.deepEqual(detailSurfaces(pose), {
    L_Inboard: 0,
    R_Inboard: 8,
    L_Outboard: -7,
    R_Outboard: 12,
    Tail_L: 0,
    Tail_R: 9,
  });
  assert.equal(pose.hatch, 55);
});

test("六片UI逐项调节仅改变本片，旧分组动作仍同步两片，切页和复位清零", () => {
  for (const control of controls) {
    const view = control.startsWith("tail") ? "tail" : "wing";
    let state = reduce(INITIAL_EXPERIENCE, { type: "detail", view });
    for (const degrees of [8, -4, 0, 12, -12]) {
      state = reduce(state, { type: "detail-pose", control, degrees });
      for (const other of controls)
        assert.equal(state.detailPose[other], other === control ? degrees : 0);
      assert.equal(state.detailPose.hatch, 0);
    }
    for (const degrees of [NaN, Infinity, -Infinity, "5", null, true])
      assert.equal(
        reduce(state, {
          type: "detail-pose",
          control,
          degrees: degrees as number,
        }),
        state,
      );
    for (const action of [
      { type: "detail-neutral" },
      { type: "close-detail" },
      { type: "reset" },
      { type: "detail", view: "cargo" },
      { type: "play-flight" },
    ] as const)
      assert.deepEqual(reduce(state, action).detailPose, NEUTRAL_DETAIL_POSE);
  }
  let state = reduce(INITIAL_EXPERIENCE, { type: "detail", view: "wing" });
  state = reduce(state, {
    type: "detail-pose",
    control: "inboard_L",
    degrees: 3,
  });
  state = reduce(state, {
    type: "detail-pose",
    control: "inboard",
    degrees: -8,
  });
  assert.equal(state.detailPose.inboard_L, -8);
  assert.equal(state.detailPose.inboard_R, -8);
  state = reduce(state, {
    type: "detail-pose",
    control: "inboard_L",
    degrees: 0,
  });
  assert.equal(state.detailPose.inboard_R, -8);
  assert.equal(
    reduce(state, { type: "detail-pose", control: "tail_L", degrees: 5 }),
    state,
  );
});

test("主翼四滑杆、V尾两滑杆和独立舱盖都有唯一的可访问标签和实际数值", () => {
  for (const [view, expected] of [
    ["wing", ["inboard_L", "inboard_R", "outboard_L", "outboard_R"]],
    ["tail", ["tail_L", "tail_R"]],
    ["cargo", ["hatch"]],
  ] as const) {
    const pose = normalizeDetailPose({
      inboard_L: 2,
      inboard_R: -3,
      outboard_L: 4,
      outboard_R: -5,
      tail_L: 6,
      tail_R: -7,
      hatch: 22,
    });
    const html = renderToStaticMarkup(
      createElement(DetailPanel, {
        view,
        pose,
        onSelect: () => {},
        onChange: () => {},
        onClose: () => {},
        onNeutral: () => {},
      }),
    );
    assert.equal((html.match(/type="range"/g) ?? []).length, expected.length);
    for (const control of expected) {
      assert.ok(
        html.includes(`aria-label="${DETAIL_CONTROL_LABELS[control]}"`),
      );
      assert.ok(
        html.includes(
          `aria-valuetext="${pose[control].toFixed(1)}度，模型示意行程"`,
        ),
      );
    }
  }
});

test("真实六铰轴在收翼、半倾转和展开及机体旋转下独立转动，邻面和舱盖不被带动", async () => {
  const { rig } = await loadRuntimeRig();
  rig.scene.quaternion.setFromEuler(new THREE.Euler(0.2, -0.3, 0.1));
  rig.scene.position.set(0.3, 0.8, -0.5);
  for (const unfold of [0, 0.25, 0.5, 0.75, 1]) {
    for (const control of controls) {
      applyModelPose(rig, unfold);
      const part = rig.details.find((item) => item.control === control)!;
      const suffix = SURFACE_CONTROLS[control];
      const axisStart = rig.nodes
        .get(`ControlAxisStart_${suffix}`)!
        .object.getWorldPosition(new THREE.Vector3());
      const axisEnd = rig.nodes
        .get(`ControlAxisEnd_${suffix}`)!
        .object.getWorldPosition(new THREE.Vector3());
      const axis = axisEnd.clone().sub(axisStart).normalize();
      const sample = new THREE.Vector3(0.13, 0.21, -0.17);
      const beforeSample = part.object.localToWorld(sample.clone());
      const pivotOrigin = part.object.getWorldPosition(new THREE.Vector3());
      const before = rig.details.map(({ object }) =>
        object.matrixWorld.clone(),
      );
      const wings = rig.wings.map(({ rest }) =>
        rest!.object.matrixWorld.clone(),
      );
      const degrees = control.endsWith("L") ? 11 : -9;
      const expected = beforeSample
        .clone()
        .sub(axisStart)
        .applyAxisAngle(axis, THREE.MathUtils.degToRad(degrees * part.sign))
        .add(axisStart);
      for (let repeat = 0; repeat < 4; repeat++) {
        applyDetailPose(rig, { [control]: degrees });
        assert.ok(
          part.object.localToWorld(sample.clone()).distanceTo(expected) < 2e-7,
          `${control}/${unfold}`,
        );
        assert.ok(
          part.object
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(pivotOrigin) < 1e-7,
        );
        rig.details.forEach((other, index) => {
          if (other !== part)
            assert.deepEqual(
              other.object.matrixWorld.elements,
              before[index].elements,
            );
        });
        rig.wings.forEach(({ rest }, index) =>
          assert.deepEqual(
            rest!.object.matrixWorld.elements,
            wings[index].elements,
          ),
        );
      }
      // Python/实时路径必须与 UI 路径施加完全相同的单片世界姿态。
      applyModelPose(rig, unfold);
      applySurfacePose(rig, { [suffix]: degrees }, 0);
      assert.ok(
        part.object.localToWorld(sample.clone()).distanceTo(expected) < 2e-7,
      );
      rig.details.forEach((other, index) => {
        if (other !== part)
          assert.deepEqual(
            other.object.matrixWorld.elements,
            before[index].elements,
          );
      });
    }
  }
});

test("规范ID、单片别名和旧分组优先级与字段顺序无关，遗漏项保持", () => {
  const entries = [
    ["L_Inboard", 0],
    ["inboard_L", 4],
    ["inboard", 10],
    ["outboard_R", -3],
    ["tail", 6],
  ];
  const expected = {
    L_Inboard: 0,
    R_Inboard: 10,
    R_Outboard: -3,
    Tail_L: 6,
    Tail_R: 6,
  };
  for (const pairs of [entries, [...entries].reverse()])
    assert.deepEqual(resolveSurfacePatch(Object.fromEntries(pairs)), expected);
  const first = applyStatePatch(defaultSimulationState(), {
    surfaces: sixAngles,
    hatchDeg: 22,
  });
  const next = applyStatePatch(first, { surfaces: { inboard_L: 0 } });
  assert.deepEqual(next.surfaces, { ...sixAngles, L_Inboard: 0 });
  assert.equal(next.hatchDeg, 22);
  assert.deepEqual(first.surfaces, sixAngles);
  assert.throws(
    () =>
      validateState({ ...first, surfaces: { ...first.surfaces, inboard: 2 } }),
    /未知/,
  );
});

test("被覆盖的分组和末项无效也整批拒绝，状态及已显示网格无部分修改", async () => {
  const { rig } = await loadRuntimeRig();
  applyModelPose(rig, 0.5);
  applySurfacePose(rig, sixAngles, 22);
  const before = rig.details.map(({ object }) => object.quaternion.toArray());
  for (const invalid of [
    NaN,
    Infinity,
    -Infinity,
    12.01,
    -12.01,
    "4",
    null,
    true,
  ]) {
    const patch = { inboard: invalid, L_Inboard: 1, R_Inboard: 2 };
    assert.throws(() =>
      applyStatePatch(defaultSimulationState(), { surfaces: patch }),
    );
    assert.throws(() => applySurfacePose(rig, patch as never, 0));
    assert.throws(() =>
      applySurfacePose(rig, { L_Inboard: 12, Tail_R: invalid } as never, 0),
    );
    assert.deepEqual(
      rig.details.map(({ object }) => object.quaternion.toArray()),
      before,
    );
  }
  assert.throws(() => applySurfacePose(rig, { other: 3 } as never, 0));
  assert.throws(() => applySurfacePose(rig, { L_Inboard: 1 }, 56));
  assert.deepEqual(
    rig.details.map(({ object }) => object.quaternion.toArray()),
    before,
  );
});

test("实时六舵面快照阻断UI与动画覆盖，确定性步进保值，退出完整复位", () => {
  const runtime = new SimulationRuntime();
  runtime.setLocal({ surfaces: { inboard: 3 } });
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    surfaces: sixAngles,
    wingTilt: 0.4,
    hatchDeg: 22,
  });
  state.owner = "external";
  runtime.accept({ protocol: PROTOCOL, revision: 1, op: "set", state });
  for (let frame = 0; frame < 10; frame++) {
    assert.equal(
      runtime.setLocal({ surfaces: { inboard: 0, tail: 0 }, hatchDeg: 0 }),
      false,
    );
    assert.equal(runtime.stepLocal(0.1), false);
    runtime.advancePresentation(0.1);
    assert.deepEqual(runtime.getRenderSample().state.surfaces, sixAngles);
  }
  runtime.accept({
    protocol: PROTOCOL,
    revision: 2,
    op: "step",
    dt: 0.5,
    state: { ...state, time: { ...state.time, seconds: 0.5 } },
  });
  assert.deepEqual(runtime.getSnapshot().state.surfaces, sixAngles);
  runtime.resetLocal();
  assert.deepEqual(runtime.getSnapshot().state, defaultSimulationState());
});

test("Python记录与TS回放使用相同六独立值和优先级，重复seek和reset无残余", () => {
  const text = execFileSync(
    "python3",
    [
      "-c",
      [
        "import json,sys",
        "sys.path.insert(0,'python')",
        "from transwing_sim import Recording",
        "r=Recording().reset().set_state(hatchDeg=22,wingTilt=.5)",
        "r.set_surfaces(inboard=8,inboard_L=0,L_Inboard=2,R_Inboard=-3,outboard=9,L_Outboard=4,R_Outboard=-5,tail=10,Tail_L=6,Tail_R=-7).step(.1)",
        "print(json.dumps({'recording':r.as_dict(),'state':r.state}))",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  const result = JSON.parse(text);
  const recording = JSON.stringify(result.recording);
  assert.deepEqual(
    parseRecording(recording).state.surfaces,
    result.state.surfaces,
  );
  assert.deepEqual(result.state.surfaces, sixAngles);
  const runtime = new SimulationRuntime();
  runtime.replay(recording);
  for (let repeat = 0; repeat < 3; repeat++) {
    runtime.replayAt(4);
    assert.deepEqual(runtime.getRenderSample().state.surfaces, sixAngles);
    assert.equal(runtime.setLocal({ surfaces: { tail: 0 } }), false);
    runtime.replayAt(0);
    assert.deepEqual(
      runtime.getRenderSample().state.surfaces,
      defaultSimulationState().surfaces,
    );
  }
  runtime.resetLocal();
  assert.deepEqual(runtime.getSnapshot().state, defaultSimulationState());
});
