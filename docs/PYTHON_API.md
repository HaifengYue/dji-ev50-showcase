# Python 视景接口

本 API 为原创三维概念模型提供位置、姿态与动作输入。它不连接真实无人机、飞控、串口、ROS 或 MAVLink；没有空气动力学、重力、碰撞、推力或真实电机参数求解。RPM、行程、轨迹和时间常数均为视景演示参数。

## 1. 独立安装和启动

以下命令在当前工程根目录执行。Python 需要 3.10 或更高版本，服务、SDK 和测试只依赖标准库，`python/requirements.lock` 无第三方依赖。当前工程已完成26项Python单测，并在本轮原65阶段正式验收中执行实际SDK/HTTP/SSE/生产GLB链路；报告见 `qa/frontend/summary.json` 与 `qa/current/results/python-render-report.json`。

安装器在当前项目建立 `.venv` 并在该虚拟环境内注册 `python/` 包路径，整个步骤不联网、不安装到全局环境。移动或重新解压工程后再运行安装器即可。

Linux / macOS：

```sh
python3 python/install.py
npm ci
npm run build
.venv/bin/python -m transwing_sim.server
```

Windows PowerShell：

```powershell
py -3 python/install.py
npm ci
npm run build
.\.venv\Scripts\python.exe -m transwing_sim.server
```

也可不安装 SDK、直接启动服务：`python3 python/run_server.py`（Windows 用 `py -3 python/run_server.py`）。

打开 `http://127.0.0.1:8765`，在网页中启用 Python 外部控制，然后在第二个终端运行：

```sh
.venv/bin/python examples/python/full_flow.py --live
```

PowerShell 对应：

```powershell
.\.venv\Scripts\python.exe examples/python/full_flow.py --live
```

构建脚本必须保留 `vite build --emptyOutDir false`，不清空已有 `dist/`。

服务默认同源提供构建后的 `dist/` 和 `/api/v1/*`；仅允许绑定 `127.0.0.1`。`--port 8765`、`--dist dist` 可显式指定本机端口与静态产物目录，不提供公网 host 选项。开发服务器 `npm run dev` 的来源不同，不要把它和本机 API 直接混接。

**远程静态网页只运行网页和 JSON 回放，不运行此 Python 服务。** 不从远端静态页面控制本机 API，不开启跨来源访问。完整实时 Python 接入需在本独立工程的本机/独立开发环境中启动同源服务。安装隔离指本工程及其依赖目录，不表示新建虚拟机。

## 2. 最小 SDK 示例

```python
from transwing_sim import Client

with Client(client_name="本地演示") as sim:
    if not sim.ready(timeout=10):
        raise RuntimeError("没有已连接且模型就绪的查看器")
    sim.reset()
    sim.set_pose([0, 2, 0], [0, 0, 0, 1])
    sim.set_motor("L_Front", 1800, enabled=True)
    sim.set_state(wingTilt=0.4, surfaces={"Tail_L": 6}, hatchDeg=0)
    receipt = sim.step(1 / 30, wait_applied=True)
    print(receipt["delivery"], receipt["appliedViewers"])
    sim.stop_motors()
```

`with` 退出会关闭会话、释放外部控制权，并将服务的电机目标设为停用/0 RPM。关闭只是目标状态与所有权变更；查看器收到 `interrupt` 后执行安全静态复位。网络异常导致关闭未送达时，SDK会报错，服务租约最多30秒后在活动连接/下次请求中失效；不会假报已停止的屏幕结果。

主要方法：

- `connect()` / `close()`：独占会话建立、关闭；对象关闭后用新的 `Client`
- `ready(timeout=0)`：检查已连接、模型就绪的真实查看器；只读 SDK 订阅者不计入
- `set_pose(position_m, attitude_xyzw)`：位置、四元数
- `set_motor(id, target_rpm, enabled=True)`、`stop_motors()`：独立电机目标
- `set_state(**patch)`：原子状态补丁，包括机翼、舵面、货舱和显示
- `step(dt)` / `seek(seconds, state=None)` / `pause(paused=True)` / `reset()`：确定性时间与安全复位
- `snapshot()`：服务当前目标快照；不是实际屏幕读回
- `receipt(seq)` / `wait_applied(receipt, timeout=5)`：查看器应用确认
- `subscribe(after_revision=None)`：可关闭的只读状态迭代器（`with sim.subscribe() as events:`），不创建控制权或伪造模型 ready
- `start_recording()` / `save_recording(path)` / `replay(recording)`：录制接受的命令、保存及重放
- `heartbeat()`：手动续租；SDK默认后台每10秒自动续租，不推进仿真时间
- `retry_pending()`：传输结果不确定时，用完全相同的 `sessionId/seq` 幂等重试

