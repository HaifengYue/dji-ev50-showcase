import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlight, PHASES, phaseStart, TOTAL, advanceTime } from "./flight.ts";
test("完整飞行顺序包含八个阶段", () =>
  assert.deepEqual(
    PHASES.map((p) => p.id),
    [
      "idle",
      "takeoff",
      "hover",
      "wing-transition",
      "cruise",
      "orbit",
      "deceleration-transition",
      "landing",
    ],
  ));
test("全部阶段边界保持高度、整翼角度与速度连续", () => {
  for (let i = 1; i < PHASES.length; i++) {
    const a = getFlight(phaseStart(i) - 0.00001),
      b = getFlight(phaseStart(i));
    for (const key of ["altitude", "unfold", "speed", "x", "z", "yaw"] as const)
      assert.ok(Math.abs(a[key] - b[key]) < 0.001, `${i}:${key}`);
  }
});
test("转换中点驱动整翼，降落返回地面", () => {
  assert.equal(getFlight(phaseStart(3) + 4.5).unfold, 0.5);
  assert.equal(getFlight(TOTAL).altitude, 0);
  assert.equal(getFlight(TOTAL).unfold, 0);
});
test("播放循环、暂停边界和重置时间稳定", () => {
  assert.equal(advanceTime(TOTAL, 1, true), 1);
  assert.equal(advanceTime(TOTAL, 1, false), TOTAL);
  assert.equal(advanceTime(20, 0, true), 20);
  assert.equal(getFlight(0).phase.id, "idle");
});
