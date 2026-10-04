import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runRuntimeMotionChecks,
  verifyRuntimeFaultInjection,
} from "../qa/lib/runtime-rotor-motion.mts";

import {
  runRuntimeSelfClearance,
  verifyFilledRootFault,
} from "../qa/lib/runtime-self-clearance.mts";

import {
  runRuntimeShaftClearance,
  verifyContainedShaftFault,
} from "../qa/lib/runtime-shaft-clearance.mts";

test("真实驱动在四机独立启停、任意翼角跳转与中断时保持停桨折叶互锁", async () => {
  const report = await runRuntimeMotionChecks();
  assert.equal(report.passed, true);
  assert.equal(report.motorCount, 4);
  assert.equal(report.bladeCount, 8);
  assert.equal(report.independentMasks, 16);
  assert.equal(report.wingJumps, 80);
  assert.equal(report.interruptedSequences, 640);
  assert.equal(report.partitionChecks, 196);
  assert.equal(report.invalidAtomicChecks, 8);
  assert.equal(report.axisPlaneChecks, 24);
  assert.equal(report.stages.length, 7);
  assert.ok(report.poseChecks > 9000);
});

test("新运行路径回归明确拒绝旧驱动保留任意桨相位直接折叶的缺陷", async () => {
  const result = await verifyRuntimeFaultInjection();
  assert.equal(result.rejected, true);
});

test("真实折叶不得穿过同一桨毂下的自身销轴、叉臂或另一叶片", async () => {
  const report = await runRuntimeSelfClearance();
  assert.deepEqual(report.contacts, []);
  assert.equal(report.passed, true);
});

test("同桨净空回归拒绝把叶根轴孔重新填实的旧类缺陷", async () => {
  const report = await verifyFilledRootFault();
  assert.equal(report.rejected, true);
});

test("四个旋转桨帽在24相位和整翼转换前中后均不穿入固定电机轴", async () => {
  const report = await runRuntimeShaftClearance();
  assert.deepEqual(report.contacts, []);
  assert.equal(report.pairTests, 288);
  assert.equal(report.passed, true);
});

test("完全包容而没有表面交叉的固定轴干涉也被运行净空检查拒绝", () => {
  const report = verifyContainedShaftFault();
  assert.equal(report.rejected, true);
});