`set_state`、`set_pose`、`set_motor`、`step`、`seek` 和通用 `command` 支持 `wait_applied=True`。这会等待应用回执；没有查看器、被跳过或超时会抛出 `ApplicationTimeout`，异常的 `.receipt` 含具体状态。不要把异常吞掉后声称运行成功。

## 3. 坐标、单位和状态

协议标识固定为 `transwing.sim.v1`。这是通信兼容合同，不是工程发行标签；整理文档和路径时不能随意改名。

坐标为右手 Three.js 场景坐标：`+X` 为模型 R 侧，`+Y` 向上，`+Z` 指向机头。与 NED、ENU、机体 FRD 坐标不相同，不做隐式转换。`positionM` 是相对于模型正常停放参考位置的世界坐标位移，renderer 另加模型接地偏移；`[0,0,0]` 对应地面默认停放，而不是 GLB 网格原点恰好落在地板。约定一渲染/模型单位等于一米，几何未经实机尺寸标定，不能作测量依据。

`attitude=[x,y,z,w]` 为主动旋转单位四元数（机体到场景），右手方向；模长容差0.001，接受后归一化。零四元数、不完整数组、NaN、Infinity 和字符串数字均拒绝。

状态字段：

| 字段 | 类型与范围 | 说明 |
| --- | --- | --- |
| `owner` | `ui` / `external` | 只读；通过会话接管/释放，不能 set |
| `positionM` | 三个有限数，逐项 ±100000 | 约定米；宽界仅防无效输入，不代表飞行包线 |
| `attitude` | 四个有限数，单位模长 | `[x,y,z,w]` |
| `motors` | 四个独立对象 | `L_Front`、`R_Front`、`L_Rear`、`R_Rear` |
| `motors[id].targetRpm` | 0—12000 | 目标幅值；旋转方向由现有模型确定，不接受负RPM |
| `motors[id].enabled` | 严格布尔值 | false的有效运行目标为0；保留的 targetRpm 不表示实际转速 |
| `wingTilt` | 0—1 | 0收拢、1展开；理想化整翼进度，不是弧度或角度 |
| `surfaces` | 六个独立角度，各 −12°—12° | `L_Inboard`、`R_Inboard`、`L_Outboard`、`R_Outboard`、`Tail_L`、`Tail_R` |
| `hatchDeg` | 0°—55° | 货舱盖角度 |
| `display.wireframe` | 布尔值 | 线框 |
| `display.exploded` | 布尔值 | 拆解安全检视；所有电机必须在同一次原子状态中 disabled 且 targetRpm=0 |
| `display.environment` | `hangar` / `sky` | 场景背景 |
| `time.seconds` | 0—86400 | 只可通过 step/seek/reset改变，不能塞入set补丁 |
| `time.mode` | `deterministic` | 外部控制仅确定性时钟 |
| `time.paused` | 布尔值 | 暂停标记；显式 step 仍可单步推进 |

补丁允许只指定一个电机的一个字段、一个舵面或一个显示字段；先与当前状态合并，再完整校验，错误不产生部分更新、不消耗序号、不增加 revision。未知字段一律拒绝。舵面的正号按模型各自铰轴符号定义，不等价于真实飞控滚转/俯仰/偏航混控。

`targetRpm` 是命令目标；实际视景电机转速、相位、寻位和折桨状态由前端共用运动模型在每次 step 后计算。ACK 的可选 `motors` 仅报告前端运动状态，不回写目标，也不是实机传感器数据。`GET state` 始终返回服务目标。

## 4. 唯一时钟、接管与退出

1. 网页显式启用外控后注册查看器、订阅 SSE；模型 ready 前不发 applied
2. SDK `connect()` 建立独占会话，`owner=external`；其他客户端接管返回409
3. 浏览器 UI/自动演示停止对动作状态计时。只有 Python 的 `step` 推进外部时间、电机渐变和相位；网页帧刷新仅绘制
4. `set` 原子改变目标，不推进时间；`step {dt}` 接受0—60秒，即使 paused=true也允许显式单步；`pause(false)` 本身也不会启动第二时钟
5. 模拟实时运行时，由 Python 自行按 wall-clock 节奏重复调用 `step(dt)`，不可再启动浏览器动作计时器
6. `seek` 设置绝对时间并重建电机历史为静止/收拢；可同时给状态补丁，后续 step 从新目标启动。跳转不能保留“上一段播放积累的角动量”
7. `reset` 恢复地面、单位姿态、收翼、零舵面、闭舱、停桨、0秒、暂停；保留当前 external 会话所有权
8. 网页“退出外部控制”、SDK close或30秒租约到期：owner回ui、暂停、停用四电机，前端安全复位，不自动恢复飞行演示。旧session之后的命令被拒绝

