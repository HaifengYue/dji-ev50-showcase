# EV50 浏览器 API（v3.3）

EV50 是部署到 GitHub Pages 的静态 Three.js 应用，没有常驻服务端。因此 API 在当前页面上下文执行：入口为 `window.ev50API`，而不是一个可从其他设备访问的 HTTP 服务。基础控制操作映射到 `/api/v1/...` 资源路径；视景仿真操作仅在页面内公开，并在能力响应的 `browserOperations` 字段列出，不能假定存在同名 HTTP 路由。

## 快速开始

等待模型加载后再调用：

```js
const ev50 = window.ev50API;
if (!ev50.ready) throw new Error('请等待模型加载');

ev50.position([0, 180, 0]);
ev50.motor(0.8, 0.2);
ev50.setRoute('plateau');
ev50.play();
```

API 2.x 的 `motor`、`position`、`velocity`、`attitude`、`euler`、`setRoute`、`play`、`pause`、`resume`、`reset`、`seek`、`setSpeed`、`getState` 和 `subscribe` 均保留。直接方法验证失败时会抛出 `Error`。

## 统一请求接口

新集成推荐使用 `request`。它始终返回结构化结果，不会抛出，因此适合消息桥、自动化与未来网络适配器：

```js
const result = ev50.request({
  id: 'mission-001',
  operation: 'mission.select',
  payload: { route: 'ridge' },
});

if (!result.ok) console.error(result.error.code, result.error.message);
else console.log(result.data);
```

成功结果为 `{ id?, operation, ok: true, data }`；失败结果为 `{ id?, operation, ok: false, error: { code, message } }`。常见错误代码包括 `NOT_READY`、`VALIDATION_FAILED` 和 `OPERATION_UNSUPPORTED`。

| 操作名                                       | 对应资源路径                   | 负载                                               | 返回                     |
| -------------------------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------ |
| `system.health`                              | `GET /api/v1/health`           | —                                                  | 就绪状态、API 版本       |
| `system.capabilities`                        | `GET /api/v1/capabilities`     | —                                                  | 已实现接口、预留命名空间 |
| `flight.state`                               | `GET /api/v1/flight/state`     | —                                                  | 飞行状态快照             |
| `flight.command`                             | `POST /api/v1/flight/commands` | `motor`、`position`、`velocity` 或 `attitude` 指令 | 更新后状态               |
| `flight.play` / `pause` / `resume` / `reset` | `POST /api/v1/flight/{action}` | —                                                  | 更新后状态               |
| `flight.seek`                                | `PUT /api/v1/flight/time`      | `{ seconds }`                                      | 更新后状态               |
| `flight.speed`                               | `PUT /api/v1/flight/speed`     | `{ speed }`，范围 0.25–4                           | 更新后状态               |
| `mission.list`                               | `GET /api/v1/missions`         | —                                                  | 可用航线                 |
| `mission.select`                             | `PUT /api/v1/missions/current` | `{ route }`                                        | 更新后状态               |
| `settings.get`                               | `GET /api/v1/settings`         | —                                                  | 当前展示设置             |
| `settings.update`                            | `PATCH /api/v1/settings`       | 设置的局部对象                                     | 更新后的设置             |

`flight.command` 的例子：

```js
ev50.request({
  operation: 'flight.command',
  payload: {
    type: 'velocity',
    velocity: [8, 0, 6],
  },
});

ev50.request({
  operation: 'settings.update',
  payload: {
    camera: 'follow',
    quality: 'Medium',
    annotations: true,
  },
});
```

`settings.update` 支持 `loop`、`playbackSpeed`、`camera`（`free`、`ground`、`follow`、`side`、`wide`、`fpv`、`down`）、`quality`（`Low`、`Medium`、`High`）和 `annotations`。页面控件与 API 同步更新。

## 实时视景与记录回放（仅浏览器）

这些操作只更新 Three.js 视景，**不会向无人机发送控制指令**。遥测帧为 JSON，必须包含 `version: 1`、单调递增的 `sequence` 与 `time`、`frame`（`SCENE`、`NED` 或 `ENU`）、位置/速度/四元数、11 路 `rotorRpm` 及 `aileron`、`elevator`、`rudder`。

