# EV50 本地 HTTP 实时控制

本桥接用于实时控制浏览器中已打开的 Three.js 无人机，而不是生成或播放视频。控制服务只监听 `127.0.0.1`，不含认证机制；请仅在本机开发环境使用，不要暴露到局域网或公网。

## 启动

在两个终端中运行：

```powershell
cd threejs
npm run control-server

# 另一终端
npm run dev
```

用以下地址打开页面，使页面主动连接控制服务：

```text
http://127.0.0.1:5173/?apiBridge=http://127.0.0.1:8787
```

页面每 50 ms 拉取待执行指令，并把状态、设置和航线回传。`GET /api/v1/flight/state` 在页面模型就绪并首次回传前会返回 `503 NOT_READY`。

## Python 控制脚本

`threejs/scripts/drone_control.py` 仅使用 Python 标准库。`--wait` 会等待页面执行并返回实际状态：

```powershell
cd threejs
python scripts/drone_control.py health
python scripts/drone_control.py --wait motor 0.8 0.2
python scripts/drone_control.py --wait position 42 190 -35
python scripts/drone_control.py --wait velocity 8 0 6
python scripts/drone_control.py --wait route plateau
python scripts/drone_control.py --wait configure --camera follow --quality Medium
python scripts/drone_control.py state
```

可用子命令：`health`、`capabilities`、`state`、`missions`、`settings`、`play`、`pause`、`resume`、`reset`、`motor`、`position`、`velocity`、`attitude`、`seek`、`speed`、`route`、`configure`。

## HTTP 接口

| 方法与路径 | 作用 | 请求体示例 |
|---|---|---|
| `GET /api/v1/health` | 控制桥就绪状态 | — |
| `GET /api/v1/flight/state` | 页面实时飞行状态 | — |
| `POST /api/v1/flight/commands` | 手动控制 | `{"type":"position","position":[42,190,-35]}` |
| `POST /api/v1/flight/{play,pause,resume,reset}` | 播放控制 | `{}` |
| `PUT /api/v1/flight/time` | 定位任务时间 | `{"seconds":30}` |
| `PUT /api/v1/flight/speed` | 设置播放倍率 | `{"speed":2}` |
| `GET /api/v1/missions` / `PUT /api/v1/missions/current` | 读取/切换航线 | `{"route":"ridge"}` |
| `GET` / `PATCH /api/v1/settings` | 读取/更新页面设置 | `{"camera":"follow"}` |
| `GET /api/v1/requests/{id}` | 查询异步指令执行结果 | — |
| `GET /api/v1/telemetry` | SSE 实时状态流 | — |

写入类接口先返回 `202` 和请求 ID；待页面执行后，使用 `GET /api/v1/requests/{id}` 获取统一 API 响应。页面端仍执行 API 3.0 的校验，例如电机功率、速度倍率、四元数和航线 ID 的无效值会在执行回执中返回 `VALIDATION_FAILED`。

新增页面功能时，请同时在 `src/api/contracts.ts`、`src/api/gateway.ts`、`control-server.mjs`、Python 客户端及其测试中增加对应接口，避免 HTTP 和页面内 API 脱节。