默认快照不携带前端运动历史。新查看器、服务重启、历史溢出或 JSON 跳转都会安全重建静止/收拢状态。若需确定性复现同一电机相位/折桨过程，应从初始 reset 逐条重放记录到指定点；不要把“把时间改成37秒”等同于“已演算37秒运动”。

使用完整快照作为恢复输入时：

```python
from transwing_sim import snapshot_to_patch
saved = sim.snapshot()
sim.seek(saved["state"]["time"]["seconds"], snapshot_to_patch(saved))
```

辅助函数移除只读 `owner` 和 `time.seconds`，其余目标作为补丁；本操作仍安全重建运动历史。

## 5. REST、SSE 与真实应用回执

所有 POST 正文为 UTF-8 JSON，最大1 MiB、最多32层嵌套，无重复字段、NaN或Infinity。没有通用跨源 CORS 或 postMessage 控制入口。

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /api/v1/health` | `{protocol,service:'transwing-local-bridge',version,connectedViewers,owner,revision}` |
| `GET /api/v1/state` | `{protocol,revision,state,op:'snapshot'}` |
| `POST /api/v1/sessions` | `{protocol,clientName}` → `{sessionId,nextSeq:1,leaseSeconds:30,revision}` |
| `POST /api/v1/sessions/{id}/heartbeat` | `{}` → 续租和nextSeq |
| `DELETE /api/v1/sessions/{id}` | 幂等关闭并释放控制权 |
| `POST /api/v1/commands` | 下述命令信封；HTTP202只表示accepted |
| `GET /api/v1/commands/{sessionId}/{seq}` | 当前命令回执 |
| `POST /api/v1/viewers` | `{viewerId,ready}`，可选protocol；必须在模型真正ready后设true |
| `GET /api/v1/events?viewerId=...` | SSE `state`、`heartbeat`；观察者ready=false，不计入connectedViewers |
| `POST /api/v1/ack` | `{viewerId,revision,applied:true/false,motors?,error?}` |
| `DELETE /api/v1/viewers/{id}` | 注销查看器、关闭当前SSE；可重复调用 |
| `POST /api/v1/interrupt` | `{viewerId}`，查看器退出外控 |

命令信封：

```json
{"protocol":"transwing.sim.v1","sessionId":"服务生成的会话ID","seq":1,"op":"set","payload":{"wingTilt":0.5}}
```

操作与 payload：

- `set`：上节允许的部分状态，直接作为 payload，不再包 `state`
- `step`：`{"dt":0.0333333333}`
- `seek`：`{"seconds":12,"state":{"positionM":[0,2,0]}}`，state可省略
- `pause`：`{"paused":true}`，空对象默认true
- `reset`：`{}`

同 session 的 seq 必须从1连续递增。同seq同内容重发返回同revision且 `duplicate=true`，不再次执行；同seq不同内容、跳号、过旧未留存序号均409。SDK并发线程通过锁串行化命令。收到传输错误时它保留待处理命令，禁止发送新命令，直到 `retry_pending()` 确认同一命令结果；不能假定超时意味着未执行。

回执：

```json
{"protocol":"transwing.sim.v1","sessionId":"...","seq":1,"revision":2,"accepted":true,"delivery":"pending","appliedViewers":[],"rejectedViewers":{},"duplicate":false}
```

- `accepted=true`：服务校验、按序接受并存入目标状态
- `delivery=no_viewer`：当前没有模型ready且SSE连接中的查看器；HTTP仍可接受命令，不能说屏幕成功
- `delivery=pending`：有ready查看器，尚无该revision应用确认
- `delivery=applied`：至少一个查看器明确确认该revision已经应用；`appliedViewers` 标明是谁
- `delivery=superseded`：未确认此revision，但查看器已经应用更晚revision；常见于断连后快照恢复，不能把被跳过命令算成功
- `rejectedViewers`：查看器拒绝应用时的错误；不把拒绝改写成成功

applied只证明查看器代码报告已应用状态。它不证明显示器已经显示像素、真实浏览器/手机验收通过，也不证明所有查看器都应用。新查看器快照会按安全重建规则应用当前目标；要证明完整step历史逐条执行，须逐条等待ACK且不中途换新查看器。

SSE `state` 数据为 `{protocol,revision,state,op,dt?,seq?,sessionId?,reason?,resync?}`。`op`还包括 `snapshot`、`interrupt`；后者reason为`client_closed`/`viewer_interrupted`/`lease_expired`/`service_closed`。只有 `step` 带dt。事件id为revision，非命令序号。heartbeat不改变revision、不驱动运动。

服务保存最近4096条事件、每会话4096条回执、最多32个会话历史。重连使用 `Last-Event-ID` 或 `afterRevision`，按原顺序回放缺失事件、不合并step；超过历史窗口会给 `op=snapshot,resync=true`，明确丢弃运动历史。前端应忽略已应用的重复revision。查看器主动DELETE会被删除；断连闲置项可回收，反复刷新不会永久耗尽64个活跃查看器容量。

## 6. Python离线记录与静态网页

```python
from transwing_sim import Recording

