import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { MOTOR_IDS, newMotorState, stepMotor } from "./motors";
import {
  PROTOCOL,
  SimulationRuntime,
  applyStatePatch,
  defaultSimulationState,
  parseRecording,
  validateState,
  type StateEnvelope,
} from "./simulation";
import { SimulationBridge, isLocalBridgeOrigin } from "./simulationBridge";
import SimulationPanel from "./SimulationPanel";
import { RecordingLoader, readPythonExample } from "./recordingLoader";
const enabled = { targetRpm: 1800, enabled: true },
  disabled = { targetRpm: 0, enabled: false };
const envelope = (
  revision: number,
  op: StateEnvelope["op"] = "set",
  state = defaultSimulationState(),
  dt?: number,
): StateEnvelope => ({
  protocol: PROTOCOL,
  revision,
  op,
  state,
  ...(dt === undefined ? {} : { dt }),
});

test("电机默认停机收桨，启动展叶完成前RPM恒为零", () => {
  let state = newMotorState();
  assert.equal(state.fold, 1);
  state = stepMotor(state, enabled, 0.64);
  assert.equal(state.rpm, 0);
  assert.ok(state.fold > 0);
  assert.equal(state.phase, 0);
  state = stepMotor(state, enabled, 0.02);
  assert.equal(state.fold, 0);
  assert.ok(state.rpm > 0);
});
test("停止依次减速、正向寻位、折叠；收桨期间中断重新启动连续", () => {
  let state = stepMotor(newMotorState(), enabled, 2),
    stages = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const before = state;
    state = stepMotor(state, disabled, 0.01);
    stages.add(state.stage);
    if (
      state.stage === "indexing" &&
      before.stage === "indexing" &&
      state.phase
    )
      assert.ok(state.phase >= before.phase);
    if (state.fold > 0) {
      assert.equal(state.rpm, 0);
      assert.equal(state.phase, 0);
    }
  }
  assert.deepEqual(
    [...stages],
    ["decelerating", "indexing", "folding", "folded"],
  );
  state = stepMotor(state, enabled, 0.3);
  const fold = state.fold;
  state = stepMotor(state, disabled, 0.1);
  assert.ok(state.fold > fold);
  state = stepMotor(state, enabled, 0.1);
  assert.equal(state.rpm, 0);
  assert.ok(state.fold < 1);
});
test("启停滞回不会在低速阈值间反复展折，零dt完全冻结", () => {
  let state = stepMotor(newMotorState(), { targetRpm: 59, enabled: true }, 1);
  assert.equal(state.fold, 1);
  state = stepMotor(state, { targetRpm: 60, enabled: true }, 2);
  assert.equal(state.requested, true);
  state = stepMotor(state, { targetRpm: 21, enabled: true }, 2);
  assert.equal(state.requested, true);
  const frozen = stepMotor(state, disabled, 0);
  assert.deepEqual(frozen, state);
  state = stepMotor(state, { targetRpm: 20, enabled: true }, 10);
  assert.equal(state.fold, 1);
});
test("大dt采用分段积分，与1000个小步同相位同折角", () => {
  for (const command of [enabled, disabled])
    for (const start of [
      newMotorState(),
      stepMotor(newMotorState(), enabled, 1.37),
    ]) {
      const big = stepMotor(start, command, 60);
      let small = start;
      for (let i = 0; i < 1000; i++) small = stepMotor(small, command, 0.06);
      assert.ok(Math.abs(big.rpm - small.rpm) < 1e-6);
      assert.ok(Math.abs(big.fold - small.fold) < 1e-9);
      assert.ok(Math.abs(Math.sin((big.phase - small.phase) / 2)) < 1e-7);
    }
});
test("非法值、未知字段、错误枚举及无效四元数整批原子拒绝", () => {
  const runtime = new SimulationRuntime();
  for (const patch of [
    { wingTilt: NaN },
    { positionM: [0, Infinity, 0] },
    { positionM: [0, 0] },
    { attitude: [0, 0, 0, 0] },
    { attitude: [1, 1, 1, 1] },
    { surfaces: { R_Inboard: 13 } },
    { motors: { R_Rear: { targetRpm: -1 } } },
    { display: { environment: "space" } },
    { time: { mode: "realtime" } },
    { wingTilt: 0.5, unknown: true },
    { display: { wireframe: "true" } },
  ]) {
    const before = structuredClone(runtime.getSnapshot());
    assert.throws(() => runtime.setLocal(patch as never));
    assert.deepEqual(runtime.getSnapshot(), before);
  }
});
test("拆解与电机启动原子互斥，六片舵面可以分别提交", () => {
  const runtime = new SimulationRuntime();
  runtime.setLocal({
    motors: { L_Front: enabled },
    surfaces: { L_Inboard: 12, R_Inboard: -12, Tail_L: 4, Tail_R: -5 },
    hatchDeg: 22,
  });
  assert.throws(() => runtime.setLocal({ display: { exploded: true } }));
  assert.equal(runtime.getSnapshot().state.surfaces.Tail_R, -5);
  runtime.setLocal({
    display: { exploded: true },
    motors: { L_Front: disabled },
  });
  assert.equal(runtime.getSnapshot().state.display.exploded, true);
});
test("载入前指令只接受不谎报applied，模型首帧确认后才发应用事件", () => {
  const runtime = new SimulationRuntime(),
    events: string[] = [];
  runtime.onEvent((event) => events.push(event.type));
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    motors: { R_Rear: enabled },
  });
  runtime.accept(envelope(1, "set", state));
  runtime.accept(
    envelope(2, "step", { ...state, time: { ...state.time, seconds: 2 } }, 2),
  );
  assert.equal(runtime.markApplied(2), false);
  assert.equal(events.includes("applied"), false);
  assert.equal(runtime.getSnapshot().actuators.R_Rear.rpm, 1800);
  runtime.setReady(true);
  assert.equal(runtime.markApplied(2), true);
  assert.equal(runtime.markApplied(2), false);
  assert.equal(runtime.markApplied(1), false);
});
test("外部模式阻断本地demo，重复/stale revision不重放时间", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    motors: { L_Front: enabled },
  });
  runtime.accept(envelope(4, "step", state, 2));
  const before = structuredClone(runtime.getSnapshot());
  assert.equal(runtime.accept(envelope(4, "step", state, 2)), false);
  assert.equal(runtime.accept(envelope(3)), false);
  assert.equal(runtime.setLocal({ wingTilt: 0.7 }), false);
  assert.equal(runtime.stepLocal(1), false);
  assert.deepEqual(runtime.getSnapshot(), before);
});
test("断线冻结、同viewer增量重连连续，失效历史snapshot安全归零", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    motors: { L_Front: enabled },
  });
  runtime.accept(envelope(1, "step", state, 2));
  const before = runtime.getSnapshot().actuators.L_Front;
  runtime.setConnection("error", "连接中断");
  assert.deepEqual(runtime.getSnapshot().actuators.L_Front, before);
  runtime.accept(envelope(2, "step", state, 0.1));
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  runtime.accept({ ...envelope(10, "snapshot", state), resync: true });
  assert.equal(runtime.getSnapshot().actuators.L_Front.fold, 1);
  assert.match(runtime.getSnapshot().error!, /复位/);
});
test("seek正向、反向与重复目标都安全重建，后续step才再次展开", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    motors: { L_Front: enabled },
  });
  runtime.accept(envelope(1, "step", state, 2));
  for (const [i, seconds] of [20, 1, 1, 200].entries()) {
    runtime.accept(
      envelope(i + 2, "seek", { ...state, time: { ...state.time, seconds } }),
    );
    assert.deepEqual(runtime.getSnapshot().actuators.L_Front, newMotorState());
  }
  runtime.accept(envelope(6, "step", state, 0.1));
  assert.equal(runtime.getSnapshot().actuators.L_Front.stage, "unfolding");
});
test("协议版本、危险输入与未知操作在外部模式原子拒绝", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  for (const bad of [
    { ...envelope(1), protocol: "v0" },
    { ...envelope(1), op: "execute" },
    {
      ...envelope(1),
      state: { ...defaultSimulationState(), attitude: [0, 0, 0, 0] },
    },
    envelope(1, "step", defaultSimulationState(), 61),
  ]) {
    const before = runtime.getSnapshot();
    assert.throws(() => runtime.accept(bad));
    assert.equal(runtime.getSnapshot(), before);
  }
});
test("JSON记录与确定性step结果一致，可暂停、播放及任意逐帧seek", () => {
  const text = JSON.stringify({
    protocol: PROTOCOL,
    commands: [
      {
        op: "set",
        payload: { motors: { L_Front: enabled }, positionM: [1, 2, 3] },
      },
      { op: "step", payload: { dt: 2 } },
      { op: "set", payload: { motors: { L_Front: disabled } } },
      { op: "step", payload: { dt: 5 } },
    ],
  });
  const parsed = parseRecording(text);
  assert.equal(parsed.state.time.seconds, 7);
  assert.equal(parsed.actuators.L_Front.fold, 1);
  const runtime = new SimulationRuntime();
  runtime.replay(text);
  assert.equal(runtime.getSnapshot().replayIndex, 0);
  runtime.playReplay(true);
  runtime.advanceReplay(2);
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  runtime.advanceReplay(5);
  assert.equal(runtime.getSnapshot().replayPlaying, false);
  runtime.replayAt(2);
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  runtime.replayAt(0);
  assert.equal(runtime.getSnapshot().actuators.L_Front.fold, 1);
});
test("记录导入大小、条数、危险字段限制与非法后段原子拒绝", () => {
  const runtime = new SimulationRuntime();
  runtime.setLocal({ wingTilt: 0.4 });
  const before = runtime.getSnapshot();
  for (const text of [
    " ".repeat(1024 * 1024 + 1),
    JSON.stringify({
      protocol: PROTOCOL,
      commands: Array(10001).fill({ op: "reset", payload: {} }),
    }),
    JSON.stringify({
      protocol: PROTOCOL,
      commands: [
        { op: "set", payload: { wingTilt: 0.8 } },
        { op: "set", payload: { hatchDeg: 99 } },
      ],
    }),
    JSON.stringify({
      protocol: PROTOCOL,
      commands: [{ op: "set", payload: { time: { seconds: 99 } } }],
    }),
  ]) {
    assert.throws(() => runtime.replay(text));
    assert.equal(runtime.getSnapshot(), before);
  }
});
test("退出/复位清除桨系、舵面、时间、外部模式；dispose移除事件与订阅", () => {
  const runtime = new SimulationRuntime();
  runtime.setLocal({
    motors: { R_Front: enabled },
    surfaces: { Tail_R: 8 },
    hatchDeg: 33,
  });
  runtime.stepLocal(3);
  runtime.resetLocal();
  assert.deepEqual(runtime.getSnapshot().state, defaultSimulationState());
  for (const id of MOTOR_IDS)
    assert.equal(runtime.getSnapshot().actuators[id].fold, 1);
  let calls = 0;
  runtime.subscribe(() => calls++);
  runtime.dispose();
  runtime.dispose();
  assert.equal(calls, 0);
  assert.equal(runtime.getSnapshot().disposed, true);
  assert.throws(() => runtime.setLocal({ wingTilt: 1 }));
});
function bridgeFixture(origin = "http://127.0.0.1:8765") {
  const runtime = new SimulationRuntime(),
    paths: string[] = [];
  let streamClosed = 0;
  const handlers = new Map<string, (event: MessageEvent) => void>();
  const stream = {
    addEventListener: (type: string, listener: (event: MessageEvent) => void) =>
      handlers.set(type, listener),
    onerror: null as ((event: Event) => unknown) | null,
    close: () => {
      streamClosed++;
    },
  };
  const fetcher = async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return new Response(
      JSON.stringify({ protocol: PROTOCOL, service: "transwing-local-bridge" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const bridge = new SimulationBridge(runtime, {
    origin,
    viewerId: "viewer_test",
    fetch: fetcher as typeof fetch,
    eventSource: (url) => {
      paths.push(url);
      return stream;
    },
  });
  return {
    runtime,
    bridge,
    paths,
    handlers,
    stream,
    closed: () => streamClosed,
  };
}
test("远程静态站不尝试本机端口，不允许跨源URL、任意postMessage", async () => {
  for (const origin of [
    "https://preview.example.com",
    "https://localhost.evil.test",
    "file:///tmp/index.html",
    "https://127.0.0.1.evil.test",
  ])
    assert.equal(isLocalBridgeOrigin(origin), false);
  for (const origin of [
    "http://localhost:8765",
    "http://127.0.0.1:8765",
    "http://[::1]:8765",
  ])
    assert.equal(isLocalBridgeOrigin(origin), true);
  const f = bridgeFixture("https://preview.example.com");
  await f.bridge.connect();
  assert.deepEqual(f.paths, []);
  assert.equal(f.runtime.getSnapshot().control, "local");
  assert.match(f.runtime.getSnapshot().error!, /远程静态/);
});
test("同源连接生命周期：先ready注册、SSE接受、实际应用回执、关闭清理", async () => {
  const f = bridgeFixture();
  await f.bridge.connect();
  assert.ok(f.paths.includes("/api/v1/health"));
  assert.ok(f.paths.includes("/api/v1/viewers"));
  f.handlers.get("state")!({
    data: JSON.stringify(envelope(1)),
  } as MessageEvent);
  assert.equal(f.runtime.getSnapshot().revision, 1);
  assert.equal(f.paths.includes("/api/v1/ack"), false);
  f.runtime.setReady(true);
  f.runtime.markApplied(1);
  await Promise.resolve();
  assert.ok(f.paths.includes("/api/v1/ack"));
  await f.bridge.close();
  assert.equal(f.closed(), 1);
  assert.ok(f.paths.includes("/api/v1/interrupt"));
  assert.ok(f.paths.includes("/api/v1/viewers/viewer_test"));
  assert.equal(f.runtime.getSnapshot().control, "local");
  f.handlers.get("state")!({
    data: JSON.stringify(envelope(50)),
  } as MessageEvent);
  assert.equal(f.runtime.getSnapshot().revision, -1);
});
test("连接中断只冻结，非法SSE不覆盖已显示快照", async () => {
  const f = bridgeFixture();
  await f.bridge.connect();
  f.handlers.get("state")!({
    data: JSON.stringify(envelope(1)),
  } as MessageEvent);
  const state = f.runtime.getSnapshot().state;
  f.handlers.get("state")!({ data: '{"execute":"evil"}' } as MessageEvent);
  assert.equal(f.runtime.getSnapshot().state, state);
  assert.match(f.runtime.getSnapshot().error!, /拒绝/);
  f.stream.onerror!(new Event("error"));
  assert.match(f.runtime.getSnapshot().error!, /冻结/);
  await f.bridge.close();
});
test("仿真面板SSR包含四机独立输入、离线声明、导入和退出入口", () => {
  const f = bridgeFixture();
  const html = renderToStaticMarkup(
    createElement(SimulationPanel, {
      runtime: f.runtime,
      bridge: f.bridge,
      onManual: () => {},
      onReset: () => {},
    }),
  );
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 5);
  assert.match(html, /高速快门扫掠/);
  assert.match(html, /真实瞬时相位/);
  assert.match(html, /退出外控 \/ 复位/);
  assert.match(html, /静态网站不会连接你电脑的端口/);
  assert.match(html, /导入仿真 JSON 记录/);
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /addEventListener\("popstate"/);
  assert.match(app, /runtime\.dispose\(\)/);
  assert.match(app, /useExperience\(!externallyControlled\)/);
});

test("更高revision夹带过期session序号仍被原子拒绝", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  runtime.accept({ ...envelope(1), sessionId: "session_a", seq: 2 });
  const before = runtime.getSnapshot();
  assert.throws(
    () => runtime.accept({ ...envelope(2), sessionId: "session_a", seq: 1 }),
    /序号过期/,
  );
  assert.equal(runtime.getSnapshot(), before);
});
test("完整外部快照不得把缺失的电机或细节静默补零", () => {
  for (const patch of [
    { motors: {} },
    { surfaces: {} },
    { time: { mode: "deterministic", paused: true } },
    { display: { environment: "hangar" } },
  ])
    assert.throws(
      () => validateState({ ...defaultSimulationState(), ...patch }),
      /缺少字段/,
    );
});
test("Python租约释放带原因时正常交还本地控制，不能继续接受旧SSE", async () => {
  const f = bridgeFixture();
  await f.bridge.connect();
  f.handlers.get("state")!({
    data: JSON.stringify({
      ...envelope(2, "interrupt"),
      reason: "lease_expired",
    }),
  } as MessageEvent);
  assert.equal(f.runtime.getSnapshot().control, "local");
  assert.match(f.runtime.getSnapshot().error!, /租约已过期/);
  assert.equal(f.closed(), 1);
  assert.equal(f.paths.includes("/api/v1/interrupt"), false);
});
test("健康检查失败回到本地并给出真实错误，不宣称Python已连接", async () => {
  const runtime = new SimulationRuntime();
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "test",
    fetch: async () => new Response("离线", { status: 404 }),
    eventSource: () => {
      throw new Error("不应建立事件流");
    },
  });
  await bridge.connect();
  assert.equal(runtime.getSnapshot().control, "local");
  assert.equal(runtime.getSnapshot().connection, "error");
  assert.match(runtime.getSnapshot().error!, /未运行/);
});
test("连接检查尚未返回时复位，迟到成功不能重启SSE或覆盖新本地输入", async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const runtime = new SimulationRuntime();
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "test",
    fetch: async (path) =>
      String(path) === "/api/v1/health"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response("{}"),
    eventSource: () => {
      calls++;
      throw new Error("迟到连接不应建立SSE");
    },
  });
  const connecting = bridge.connect();
  await Promise.resolve();
  await bridge.close();
  runtime.setLocal({ wingTilt: 0.7 });
  finish(
    new Response(
      JSON.stringify({ protocol: PROTOCOL, service: "transwing-local-bridge" }),
    ),
  );
  await connecting;
  assert.equal(calls, 0);
  assert.equal(runtime.getSnapshot().state.wingTilt, 0.7);
  assert.equal(runtime.getSnapshot().control, "local");
});
test("迟到DELETE清理不能抹掉关闭后新的本地电机操作", async () => {
  let finish!: (response: Response) => void;
  const runtime = new SimulationRuntime();
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "test",
    fetch: async (path, options) =>
      options?.method === "DELETE"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response(
            JSON.stringify({
              protocol: PROTOCOL,
              service: "transwing-local-bridge",
            }),
          ),
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  const closing = bridge.close();
  assert.equal(runtime.getSnapshot().control, "local");
  runtime.setLocal({ motors: { L_Front: enabled } }, "manual");
  runtime.stepLocal(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  finish(new Response("{}"));
  await closing;
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  assert.equal(runtime.getSnapshot().driver, "manual");
});
test("dispose期间迟到回执失败不能写已释放状态", async () => {
  let rejectAck!: (reason: unknown) => void;
  const runtime = new SimulationRuntime();
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "test",
    fetch: async (path) =>
      String(path) === "/api/v1/ack"
        ? new Promise((_resolve, reject) => {
            rejectAck = reject;
          })
        : new Response(
            JSON.stringify({
              protocol: PROTOCOL,
              service: "transwing-local-bridge",
            }),
          ),
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  runtime.accept(envelope(1));
  runtime.setReady(true);
  runtime.markApplied(1);
  runtime.dispose();
  rejectAck(new Error("网络失联"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().disposed, true);
});

test("连接点击后立即复位也能取消尚未开始的健康检查", async () => {
  const f = bridgeFixture();
  const pending = f.bridge.connect();
  await f.bridge.close();
  await pending;
  assert.deepEqual(f.paths, []);
  assert.equal(f.runtime.getSnapshot().control, "local");
});

const recordingText = (wingTilt = 0.4) =>
  JSON.stringify({
    protocol: PROTOCOL,
    commands: [
      { op: "set", payload: { wingTilt } },
      { op: "step", payload: { dt: 0.1 } },
    ],
  });
test("Python示例仅由点击触发同源读取，HTTP失败和过大内容明确拒绝", async () => {
  const paths: string[] = [],
    signal = new AbortController().signal;
  const text = await readPythonExample(signal, async (path) => {
    paths.push(String(path));
    return new Response(recordingText());
  });
  assert.deepEqual(paths, ["/examples/python-full-flow.json"]);
  assert.equal(parseRecording(text).state.wingTilt, 0.4);
  await assert.rejects(
    readPythonExample(
      signal,
      async () => new Response("未找到", { status: 404 }),
    ),
    /加载失败/,
  );
  await assert.rejects(
    readPythonExample(
      signal,
      async () => new Response(" ".repeat(1024 * 1024 + 1)),
    ),
    /1 MiB/,
  );
});
test("重复导入只应用最后选择，迟到旧文件不能覆盖新回放", async () => {
  const f = bridgeFixture(),
    loader = new RecordingLoader(f.runtime, f.bridge);
  let resolveOld!: (text: string) => void;
  const old = loader.load(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    () => {},
  );
  await loader.load(
    async () => recordingText(0.8),
    () => {},
    true,
  );
  resolveOld(recordingText(0.1));
  assert.equal(await old, false);
  f.runtime.advanceReplay(0.2);
  assert.equal(f.runtime.getSnapshot().state.wingTilt, 0.8);
  assert.equal(loader.loading, false);
});
test("导入期间关闭、Back或复位取消任务，不再复活回放", async () => {
  const f = bridgeFixture(),
    loader = new RecordingLoader(f.runtime, f.bridge);
  let finish!: (text: string) => void;
  const pending = loader.load(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => {},
  );
  loader.cancel();
  f.runtime.setLocal({ wingTilt: 0.3 });
  finish(recordingText(1));
  assert.equal(await pending, false);
  assert.equal(f.runtime.getSnapshot().control, "local");
  assert.equal(f.runtime.getSnapshot().state.wingTilt, 0.3);
});
test("外控中坏记录不打断会话；有效记录先释放外控再进入离线回放", async () => {
  const f = bridgeFixture(),
    loader = new RecordingLoader(f.runtime, f.bridge);
  await f.bridge.connect();
  await assert.rejects(
    loader.load(
      async () => '{"protocol":"invalid"}',
      () => {},
    ),
  );
  assert.equal(f.runtime.getSnapshot().control, "external");
  assert.equal(f.closed(), 0);
  assert.equal(
    await loader.load(
      async () => recordingText(),
      () => {},
      true,
    ),
    true,
  );
  assert.equal(f.closed(), 1);
  assert.equal(f.runtime.getSnapshot().control, "replay");
  assert.equal(f.runtime.getSnapshot().connection, "offline");
  assert.ok(f.paths.includes("/api/v1/interrupt"));
});
test("空记录可导入但不会建立永不停顿的回放时钟", () => {
  const runtime = new SimulationRuntime();
  runtime.replay(JSON.stringify({ protocol: PROTOCOL, commands: [] }));
  runtime.playReplay(true);
  runtime.advanceReplay(1);
  assert.equal(runtime.getSnapshot().replayPlaying, false);
});

test("Python实际协议消息与公开示例经过生产验证器，静态副本逐字一致", () => {
  const source = readFileSync(
    new URL("../examples/python/full_flow.json", import.meta.url),
  );
  const published = readFileSync(
    new URL("../public/examples/python-full-flow.json", import.meta.url),
  );
  assert.deepEqual(published, source);
  const recording = parseRecording(source.toString("utf8"));
  assert.equal(recording.count, 677);
  assert.ok(Math.abs(recording.state.time.seconds - 37) < 1e-8);
  for (const id of MOTOR_IDS)
    assert.deepEqual(recording.actuators[id], newMotorState());
  const fixtures = JSON.parse(
    readFileSync(
      new URL("../python/tests/protocol_events.json", import.meta.url),
      "utf8",
    ),
  );
  const runtime = new SimulationRuntime();
  runtime.connect();
  for (const fixture of fixtures) runtime.accept(fixture);
  assert.equal(runtime.getSnapshot().state.owner, "ui");
  assert.equal(runtime.getSnapshot().state.time.paused, true);
});

test("外部与记录拆解必须立即安全清除残余转速，不能带速分离机翼", () => {
  const runtime = new SimulationRuntime();
  runtime.connect();
  const state = applyStatePatch(defaultSimulationState(), {
    motors: { L_Front: enabled },
  });
  runtime.accept(envelope(1, "step", state, 2));
  assert.equal(runtime.getSnapshot().actuators.L_Front.rpm, 1800);
  const inspection = applyStatePatch(state, {
    motors: { L_Front: disabled },
    display: { exploded: true },
  });
  runtime.accept(envelope(2, "set", inspection));
  assert.deepEqual(runtime.getSnapshot().actuators.L_Front, newMotorState());
  const recording = parseRecording(
    JSON.stringify({
      protocol: PROTOCOL,
      commands: [
        { op: "set", payload: { motors: { L_Front: enabled } } },
        { op: "step", payload: { dt: 2 } },
        {
          op: "set",
          payload: {
            motors: { L_Front: disabled },
            display: { exploded: true },
          },
        },
      ],
    }),
  );
  assert.deepEqual(recording.actuators.L_Front, newMotorState());
});

test("退出必须先完成interrupt再DELETE，删除不能抢先令会话释放404", async () => {
  const runtime = new SimulationRuntime(),
    cleanupCalls: string[] = [];
  let viewerExists = true;
  let finishInterrupt!: () => void;
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "ordered_test",
    fetch: async (path, options) => {
      if (String(path) === "/api/v1/interrupt") {
        cleanupCalls.push("interrupt");
        return new Promise((resolve) => {
          finishInterrupt = () =>
            resolve(
              new Response(viewerExists ? '{"owner":"ui"}' : "{}", {
                status: viewerExists ? 200 : 404,
              }),
            );
        });
      }
      if (options?.method === "DELETE") {
        cleanupCalls.push("delete");
        viewerExists = false;
        return new Response("{}");
      }
      return new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          service: "transwing-local-bridge",
        }),
      );
    },
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  const closing = bridge.close();
  assert.equal(runtime.getSnapshot().control, "local");
  assert.deepEqual(cleanupCalls, ["interrupt"]);
  finishInterrupt();
  const result = await closing;
  assert.deepEqual(cleanupCalls, ["interrupt", "delete"]);
  assert.deepEqual(result, { backendReleased: true, viewerRemoved: true });
});
test("interrupt失败仍注销viewer并立即交还本地，明确后端释放未确认", async () => {
  const runtime = new SimulationRuntime(),
    calls: string[] = [];
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "failure_test",
    fetch: async (path, options) => {
      if (String(path) === "/api/v1/interrupt") {
        calls.push("interrupt");
        return new Response("{}", { status: 500 });
      }
      if (options?.method === "DELETE") {
        calls.push("delete");
        return new Response("{}");
      }
      return new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          service: "transwing-local-bridge",
        }),
      );
    },
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  const closing = bridge.close();
  runtime.setLocal({ wingTilt: 0.7 });
  const result = await closing;
  assert.deepEqual(calls, ["interrupt", "delete"]);
  assert.equal(result.backendReleased, false);
  assert.equal(result.viewerRemoved, true);
  assert.equal(runtime.getSnapshot().state.wingTilt, 0.7);
  assert.match(runtime.getSnapshot().error!, /未确认 Python 会话释放/);
  assert.doesNotMatch(runtime.getSnapshot().error!, /^外部会话已释放/);
});
test("interrupt超时有界后仍尝试DELETE，不受不响应abort的传输适配器阻塞", async () => {
  const runtime = new SimulationRuntime(),
    calls: string[] = [];
  let aborted = false;
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "timeout_test",
    cleanupTimeoutMs: 5,
    fetch: async (path, options) => {
      if (String(path) === "/api/v1/interrupt") {
        calls.push("interrupt");
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<Response>(() => {});
      }
      if (options?.method === "DELETE") {
        calls.push("delete");
        return new Response("{}");
      }
      return new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          service: "transwing-local-bridge",
        }),
      );
    },
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  const result = await bridge.close();
  assert.equal(aborted, true);
  assert.deepEqual(calls, ["interrupt", "delete"]);
  assert.equal(result.backendReleased, false);
  assert.equal(runtime.getSnapshot().control, "local");
  assert.match(runtime.getSnapshot().error!, /租约到期/);
});
test("服务端已释放控制时只注销viewer，不重复interrupt", async () => {
  const f = bridgeFixture();
  await f.bridge.connect();
  const result = await f.bridge.close(true, false);
  assert.equal(result.backendReleased, true);
  assert.ok(f.paths.includes("/api/v1/viewers/viewer_test"));
  assert.equal(f.paths.includes("/api/v1/interrupt"), false);
});
test("外控导入后若后台释放失败，离线回放仍保留未确认警告", async () => {
  const runtime = new SimulationRuntime();
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "import_test",
    fetch: async (path) =>
      new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          service: "transwing-local-bridge",
        }),
        { status: String(path) === "/api/v1/interrupt" ? 500 : 200 },
      ),
    eventSource: () => ({
      addEventListener: () => {},
      onerror: null,
      close: () => {},
    }),
  });
  await bridge.connect();
  const loader = new RecordingLoader(runtime, bridge);
  await loader.load(
    async () => recordingText(),
    () => {},
  );
  assert.equal(runtime.getSnapshot().control, "replay");
  assert.match(runtime.getSnapshot().error!, /未确认原 Python 会话释放/);
});
