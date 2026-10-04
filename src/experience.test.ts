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