record = Recording().reset()
record.set_state(wingTilt=.35)
record.set_state(motors={"L_Rear": {"targetRpm":1800,"enabled":True}})
for _ in range(90):
    record.step(1/30)
record.set_state(motors={"L_Rear": {"targetRpm":0,"enabled":False}})
for _ in range(120):
    record.step(1/30)
record.save("independent-rear.json")
```

格式为 `{protocol,commands:[{op,payload}]}`，payload必需，即使reset也为`{}`。记录最多10000条、UTF-8不超过1 MiB。`Recording`逐条验证；`validate_recording()`可验证自制记录；SDK `replay()`先reset再逐条执行，因此重复回放目标一致。静态页面可导入同一JSON，并由前端生产解析器验证与播放。浏览器本地回放无需Python服务器。

随工程提供：

- `examples/python/full_flow.py`：不加参数离线生成JSON；`--live`通过服务逐条驱动并等待ACK
- `examples/python/full_flow.json`：由脚本生成，演示起飞、转换、环绕、回转、降落、停桨，以及六舵面和舱门检视；命令数、时长和哈希应从实际随包文件核对
- `examples/python/drive_trajectory.py`：姿态沿圆周切线、30Hz显式step轨迹
- `examples/python/independent_motors.py`：四台电机顺序独立启停
- `python/tests/protocol_events.json`：真实Bridge生成的跨语言信封fixture（不是屏幕证据）

## 7. 安全边界与测试

只接受端口匹配的 `127.0.0.1` / `localhost` Host、本机Origin；拒绝其他Origin、null Origin、cross-site请求，无任意CORS。静态读取限制在dist目录，阻止路径穿越和指向目录外的符号链接。不会创建持久凭证、修改系统网络安全设置或开放公网端口。

这是一台可信个人开发电脑上的本地桥，不是多用户认证服务。会话ID只用于临时互斥控制；本机其他进程仍能访问loopback，不能把它当认证边界或部署在不可信共享主机上。服务未作生产级抗DDoS设计。

运行：

```sh
.venv/bin/python -m unittest discover -s python/tests -v
```

PowerShell：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s python/tests -v
```

覆盖协议范围/类型/非有限数、四元数、单位边界、原子安全模式、确定性回放、顺序与重复冲突、并发、租约和退出、断开/重连、过旧历史、安全Host/Origin/路径/JSON大小、模拟响应丢失的幂等重试、真实HTTP/SSE传输与模拟查看器ACK。跨端真实生产运行时与GLB链路检查位于 `qa/current/`，前端与Python五阶段入口为 `qa/frontend/run.py`；两项入口均已在当前工程实际执行通过。Python 测试不是浏览器像素、真实手机或实机飞控测试。

结构机器说明见 `python/protocol.schema.json`（JSON Schema 2020-12）；四元数单位长度、状态合并后的安全约束与时间累计上限等跨字段语义仍需运行时验证。当前工程的最终 Python 结果须在迁移后重新运行并绑定实际文件，不沿用旧测试日志作为通过结论。这里提供 Windows 与 Linux/macOS 命令，不表示已在各平台完成实测。完整覆盖见 [验证说明](VERIFICATION.md)。

### 突发发送与回执顺序

SDK线程并发会被串行接受，但若调用者连续突发命令而不等待应用，浏览器的多个ACK网络请求仍可能乱序到达；旧ACK会被拒绝，回执可能保守地显示 `superseded`，即使运动runtime曾处理该状态。需要逐帧确认时，请像所附实时示例一样对每条命令使用 `wait_applied=True`，不要把快速批量 `accepted` 列表当作逐帧应用证明。离线JSON回放始终按命令记录顺序求解。
