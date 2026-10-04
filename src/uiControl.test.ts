/** 控制器真实运行测试与明确标注的源码/SSR检查；不冒充浏览器交互验收。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { beginLocalControl, escapeTarget } from "./uiControl";
import { MOTOR_IDS, newMotorCommands } from "./motors";
import { PROTOCOL, SimulationRuntime } from "./simulation";
import { SimulationBridge } from "./simulationBridge";
import { RecordingLoader } from "./recordingLoader";
import SimulationPanel from "./SimulationPanel";

const recording = (wingTilt = 0.7) =>
  JSON.stringify({
    protocol: PROTOCOL,
    commands: [
      { op: "set", payload: { wingTilt } },
      { op: "step", payload: { dt: 0.1 } },
    ],
  });

function fixture(interrupt?: () => Promise<Response>) {
  const runtime = new SimulationRuntime();
  const requests: string[] = [];
  let streams = 0;
  let closed = 0;
  const bridge = new SimulationBridge(runtime, {
    origin: "http://localhost:8765",
    viewerId: "ui_control_review",
    fetch: async (input, options) => {
      const path = String(input);
      requests.push(`${options?.method ?? "GET"} ${path}`);
      if (path === "/api/v1/interrupt" && interrupt) return interrupt();
      return new Response(
        JSON.stringify({
          protocol: PROTOCOL,
          service: "transwing-local-bridge",
        }),
      );
    },
    eventSource: () => {
      streams++;
      return {
        addEventListener: () => {},
        onerror: null,
        close: () => {
          closed++;
        },
      };
    },
  });
  const loader = new RecordingLoader(runtime, bridge);
  return {
    runtime,
    bridge,
    loader,
    requests,
    streams: () => streams,
    closed: () => closed,
  };
}

test("手动来源反复进入保留16种独立电机组合与转速，时钟保持可推进", () => {
  const { runtime, bridge, loader } = fixture();
  for (let mask = 0; mask < 16; mask++) {
    const motors = newMotorCommands();
    MOTOR_IDS.forEach((id, index) => {
      motors[id] = {
        enabled: !!(mask & (1 << index)),
        targetRpm: 900 + index * 360,
      };
    });
    runtime.setLocal({ motors, wingTilt: 0.35 }, "manual");
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal(beginLocalControl(runtime, bridge, loader, "manual"), true);
      assert.deepEqual(runtime.getSnapshot().state.motors, motors);
      assert.equal(runtime.getSnapshot().state.wingTilt, 0.35);
      assert.equal(runtime.getSnapshot().state.time.paused, false);
      const before = runtime.getSnapshot().state.time.seconds;
      runtime.stepLocal(0.01);
      assert.ok(runtime.getSnapshot().state.time.seconds > before);
    }
  }
});

test("手动与演示切源清空上一来源电机命令，保留机体姿态并设置相应时钟", () => {
  const { runtime, bridge, loader } = fixture();
  for (const target of ["manual", "demo"] as const) {
    runtime.setLocal(
      {
        wingTilt: 0.62,
        positionM: [1, 2, 3],
        motors: {
          L_Front: { enabled: true, targetRpm: 3600 },
          R_Rear: { enabled: true, targetRpm: 2700 },
        },
      },
      target === "manual" ? "demo" : "manual",
    );
    assert.equal(beginLocalControl(runtime, bridge, loader, target), true);
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.driver, target);
    assert.deepEqual(snapshot.state.motors, newMotorCommands());
    assert.deepEqual(snapshot.state.positionM, [1, 2, 3]);
    assert.equal(snapshot.state.wingTilt, 0.62);
    assert.equal(snapshot.state.time.paused, target === "demo");
  }
});

test("外部与JSON回放保有来源控制权，本地入口不能断开或覆写状态", async () => {
  const f = fixture();
  await f.bridge.connect();
  for (const driver of ["demo", "manual"] as const) {
    const before = f.runtime.getSnapshot();
    const count = f.requests.length;
    assert.equal(
      beginLocalControl(f.runtime, f.bridge, f.loader, driver),
      false,
    );
    assert.equal(f.runtime.getSnapshot(), before);
    assert.equal(f.requests.length, count);
    assert.equal(f.closed(), 0);
  }
  await f.bridge.close();
  f.runtime.replay(recording());
  f.runtime.playReplay(true);
  for (const driver of ["demo", "manual"] as const) {
    const before = f.runtime.getSnapshot();
    assert.equal(
      beginLocalControl(f.runtime, f.bridge, f.loader, driver),
      false,
    );
    assert.equal(f.runtime.getSnapshot(), before);
  }
});

test("已释放的运行时不能被新的本地入口复活", () => {
  const f = fixture();
  f.runtime.dispose();
  const before = f.runtime.getSnapshot();
  assert.equal(beginLocalControl(f.runtime, f.bridge, f.loader, "demo"), false);
  assert.equal(f.runtime.getSnapshot(), before);
  assert.deepEqual(f.requests, []);
});

test("本地演示或手动入口取消待完成导入，迟到文件不能夺回控制", async () => {
  for (const driver of ["demo", "manual"] as const) {
    const f = fixture();
    let finish!: (value: string) => void;
    let applied = 0;
    const pending = f.loader.load(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      () => {
        applied++;
      },
      true,
    );
    assert.equal(f.loader.loading, true);
    assert.equal(
      beginLocalControl(f.runtime, f.bridge, f.loader, driver),
      true,
    );
    f.runtime.setLocal({ wingTilt: 0.25 });
    finish(recording(0.9));
    assert.equal(await pending, false);
    assert.equal(applied, 0);
    assert.equal(f.loader.loading, false);
    assert.equal(f.runtime.getSnapshot().control, "local");
    assert.equal(f.runtime.getSnapshot().driver, driver);
    assert.equal(f.runtime.getSnapshot().state.wingTilt, 0.25);
  }
});

test("尚未开始健康检查的连接意图被新本地操作取消", async () => {
  const f = fixture();
  const pending = f.bridge.connect();
  assert.equal(
    beginLocalControl(f.runtime, f.bridge, f.loader, "manual"),
    true,
  );
  await pending;
  assert.deepEqual(f.requests, []);
  assert.equal(f.streams(), 0);
  assert.equal(f.runtime.getSnapshot().driver, "manual");
});

test("旧桥清理期间排队的接入不能覆盖后来的本地操作，之后仍可正常重连", async () => {
  let release!: (response: Response) => void;
  let waiting = true;
  const f = fixture(() =>
    waiting
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(new Response("{}")),
  );
  await f.bridge.connect();
  const closing = f.bridge.close();
  const connecting = f.bridge.connect();
  assert.equal(f.runtime.getSnapshot().control, "local");
  assert.equal(beginLocalControl(f.runtime, f.bridge, f.loader, "demo"), true);
  f.runtime.setLocal({ wingTilt: 0.43 });
  waiting = false;
  release(new Response("{}"));
  await Promise.all([closing, connecting]);
  assert.equal(f.streams(), 1);
  assert.equal(
    f.requests.filter((path) => path.endsWith("/api/v1/health")).length,
    1,
  );
  assert.equal(f.runtime.getSnapshot().control, "local");
  assert.equal(f.runtime.getSnapshot().state.wingTilt, 0.43);
  await f.bridge.connect();
  assert.equal(f.streams(), 2);
  assert.equal(f.runtime.getSnapshot().control, "external");
  await f.bridge.close();
});

test("Escape优先级覆盖16种可见层组合且没有释放外控的动作", () => {
  for (let mask = 0; mask < 16; mask++) {
    const state = {
      modal: !!(mask & 1),
      menu: !!(mask & 2),
      drive: !!(mask & 4),
      detail: !!(mask & 8),
    };
    assert.equal(
      escapeTarget(state),
      state.modal
        ? "modal"
        : state.menu
          ? "menu"
          : state.drive
            ? "drive"
            : state.detail
              ? "detail"
              : null,
    );
  }
});

function sourceCallbacks(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { source, nodes };
}

test("源码绑定：面板收起仅改变显示；不是浏览器点击验证", () => {
  const { nodes } = sourceCallbacks("./SimulationPanel.tsx");
  const collapse = nodes
    .filter(ts.isJsxOpeningElement)
    .find(
      (node) =>
        node.tagName.getText() === "button" &&
        node.attributes.properties.some(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText() === "aria-expanded",
        ),
    );
  assert.ok(collapse);
  const onClick = collapse.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === "onClick",
  );
  assert.ok(onClick);
  assert.match(onClick.getText(), /setOpen\(!open\)/);
  assert.doesNotMatch(
    onClick.getText(),
    /bridge|leave|onReset|cancelImport|loader/,
  );
});

test("源码绑定：手动回调不调用demo入口，Escape分支不关闭同源桥", () => {
  const { nodes } = sourceCallbacks("./App.tsx");
  const variable = (name: string) =>
    nodes
      .filter(ts.isVariableDeclaration)
      .find((node) => node.name.getText() === name)
      ?.initializer?.getText() ?? "";
  assert.match(variable("manualControl"), /type: "tilt"/);
  assert.doesNotMatch(
    variable("manualControl"),
    /dispatchTilt|localInput|beginLocalControl|setLocal/,
  );
  assert.match(variable("onKey"), /escapeTarget/);
  assert.doesNotMatch(variable("onKey"), /bridge\.close/);
});

test("源码绑定：顶层Escape先捕获消费，导入监听器尊重已处理事件", () => {
  const app = sourceCallbacks("./App.tsx");
  for (const method of ["addEventListener", "removeEventListener"]) {
    const binding = app.nodes
      .filter(ts.isCallExpression)
      .find(
        (node) =>
          node.expression.getText() === `window.${method}` &&
          node.arguments[0]?.getText() === '"keydown"' &&
          node.arguments[1]?.getText() === "onKey",
      );
    assert.ok(binding);
    assert.equal(binding.arguments[2]?.getText(), "true");
  }
  const onKey =
    app.nodes
      .filter(ts.isVariableDeclaration)
      .find((node) => node.name.getText() === "onKey")
      ?.initializer?.getText() ?? "";
  assert.match(onKey, /if \(target\) e\.preventDefault\(\)/);
  const panel = sourceCallbacks("./SimulationPanel.tsx");
  const key =
    panel.nodes
      .filter(ts.isVariableDeclaration)
      .find((node) => node.name.getText() === "key")
      ?.initializer?.getText() ?? "";
  assert.match(key, /!event\.defaultPrevented/);
  assert.match(key, /!document\.querySelector\("\[data-app-dialog\]"\)/);
});

test("源码绑定：弹窗在背景inert前同步保存触发焦点", () => {
  const { nodes, source } = sourceCallbacks("./App.tsx");
  const openModal =
    nodes
      .filter(ts.isVariableDeclaration)
      .find((node) => node.name.getText() === "openModal")
      ?.initializer?.getText() ?? "";
  const capture = openModal.indexOf(
    "modalReturnFocus.current = document.activeElement",
  );
  const open = openModal.indexOf("setModal(kind)");
  assert.ok(capture >= 0 && open > capture);
  assert.match(source, /if \(previous\?\.isConnected\) previous\.focus\(\)/);
});

test("SSR：演示时电机编辑禁用，手动时四机独立可用，外控再次锁定", () => {
  const f = fixture();
  for (const mode of ["demo", "manual", "external"] as const) {
    if (mode === "external") f.runtime.connect();
    else beginLocalControl(f.runtime, f.bridge, f.loader, mode);
    const html = renderToStaticMarkup(
      createElement(SimulationPanel, {
        runtime: f.runtime,
        bridge: f.bridge,
        loader: f.loader,
        onManual: () => {},
        onReset: () => {},
        children: createElement(
          "section",
          { "data-test-flight": "true" },
          "测试飞行序列",
        ),
      }),
    );
    const motors = [
      ...html.matchAll(
        /<input\b[^>]*aria-label="[^"]*电机(?:启动|目标转速)"[^>]*>/g,
      ),
    ].map((match) => match[0]);
    assert.equal(motors.length, 8);
    assert.equal(
      motors.filter((tag) => /\bdisabled=/.test(tag)).length,
      mode === "manual" ? 0 : 8,
    );
    assert.ok(
      html.indexOf("测试飞行序列") < html.indexOf("Python 接入与记录回放"),
    );
    assert.doesNotMatch(
      html.match(/<p role="status">[\s\S]*?<\/p>/)?.[0] ?? "",
      /仿真时间/,
    );
    assert.doesNotMatch(html, /V18/);
  }
});
