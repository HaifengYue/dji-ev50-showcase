/** 真实Python服务/SDK、生产SSE桥、真实GLB的跨层验证；Node事件流适配器不是浏览器。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  SimulationRuntime,
  PROTOCOL,
  parseRecording,
} from "../../src/simulation.ts";
import { SimulationBridge } from "../../src/simulationBridge.ts";
import {
  applyModelPose,
  applyMotorPose,
  applySurfacePose,
} from "../../src/rig.ts";
import {
  assertRuntimePose,
  loadRuntimeRig,
} from "./runtime-rotor-motion.mts";
import * as T from "three";
import { createRotorExposure } from "../../src/rotorExposure.ts";
import { MOTOR_IDS } from "../../src/motors.ts";
import { makeDriveAssertion } from "./drive-contract.mts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, label: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error(`等待超时：${label}`);
    await wait(10);
  }
}
const env = { ...process.env, PYTHONPATH: "python" };
const server = spawn(
  "python3",
  [
    "-u",
    "-c",
    'from transwing_sim.server import LocalServer; s=LocalServer(("127.0.0.1",0)); print(s.server_address[1],flush=True); s.serve_forever(poll_interval=.05)',
  ],
  { env },
);
const serverLines = createInterface({ input: server.stdout });
let port = "";
serverLines.once("line", (line) => (port = line));
let errors = "";
server.stderr.on("data", (b) => (errors += b.toString()));
await until(() => !!port, "Python服务端口");
const origin = `http://127.0.0.1:${port}`;
const sdk = spawn(
  "python3",
  ["-u", "qa/lib/sdk-driver.py", origin],
  { env },
);
let sdkError = "";
sdk.stderr.on("data", (b) => (sdkError += b.toString()));
const sdkLines = createInterface({ input: sdk.stdout }),
  requests: ((x: any) => void)[] = [];
sdkLines.on("line", (line) => requests.shift()?.(JSON.parse(line)));
async function call(request: any) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`SDK响应超时 ${sdkError}`)),
      6000,
    );
    requests.push((x) => {
      clearTimeout(timeout);
      resolve(x);
    });
    sdk.stdin.write(JSON.stringify(request) + "\n");
  });
}
async function json(
  path: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const streamEvents: any[] = [],
  transportErrors: string[] = [];
class NodeSse {
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onerror: ((e: Event) => unknown) | null = null;
  private abort: AbortController | null = null;
  private closed = false;
  lastId: string | null = null;
  constructor(private url: string) {
    void this.open();
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  async open() {
    if (this.closed) return;
    this.abort = new AbortController();
    try {
      const r = await fetch(origin + this.url, {
        signal: this.abort.signal,
        headers: this.lastId ? { "Last-Event-ID": this.lastId } : {},
      });
      assert.equal(r.status, 200);
      const reader = r.body!.getReader();
      let buffer = "";
      const decoder = new TextDecoder();
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let cut; (cut = buffer.indexOf("\n\n")) >= 0;) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let type = "message",
            data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            if (line.startsWith("id:")) this.lastId = line.slice(3).trim();
            if (line.startsWith("data:")) data += line.slice(5).trimStart();
          }
          if (type === "state") streamEvents.push(JSON.parse(data));
          for (const fn of this.listeners.get(type) ?? [])
            fn({ data } as MessageEvent);
        }
      }
    } catch (e) {
      if (!this.closed) {
        transportErrors.push(String(e));
        this.onerror?.(new Event("error"));
      }
    }
  }
  drop() {
    this.abort?.abort();
    this.onerror?.(new Event("error"));
  }
  reconnect() {
    void this.open();
  }
  close() {
    this.closed = true;
    this.abort?.abort();
  }
}
let stream: NodeSse | undefined;
const runtime = new SimulationRuntime(),
  bridge = new SimulationBridge(runtime, {
    origin,
    viewerId: "qa_node_real_glb",
    fetch: ((path: any, init: any) =>
      fetch(new URL(String(path), origin), init)) as typeof fetch,
    eventSource: (url) => (stream = new NodeSse(url)),
  });
const { rig, sha256 } = await loadRuntimeRig();
const driveAssert = makeDriveAssertion(rig);
const layer = createRotorExposure(rig);
let paintCount = 0,
  paintEnabled = false;
function paint() {
  if (!paintEnabled || runtime.getSnapshot().disposed) return;
  const s = runtime.getSnapshot();
  applyModelPose(rig, s.state.wingTilt, s.state.display.exploded);
  applyMotorPose(rig, s.actuators);
  applySurfacePose(rig, s.state.surfaces, s.state.hatchDeg);
  assertRuntimePose(rig, s.state.wingTilt, s.state.display.exploded);
  driveAssert.check();
  paintCount++;
  runtime.markApplied(s.revision);
  layer.update(runtime.getRenderSample().exposure);
}
const unsubscribe = runtime.onEvent((e) => {
  if (e.type === "accepted" || e.type === "ready") paint();
});
const report: any = {
  passed: false,
  runtimeSha256: sha256,
  checks: [],
  limitations: [
    "真实标准库HTTP/SSE服务与Python SDK、生产SimulationBridge/SimulationRuntime、真实GLB对象的Node互操作",
    "测试EventSource为Node传输适配器，并非真实浏览器、Canvas、React帧调度、GPU、鼠标触控或截图验收",
    "applied只在独立测试实际调用GLB驱动后上报，仍不等同画面像素已经显示",
  ],
};
const checks = report.checks;
report.live1800 = [];
report.pixelSamples = [];
let session: any;
try {
  session = await call({ op: "connect" });
  assert.equal(session.ok, true);
  const sid = session.result.sessionId;
  const noViewer = await call({
    op: "command",
    command: "set",
    payload: {
      wingTilt: 0.5,
      motors: { L_Front: { enabled: true, targetRpm: 1800 } },
    },
  });
  assert.equal(noViewer.result.delivery, "no_viewer");
  checks.push("无查看器接受不冒报应用");
  await bridge.connect();
  await until(
    () => runtime.getSnapshot().revision >= noViewer.result.revision,
    "初始SSE快照",
  );
  const beforeReady = await call({
    op: "command",
    command: "step",
    payload: { dt: 0.3 },
  });
  await until(
    () => runtime.getSnapshot().revision >= beforeReady.result.revision,
    "载入前步进",
  );
  assert.equal(
    (await call({ op: "receipt", seq: beforeReady.result.seq })).result
      .delivery,
    "no_viewer",
  );
  assert.ok(runtime.getSnapshot().actuators.L_Front.fold < 1);
  assert.equal(paintCount, 0);
  paintEnabled = true;
  runtime.setReady(true);
  await wait(40);
  paint();
  await until(() => paintCount > 0, "首模型应用");
  let receipt = await call({ op: "receipt", seq: beforeReady.result.seq });
  for (let i = 0; receipt.result.delivery !== "applied" && i < 400; i++) {
    await wait(10);
    paint();
    receipt = await call({ op: "receipt", seq: beforeReady.result.seq });
  }
  assert.equal(receipt.result.delivery, "applied");
  checks.push("load-before-ready先接受后真实模型应用");
  // Public failure reproduced over real Python SDK → HTTP/SSE → production bridge → real GLB.
  const all1800 = Object.fromEntries(
    MOTOR_IDS.map((id) => [id, { enabled: true, targetRpm: 1800 }]),
  );
  assert.equal(
    (
      await call({
        op: "command",
        command: "set",
        payload: { motors: all1800 },
        waitApplied: true,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await call({
        op: "command",
        command: "step",
        payload: { dt: 2 },
        waitApplied: true,
      })
    ).ok,
    true,
  );
  const expectedSigns = { L_Front: -1, R_Front: 1, L_Rear: 1, R_Rear: -1 };
  for (let step = 0; step < 10; step++) {
    const before = structuredClone(runtime.getSnapshot().actuators),
      reply = await call({
        op: "command",
        command: "step",
        payload: { dt: 0.1 },
        waitApplied: true,
      });
    assert.equal(reply.result.delivery, "applied");
    paint();
    const sample = runtime.getRenderSample();
    assert.ok(sample.exposure);
    const rows = [];
    for (const id of MOTOR_IDS) {
      assert.equal(sample.actuators[id].rpm, 1800);
      assert.ok(
        Math.abs(
          Math.sin((sample.actuators[id].phase - before[id].phase) / 2),
        ) < 1e-10,
      );
      const prop = rig.props.find((p) => p.id === id)!,
        blade = rig.scene.getObjectByName(`Blade_${id}_B`) as T.Mesh;
      assert.equal(blade.visible, false);
      const position = blade.geometry.getAttribute("position");
      let vertex = 0;
      for (let i = 1; i < position.count; i++)
        if (position.getX(i) > position.getX(vertex)) vertex = i;
      const sweep = rig.scene.getObjectByName(
        `Exposure_${id}_Continuous`,
      ) as T.Mesh;
      assert.ok(sweep.visible);
      assert.equal(sweep.castShadow, false);
      const material = sweep.material as T.ShaderMaterial;
      assert.equal(material.depthWrite, false);
      assert.equal(material.depthTest, true);
      assert.equal(material.side, T.FrontSide);
      assert.equal(material.uniforms.displayContrast.value, 1.35);
      assert.equal(material.blending, T.NormalBlending);
      const bounds = material.uniforms.phaseBounds.value as T.Vector2[];
      assert.equal(bounds.length, 15);
      assert.ok(bounds.every((v) => expectedSigns[id] * (v.y - v.x) > 0.1));
      assert.equal(
        sweep.geometry.getAttribute("rotorXY").count,
        sweep.geometry.getAttribute("position").count,
      );
      assert.ok(sweep.geometry.getAttribute("position").count > 1000);
      rows.push({
        id,
        phase: sample.actuators[id].phase,
        phaseBounds: bounds.map((v) => v.toArray()),
        realExposureVertices: sweep.geometry.getAttribute("position").count,
      });
    }
    if (step === 0 || step === 9)
      report.pixelSamples.push({
        name: `sdk-step-${step + 1}`,
        sample: structuredClone(sample),
        seq: reply.result.seq,
        revision: reply.result.revision,
      });
    const authoritative = structuredClone(runtime.getSnapshot());
    for (let i = 0; i < 16; i++) {
      runtime.advancePresentation(1 / 60);
      paint();
    }
    assert.deepEqual(runtime.getSnapshot(), authoritative);
    assert.equal(runtime.getRenderSample().exposure, null);
    report.live1800.push({
      step,
      seq: reply.result.seq,
      revision: reply.result.revision,
      delivery: reply.result.delivery,
      rows,
    });
  }
  checks.push(
    "真实Python 1800RPM/0.1s连续10步: endpoint保真相同，实际GLB连续曝光15时间区间方向正确，applied确认主节点调用，显示TTL不推进仿真",
  );
  assert.equal(
    (await call({ op: "command", command: "pause", waitApplied: true })).ok,
    true,
  );
  paint();
  assert.equal(runtime.getRenderSample().exposure, null);
  report.pixelSamples.push({
    name: "sdk-pause",
    sample: structuredClone(runtime.getRenderSample()),
  });
  assert.equal(
    (await call({ op: "command", command: "reset", waitApplied: true })).ok,
    true,
  );
  assert.equal(runtime.getRenderSample().exposure, null);
  const independent = await call({
    op: "command",
    command: "set",
    payload: {
      motors: {
        L_Front: { enabled: true, targetRpm: 1800 },
        R_Front: { enabled: true, targetRpm: 840 },
        L_Rear: { enabled: false, targetRpm: 0 },
        R_Rear: { enabled: true, targetRpm: 1260 },
      },
      surfaces: {
        L_Inboard: 12,
        R_Inboard: -11,
        L_Outboard: 6,
        R_Outboard: -4,
        Tail_L: 3,
        Tail_R: -2,
      },
      hatchDeg: 17,
      positionM: [2, 4, -3],
      attitude: [0, 0, 0, 1],
    },
    waitApplied: true,
  });
  assert.equal(independent.ok, true);
  assert.equal(independent.result.delivery, "applied");
  const running = await call({
    op: "command",
    command: "step",
    payload: { dt: 2 },
    waitApplied: true,
  });
  assert.equal(running.ok, true);
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  assert.equal(runtime.getSnapshot().actuators.R_Front.rpm, 840);
  assert.equal(runtime.getSnapshot().actuators.L_Rear.fold, 1);
  checks.push("Python SDK控制四电机、六舵面、舱盖且真实GLB应用");
  const tiltReceipts = [];
  for (const wingTilt of [0, 0.125, 0.5, 0.875, 1, 0, 0.5]) {
    const reply = await call({
      op: "command",
      command: "set",
      payload: { wingTilt },
      waitApplied: true,
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.delivery, "applied");
    paint();
    assertRuntimePose(rig, wingTilt);
    tiltReceipts.push({
      wingTilt,
      seq: reply.result.seq,
      revision: reply.result.revision,
      delivery: reply.result.delivery,
      internalDrive: driveAssert.check(),
      rodEndpoints: rig.braces.map((b) => ({
        side: b.side,
        body: b.body.getWorldPosition(new T.Vector3()).toArray(),
        wing: b.wing.getWorldPosition(new T.Vector3()).toArray(),
        length: b.length,
        scale: b.rod.scale.toArray(),
      })),
    });
  }
  report.v22WingTiltReceipts = tiltReceipts;
  checks.push(
    "V22真实SDK驱动0/.125/.5/.875/1/0/.5转换：共用横梁/丝杠/驱动电机、定长杆端与独立电机状态实际应用",
  );
  const frozen = structuredClone(runtime.getSnapshot().actuators);
  for (let i = 0; i < 100; i++) paint();
  assert.deepEqual(runtime.getSnapshot().actuators, frozen);
  assert.equal(runtime.stepLocal(1), false);
  checks.push("外控屏蔽本地时钟，重复绘制不推进");
  for (const payload of [
    { wingTilt: 0.9, motors: { R_Rear: { targetRpm: -1 } } },
    { positionM: [1, 2, 3], attitude: [0, 0, 0, 0] },
    { surfaces: { Tail_R: 13 } },
    { time: { seconds: 5 } },
    { display: { environment: "unknown" } },
    { unexpected: 1 },
  ]) {
    const before = (await call({ op: "snapshot" })).result;
    const bad = await call({ op: "command", command: "set", payload });
    assert.equal(bad.ok, false);
    assert.deepEqual((await call({ op: "snapshot" })).result, before);
  }
  checks.push("非法复合补丁原子拒绝及SDK序号恢复");
  const seq = running.result.seq,
    body = {
      protocol: PROTOCOL,
      sessionId: sid,
      seq,
      op: "step",
      payload: { dt: 2 },
    },
    dup = await json("/api/v1/commands", body);
  assert.equal(dup.body.duplicate, true);
  assert.deepEqual(runtime.getSnapshot().actuators, frozen);
  const conflict = await json("/api/v1/commands", {
    ...body,
    payload: { dt: 3 },
  });
  assert.equal(conflict.status, 409);
  checks.push("重复命令幂等，序号内容冲突拒绝");
  const beforeDrop = structuredClone(runtime.getSnapshot().actuators);
  stream!.drop();
  await wait(30);
  paint();
  assert.equal(runtime.getRenderSample().exposure, null);
  report.pixelSamples.push({
    name: "sdk-disconnect",
    sample: structuredClone(runtime.getRenderSample()),
  });
  const offline = await call({
    op: "command",
    command: "step",
    payload: { dt: 0.4 },
  });
  assert.equal(offline.ok, true);
  assert.deepEqual(runtime.getSnapshot().actuators, beforeDrop);
  stream!.reconnect();
  await until(
    () => runtime.getSnapshot().revision === offline.result.revision,
    "Last-Event-ID重连追赶",
  );
  assert.notDeepEqual(runtime.getSnapshot().actuators, beforeDrop);
  checks.push("断连冻结、带Last-Event-ID重连只应用缺失事件");
  for (const seconds of [20, 1, 1, 86400]) {
    const seek = await call({
      op: "command",
      command: "seek",
      payload: { seconds },
      waitApplied: true,
    });
    assert.equal(seek.ok, true);
    assert.equal(runtime.getSnapshot().actuators.L_Front.fold, 1);
    assert.equal(runtime.getSnapshot().state.time.seconds, seconds);
  }
  const beyond = await call({
    op: "command",
    command: "step",
    payload: { dt: 0.01 },
  });
  assert.equal(beyond.ok, false);
  checks.push("正反重复seek安全重建与86400秒边界");
  const reset = await call({
    op: "command",
    command: "reset",
    waitApplied: true,
  });
  assert.equal(reset.ok, true);
  assert.equal(runtime.getSnapshot().state.time.seconds, 0);
  assert.equal(runtime.getSnapshot().state.hatchDeg, 0);
  checks.push("reset完整清理");
  const second = await json("/api/v1/sessions", {
    protocol: PROTOCOL,
    clientName: "other",
  });
  assert.equal(second.status, 409);
  const closed = await call({ op: "close" });
  assert.equal(closed.ok, true);
  await until(() => runtime.getSnapshot().state.owner === "ui", "会话释放事件");
  assert.ok(!runtime.getSnapshot().error?.includes("拒绝"));
  checks.push("独占会话拒绝抢占、释放消息可跨协议解析");
  await bridge.close();
  assert.equal(runtime.getSnapshot().control, "local");
  const paints = paintCount;
  runtime.dispose();
  assert.throws(() => runtime.setLocal({ wingTilt: 1 }));
  await wait(30);
  assert.equal(paintCount, paints);
  checks.push("桥退出、控制权复位、销毁后无应用");
  const recording = {
    protocol: PROTOCOL,
    commands: [
      {
        op: "set",
        payload: { motors: { L_Front: { enabled: true, targetRpm: 1800 } } },
      },
      { op: "step", payload: { dt: 2 } },
      {
        op: "set",
        payload: { motors: { L_Front: { enabled: false, targetRpm: 0 } } },
      },
      { op: "step", payload: { dt: 5 } },
    ],
  };
  const parsed = parseRecording(JSON.stringify(recording));
  assert.equal(parsed.actuators.L_Front.fold, 1);
  checks.push("协议JSON确定性回放");
  report.passed = true;
} catch (error) {
  report.error = String(error);
  report.stack = (error as Error).stack;
  process.exitCode = 1;
} finally {
  unsubscribe();
  await bridge.close(false);
  sdk.stdin.end();
  sdk.kill("SIGTERM");
  server.kill("SIGTERM");
  report.paintCount = paintCount;
  report.streamEvents = streamEvents.length;
  report.transportErrors = transportErrors;
  report.serverLog = errors;
  report.sdkLog = sdkError;
  report.sourceSha256 = Object.fromEntries(
    [
      "src/simulation.ts",
      "src/simulationBridge.ts",
      "src/motors.ts",
      "src/rig.ts",
      "src/rotorExposure.ts",
      "src/rotorExposureProfile.ts",
      "python/transwing_sim/protocol.py",
      "python/transwing_sim/server.py",
      "python/transwing_sim/client.py",
    ].map((p) => [
      p,
      createHash("sha256").update(readFileSync(p)).digest("hex"),
    ]),
  );
  layer.dispose();
  writeFileSync(
    process.env.QA_OUT ?? "qa/current/results/python-render-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
