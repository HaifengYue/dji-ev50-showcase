# 本地 MAVLink 风格视景控制

这是用于浏览器三维视景的**本机测试通道**，不接串口、不发送 MAVLink 二进制包，也不能控制真实飞行器。服务只绑定 `127.0.0.1`，消息为一行一个 JSON 的 MAVLink 命名结构；其目的在于让控制器、记录和可视化在开发环境中可以联调。

## 启动与连接

```powershell
cd threejs
npm run mavlink-server

# 另一终端启动页面
npm run dev
```

页面加载后，展开 **视景仿真**，保持“本地 MAVLink 测试服务”，点击“连接”。外部集成只需切换为“外部 MAVLink WebSocket”，填写使用相同消息协议的 `ws://` 或 `wss://` 地址。

## 本地控制脚本

`scripts/mavlink_visual_control.py` 只使用 Python 标准库，默认只允许连接环回地址。每个命令会返回 `EV50_COMMAND_ACK` 及完整状态快照：

```powershell
python scripts/mavlink_visual_control.py arm
python scripts/mavlink_visual_control.py takeoff 30
python scripts/mavlink_visual_control.py position 40 10 -30
python scripts/mavlink_visual_control.py velocity 8 0 0
python scripts/mavlink_visual_control.py attitude 1 0 0 0 --thrust .7
python scripts/mavlink_visual_control.py actuators .15 -.08 .05 .75 .35
python scripts/mavlink_visual_control.py transition fw
python scripts/mavlink_visual_control.py mission ridge
python scripts/mavlink_visual_control.py land
```

如需一次写入多个状态输入，可使用：

```powershell
python scripts/mavlink_visual_control.py control --position-ned 10 0 -25 --surfaces .1 0 -.1 --lift-rpm 1350 --cruise-rpm 600
```

可用操作包括 `state`、`arm`、`disarm`、`takeoff`、`land`、`transition`、`pause`、`resume`、`position`、`velocity`、`attitude`、`actuators`、`mode`、`mission` 和 `control`。

## 消息映射

服务向可视化页面以 20 Hz 广播以下状态：

| 消息                           | 用途                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `HEARTBEAT` / `SYS_STATUS`     | 链路、模式、电量演示状态                                                  |
| `LOCAL_POSITION_NED`           | 位置和速度；`z` 为向下，故高度为 `-z`                                     |
| `ATTITUDE_QUATERNION`          | `q1,q2,q3,q4`（`w,x,y,z`）姿态                                            |
| `ACTUATOR_OUTPUT_STATUS`       | 8 个升力旋翼与 3 个巡航旋翼 RPM；前三个 `controls` 是副翼、升降舵、方向舵 |
| `VFR_HUD` / `EV50_VTOL_STATUS` | 速度、高度、VTOL 模式和任务状态                                           |

控制端接受 `COMMAND_LONG`（解锁、起飞、降落、暂停、VTOL 转换）、`SET_POSITION_TARGET_LOCAL_NED`、`SET_ATTITUDE_TARGET`、`SET_ACTUATOR_CONTROL_TARGET`、`SET_MODE`、`MISSION_SET_CURRENT` 与开发用 `EV50_CONTROL` 批量状态消息。未实现的消息返回 `DENIED`，不会被静默忽略。

浏览器只消费状态消息；所有本地控制输入先由测试服务仿真，再以状态回流到页面。因此页面不会向真实无人机、地面站或任何网络主机发送命令。

## 验证

```powershell
npm run test:api
```

其中包含本地 WebSocket 服务的端到端测试：验证状态流、解锁、起飞和执行器控制输入。完整仓库验证使用 `npm run ci`。
