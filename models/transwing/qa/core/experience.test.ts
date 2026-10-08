import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_EXPERIENCE,
  experienceReducer as reduce,
  displayedUnfold,
} from "./experience";
import { phaseStart, TOTAL } from "./flight";
import { TILT_DURATION } from "./tilt";

test("首次打开为折叠暂停；加载前发起展开再重置仍停在折叠默认机位", () => {
  assert.equal(displayedUnfold(INITIAL_EXPERIENCE), 0);
  assert.equal(INITIAL_EXPERIENCE.playing, false);
  assert.equal(INITIAL_EXPERIENCE.tilt.playing, false);
  let state = reduce(INITIAL_EXPERIENCE, { type: "enter-tilt" });
  state = reduce(state, {
    type: "tilt",
    action: { type: "begin", direction: 1 },
  });
  state = reduce(state, { type: "reset" });
  state = reduce(state, { type: "tilt", action: { type: "tick", seconds: 1 } });
  assert.equal(displayedUnfold(state), 0);
  assert.equal(state.playing, false);
  assert.equal(state.tilt.playing, false);
  assert.equal(state.inspection, false);
  assert.equal(state.jointSide, null);
  assert.equal(state.cameraView, "perspective");
});

test("拖动后反复切换俯视与关节保留精确姿态，视角切换暂停机构", () => {
  let state = reduce(INITIAL_EXPERIENCE, { type: "enter-tilt" });
  for (const progress of [0, 0.173, 0.5, 0.897, 1]) {
    state = reduce(state, {
      type: "tilt",
      action: { type: "scrub", progress },
    });
    state = reduce(state, {
      type: "tilt",
      action: { type: "begin", direction: progress === 1 ? -1 : 1 },
    });
    for (let i = 0; i < 4; i++) {
      state = reduce(state, { type: "inspect", view: "top" });
      assert.equal(displayedUnfold(state), progress);
      assert.equal(state.tilt.playing, false);
      assert.equal(state.playing, false);
      assert.equal(state.cameraView, "top");
      state = reduce(state, { type: "joint", side: i % 2 ? "L" : "R" });
      assert.equal(displayedUnfold(state), progress);
      state = reduce(state, { type: "inspect", view: "perspective" });
      assert.equal(state.jointSide, null);
      assert.equal(displayedUnfold(state), progress);
    }
  }
});

test("飞行转关节捕获当前展开姿态，再开始完整飞行从折叠待命重新起飞", () => {
  let state = reduce(INITIAL_EXPERIENCE, {
    type: "set",
    key: "time",
    value: phaseStart(3) + 4.5,
  });
  state = reduce(state, { type: "set", key: "playing", value: true });
  state = reduce(state, { type: "joint", side: "R" });
  assert.equal(displayedUnfold(state), 0.5);
  assert.equal(state.playing, false);
  assert.equal(state.inspection, true);
  state = reduce(state, { type: "play-flight" });
  assert.equal(state.time, 0);
  assert.equal(displayedUnfold(state), 0);
  assert.equal(state.playing, true);
  assert.equal(state.tilt.playing, false);
  assert.equal(state.inspection, false);
  assert.equal(state.jointSide, null);
  state = reduce(state, {
    type: "advance-flight",
    seconds: TOTAL + 1,
    loop: false,
  });
  assert.equal(state.time, TOTAL);
  assert.equal(state.playing, false);
  assert.equal(displayedUnfold(state), 0);
});

test("自由观察不会丢失手动展开进度，暂停与连续反向互不启动飞行", () => {
  let state = reduce(INITIAL_EXPERIENCE, { type: "enter-tilt" });
  state = reduce(state, {
    type: "tilt",
    action: { type: "begin", direction: 1 },
  });
  state = reduce(state, {
    type: "tilt",
    action: { type: "tick", seconds: TILT_DURATION / 2 },
  });
  state = reduce(state, { type: "tilt", action: { type: "pause" } });
  state = reduce(state, { type: "set", key: "inspection", value: false });
  assert.ok(Math.abs(displayedUnfold(state) - 0.5) < 1e-12);
  state = reduce(state, {
    type: "tilt",
    action: { type: "begin", direction: -1 },
  });
  state = reduce(state, {
    type: "tilt",
    action: { type: "tick", seconds: TILT_DURATION / 2 },
  });
  assert.equal(displayedUnfold(state), 0);
  assert.equal(state.playing, false);
  assert.equal(state.time, 0);
});

test("默认自由观察；全部机构动作在自由、正交、关节及细节镜头下不发出取景指令", () => {
  const initial = INITIAL_EXPERIENCE;
  assert.equal(initial.inspection, false);
  assert.equal(initial.cameraView, "perspective");
  assert.equal(initial.autoRotate, false);
  const starts = [
    initial,
    reduce(initial, { type: "inspect", view: "top" }),
    reduce(initial, { type: "inspect", view: "front" }),
    reduce(initial, { type: "inspect", view: "side" }),
    reduce(initial, { type: "joint", side: "R" }),
    reduce(initial, { type: "detail", view: "wing" }),
    reduce(initial, { type: "play-flight" }),
  ];
  for (const start of starts) {
    const camera = {
      inspection: start.inspection,
      view: start.cameraView,
      reset: start.cameraReset,
    };
    let state = start;
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const action of [
        { type: "scrub", progress: 0.327 },
        { type: "begin", direction: 1 },
        { type: "tick", seconds: 0.1 },
        { type: "pause" },
        { type: "begin", direction: -1 },
        { type: "repeat", enabled: repeat % 2 === 0 },
        { type: "rate", value: 2 },
        { type: "reset" },
      ] as const) {
        state = reduce(state, { type: "enter-tilt" });
        state = reduce(state, { type: "tilt", action });
        assert.deepEqual(
          {
            inspection: state.inspection,
            view: state.cameraView,
            reset: state.cameraReset,
          },
          camera,
          `${start.cameraView}: ${JSON.stringify(action)}`,
        );
      }
      state = reduce(state, { type: "leave-tilt" });
      assert.equal(state.inspection, camera.inspection);
      assert.equal(state.cameraReset, camera.reset);
    }
  }
});

test("无细节面板时手动电机输入不会通过关闭细节误触发镜头复位", () => {
  for (const state of [
    INITIAL_EXPERIENCE,
    reduce(INITIAL_EXPERIENCE, { type: "inspect", view: "top" }),
  ]) {
    assert.equal(reduce(state, { type: "close-detail" }), state);
  }
});

test("明确的检查镜头仍取景；飞行暂停与继续不会重复取景", () => {
  let state = INITIAL_EXPERIENCE;
  for (const action of [
    { type: "inspect", view: "top" },
    { type: "joint", side: "L" },
    { type: "detail", view: "cargo" },
    { type: "close-detail" },
    { type: "reset" },
  ] as const) {
    const before = state.cameraReset;
    state = reduce(state, action);
    assert.equal(state.cameraReset, before + 1);
  }
  state = reduce(state, { type: "play-flight" });
  const before = state.cameraReset;
  state = reduce(state, { type: "advance-flight", seconds: 1, loop: true });
  state = reduce(state, { type: "play-flight" });
  state = reduce(state, { type: "play-flight" });
  assert.equal(state.cameraReset, before);
});
