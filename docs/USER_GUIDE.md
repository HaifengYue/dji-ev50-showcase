# SkyCaptain 使用指南

SkyCaptain 将 EV50 与 SkyTrans 放在同一个交互机库中。页面只控制三维可视模型，不向真实航空器发出飞控指令。启动命令见 [项目 README](../README.md#本地启动)。

## 选择机型与场景

顶部机库切换 EV50 / SkyTrans，也支持直达参数：

- `?aircraft=ev50`：EV50。
- `?aircraft=skytrans`：SkyTrans；旧 `aircraft=transwing` 自动规范到同一机型。
- `?aircraft=skytrans&landscape=islands`：SkyTrans 与海岛场景。

未知机型回退到 EV50。同页前进/后退会选择对应机型；加载失败可重试或切到另一机型。SkyTrans 主画面标题采用 “Skytrans” 的展示字形，机库/API/SDK 的规范产品名为 “SkyTrans”。

切机后旧模型的播放、输入、外控、导入、回放和专属资源被清理，重新进入时是新状态。切机不会保留未完成的截图或视频；需要保留的输出请先等到下载完成。

## 观察与飞行

- “产品展示”使用摄影棚，默认自由观察，可拖动/缩放观察模型。
- 明确进入“飞行演示”会播放并切到跟随视角；再点击已播放中的飞行按钮不重置时间。
- 需要自己的构图时选择“自由观察”。SkyTrans 的机构滑块、独立电机/舵面操作不会自动重新取景；检查正面、关节等请明确选择对应视角。
- 顶部视角菜单随机型变化；两机型均可使用跟随、远景、机鼻和下视视角。
- 右侧面板按组展开；小屏幕可用“展示设置”收起面板，给三维画面留空间。

EV50 保留 180 秒任务。SkyTrans 的本地飞行演示为 316 秒，覆盖起飞、转换、巡航、回转、降落与完整停机。SkyTrans 0.1× 慢放便于观察实体桨叶；演示倍率改变播放快慢，不更改仿真时间定义或模型性能。

SkyTrans 时间轴随状态使用不同单位：

| 当前来源          | 时间轴与操作                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| 本地机构          | 0–100% 展开进度，机构速度 0.25–2×                                                    |
| 本地飞行          | 仿真秒，播放速度 0.1–4×                                                              |
| JSON 回放         | 页面显示帧数，内部 seek 为零基帧索引；支持暂停、跳帧、重启与 0.1×/1×，锁定模式与循环 |
| Python / 统一外控 | 由外部所有者掌握时钟和状态，不能用本地播放控件抢占；观察相机仍可用                   |

灰色控件可能表示当前状态由回放或外部程序占用。先在相应面板停止回放或释放/断开控制，再开始另一来源。协议层详细限制见 [统一接口](UNIFIED_CONTROL.md) 与 [Python 接入](../models/skytrans/PYTHON.md)。

## 山区、海岛与渐隐航迹

右侧“飞行场景”可选“山区 · 绿色山谷”或“海岛 · 蔚蓝海岸”。进入飞行模式才显示蓝天白云和地景，产品模式保持摄影棚。更换场景保留机型、航线、仿真时钟、播放、相机与控制权，旧航迹清空后重新积累；重复选择当前场景不会重置。

有效 `landscape=mountains` / `landscape=islands` 参数优先于站点保存的选择；非法值使用有效保存值，否则回到山区。浏览器禁用本地存储仍可正常使用。选择质量 Low / Medium / High 可调整显示负载，不会改变权威飞行数据。

“航迹”控制白色渐隐路径。它读取实际世界位置和仿真时间，飞行时积累并消散，暂停时冻结。跳时、重启、切机、换数据源或瞬移会断开旧带；外部数据间隔超过 0.6 个仿真秒时也保守断开。因此刚跳时后没有长航迹是正常行为，需要连续播放积累。

两种景观都是程序化虚构视景，不是碰撞地图；低空外部位姿不会被擅自抬高。旧 EV50 `scene.query` 的 `nominalGroundHeight` / `obstacleCeiling` 仍描述兼容名义地面与包络，不能当作当前岛岸/山地渲染面。白色航迹是路径提示，不是凝结尾迹的物理模拟。

## 记录与程序接入

### EV50

展开“视景仿真”可连接 MAVLink 风格 JSON 状态、加载示例、导入记录或使用“本地 ULog 回放”。后者读取已打包的 `threejs/public/flight-replay.json`，网页不直接解析原始 `.ulg`。播放/暂停、重启和时间轴控制当前回放。

导入控件最多接受 16 MiB 的 EV50 JSON / MAVLink JSONL 文件；格式、帧数和样本仍须通过协议校验。导出 EV50 JSON 可保留页面所使用的视觉帧，MAVLink JSONL 是可读交换格式，不是二进制 `.tlog`。见 [EV50 API](API.md#日志交换)。

### SkyTrans

“播放公开 Python 示例”读取打包 JSON，不执行 Python。导入记录最多 1 MiB、10,000 条命令，校验成功后才接管模型。需要运行 SDK 时先构建页面，从仓库根目录启动 `python3 models/skytrans/python/run_server.py`，打开服务打印的地址，再选择“连接本机 Python 桥”。完整命令、Windows 环境变量和协议见 [Python SDK](../models/skytrans/PYTHON.md)。

### 双机型统一控制

新程序优先使用 [统一控制接口](UNIFIED_CONTROL.md)。浏览器入口为 `window.hangarAPI.request`，本机服务为 `npm --prefix threejs run control:hangar`。每轮控制先读能力和当前 generation/epoch，再获取租约；接受入队不等于已经渲染。

多个本机接口各自独立，默认端口冲突和启动方式见 [端口速查](README.md#接入方式与端口)。不要在公开 Pages 页面中期待自动发现本机 Python 服务。

## EV50 模型与 ULog 维护

以下命令从仓库根目录运行，需要 Python 3。替换自己的 PX4 ULog 时，先检查主题，再生成运行时 JSON：

```sh
python3 scripts/replay_log.py path/to/flight.ulg --inspect
python3 scripts/replay_log.py path/to/flight.ulg threejs/public/flight-replay.json
```

Windows 可将 `python3` 替换为本机的 `python`。原始 `.ulg` 默认为本地文件，不包含在仓库中；根目录 `replay:inspect` / `replay:build` 的便捷脚本假设它位于 `models/SITL_optimal.ulg`。

转换器只依赖 Python 标准库，最多输出 12,000 帧，读取位置、速度、姿态及可用执行器主题。轨迹相对首帧重置并施加固定视觉平移，不重算动力学，也不保证避开当前可见山地；执行器归一化值映射为视觉转速，不是实测 RPM。

编辑 `models/ev50.blend` 后可导出：

```sh
blender -b --python blender/export_aircraft.py
```

Blender 不在 PATH 时改用本机可执行文件完整路径。导出器维护源工程中的模型元数据，写出 `models/ev50.glb` 并复制到网页运行时位置。`previews/aircraft/` 的固定视角图片需单独重渲染。SkyTrans 使用独立 [重建流程](../models/skytrans/REBUILD.md)，不要用 EV50 导出器处理它。

## 排查入口

- 模型未就绪：查看加载错误，使用重试按钮；确认资源通过 HTTP 服务访问且浏览器支持 WebGL。
- 本机服务连接失败：确认使用服务打印的页面地址、已构建 `threejs/dist/`、端口未被另一个桥占用。
- 控件被锁：检查 Python、JSON 或统一控制的所有权，先在对应入口释放。
- 修改源码后本机桥仍显示旧页面：重新执行前端 build；桥提供的是 `dist/`，不是 Vite 热更新。
- 需要报告问题：注明提交、机型、场景、质量、控制来源与复现步骤，并区分截图问题和协议错误。

开发校验见 [CONTRIBUTING](../CONTRIBUTING.md)，真实视觉验收范围见 [VISUAL-VALIDATION](VISUAL-VALIDATION.md)。