| 操作名                                        | 负载                      | 返回                            |
| --------------------------------------------- | ------------------------- | ------------------------------- |
| `simulation.state`                            | —                         | 来源、传输、丢帧与记录状态      |
| `simulation.frame`                            | 一个遥测帧                | 校验后的实时视景状态            |
| `simulation.connect` / `disconnect`           | `{ url }` / —             | WebSocket 连接状态              |
| `simulation.replay.load` / `sample` / `seek`  | 记录对象 / — / `{ time }` | 回放状态                        |
| `simulation.pause` / `resume`                 | —                         | 回放或实时视景状态              |
| `simulation.record.start` / `stop` / `export` | 导出可选 `{ format }`     | 记录状态或标准化记录            |
| `aircraft.describe` / `camera.describe`       | —                         | 机体挂点、相机内外参            |
| `scene.describe` / `configure` / `query`      | — / 局部设置 / `{ x, z }` | 场景元数据、设置或地面/障碍查询 |

```js
ev50.request({
  operation: 'simulation.frame',
  payload: {
    version: 1,
    sequence: 42,
    time: 12.3,
    frame: 'SCENE',
    position: [40, 120, -18],
    quaternion: [0, 0, 0, 1],
    velocity: [12, 0, 0],
    rotorRpm: [1300, 1300, 1300, 1300, 1300, 1300, 1300, 1300, 1800, 1800, 1800],
    surfaces: { aileron: 0, elevator: 0, rudder: 0 },
  },
});
```

### 日志交换

记录默认导出为 `ev50-json`：无损保存页面所使用的 `SCENE` 视觉帧。导出时传入 `{ format: 'mavlink-jsonl' }`，或在面板选择 **MAVLink JSONL（交换）**，可生成每行一个 JSON 消息的日志，其中包含 `HEARTBEAT`、`LOCAL_POSITION_NED`、`ATTITUDE_QUATERNION` 和 `ACTUATOR_OUTPUT_STATUS`。它还写入 `EV50_VISUAL_FRAME` 用于无损回放。

该格式是面向无人机/机器人工具链的**可读交换格式**，不是 MAVLink 二进制 `.tlog`，也不代表与任意地面站直接互通。导入器能读取这种 JSONL，并能回放由常规 NED 位置、姿态和执行器消息组成的 JSONL（至少两组完整位置和姿态样本）。

## 事件与遥测

为兼容 iframe、嵌入脚本和简单消息桥，可以派发 `ev50-command`。事件既接受旧的指令对象，也接受新请求格式；每次都会在 `window` 上派发 `ev50-result`，其 `detail` 即统一结果对象。

```js
window.addEventListener('ev50-result', (event) => console.log(event.detail));
window.dispatchEvent(
  new CustomEvent('ev50-command', {
    detail: {
      id: 'speed-001',
      operation: 'flight.speed',
      payload: { speed: 2 },
    },
  }),
);

const unsubscribe = ev50.subscribe((state) => {
  // 约每 100 ms 一次；完成后必须取消，防止重复监听。
  console.log(state.position, state.speedMps);
});
unsubscribe();
```

## 后续功能接入约定

新增功能必须先在 `threejs/src/api/contracts.ts` 定义操作名、对应 `/api/v1` 路径和负载/返回类型，再在 `gateway.ts` 的运行时边界实现验证和分发，并为它增加 `test-api.mjs` 回归用例。不要直接从外部脚本改 Three.js 场景或 DOM。

`aircraft`、`camera`、`scene` 与 `simulation` 已有浏览器端实现；`assets`、`telemetry` 仍为预留命名空间。新增操作必须同时更新本文件、`contracts.ts`、`gateway.ts` 以及回归测试；若要通过本机 HTTP 桥调用，也必须新增明确的路由和 Python 客户端支持，避免把仅页面内的操作误报为 HTTP 能力。

若以后部署一个真实服务端，可让 HTTP 路由按上表把请求转换为 `{ id, operation, payload }` 并复用相同的响应结构。不要将浏览器 API 用作真实飞控或安全关键控制系统。

仓库现已提供用于本机开发的 HTTP 轮询桥和 Python 控制脚本，启动与端点说明见 [HTTP_CONTROL.md](HTTP_CONTROL.md)。另提供统一的 MAVLink 风格 WebSocket 状态通道和本机控制脚本，见 [MAVLINK_LOCAL.md](MAVLINK_LOCAL.md)。它们保持浏览器页面为渲染与控制所有者；生产级跨设备控制仍需补充认证、授权、加密传输、限流和 WebSocket 等能力。
