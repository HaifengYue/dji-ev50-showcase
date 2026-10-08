# EV50 / Transwing 多机型视景机库

这是一个 Blender、TypeScript 和 Three.js 构成的本地无人机视景演示。机库可在 EV50 与 Transwing P4 之间切换，两者使用同一个原生 Three.js 画布、渲染器和主展示框架。它提供产品观察、预设任务、统一 MAVLink 风格遥测可视化，以及来自本地 PX4 ULog 的只读回放。它不是飞控、物理仿真器或工程 CAD。

## 启动

```powershell
npm ci
npm ci --prefix threejs
npm --prefix threejs run dev
```

打开终端给出的本机地址。选择“飞行演示”，在“视景仿真”中点击“本地 ULog 回放”，即可通过 `simulation.replay.load` 播放已转换的本地记录。

## 机库与机型

- 顶部“机库”切换 EV50 / TRANSWING P4，支持 `?aircraft=ev50` 和 `?aircraft=transwing` 直达及浏览器前进/后退。
- EV50 保留原产品展示、航线、8 + 3 动力系统、MAVLink / ULog 回放、传感器相机及导出。
- Transwing 直接使用 EV50 的产品舞台、光照与动态地形；180 秒共同航线保留连续整翼倾转、四电机折桨、六片独立舵面、舱盖、机构检查、传感器视角及旧 JSON / Python 接口。
- 机型切换清理当前播放、输入、异步导入、外控连接和专属图形资源；切回使用干净状态。切换会取消尚未完成的截图/视频输出，请先完成导出。
- 默认自由观察。机构运动保留观察机位，明确选择检查视角时才重新取景。

[统一 API 与本机服务](docs/UNIFIED_CONTROL.md) · [场景迁移](docs/SCENE-CONTROL-MIGRATION.md) · [集成说明](docs/INTEGRATION.md) · [验证范围与结果](docs/INTEGRATION-VERIFICATION.md) · [Transwing 本机 Python](models/transwing/PYTHON.md)

## 统一外部控制开发

```sh
npm --prefix threejs run build
npm --prefix threejs run control:hangar
```

打开唯一打印的本机地址（默认 `http://127.0.0.1:8790/?control=local`）。两机型共用 `window.hangarAPI.request` 与 `/api/hangar/v1`；先查询能力和当前机型版本，再取得控制租约。外部位姿采用米、Y-up 和 XYZW 四元数，时间只由 `clock.step` 前进，执行结果在渲染后确认。页面的“统一 API 控制”可断开并释放。服务仅绑定 loopback，无认证凭据或公网入口。此接口驱动视觉模型，不控制实体飞机。

旧 EV50 和 Transwing API 仍是分别兼容的机型专属入口，不能同时取得写控制权。完整契约、Python 标准库示例与迁移限制见[统一控制文档](docs/UNIFIED_CONTROL.md)。

## EV50 资产与脚本

- `models/ev50.blend`：可编辑的飞机源工程。
- `models/ev50.glb`：导出的通用模型。
- `threejs/public/ev50.glb`：网页加载的运行时模型。
- `previews/aircraft/`：当前模型的固定视角预览。
- `blender/export_aircraft.py`：唯一的模型导出入口。
- `scripts/replay_log.py`：唯一的日志检查与 ULog 转换入口。

导出模型：`D:\blender\blender.exe -b --python blender/export_aircraft.py`。

转换日志（原始 `.ulg` 默认保持本地、不进入 Git）：

```powershell
python scripts/replay_log.py models/SITL_optimal.ulg --inspect
python scripts/replay_log.py models/SITL_optimal.ulg threejs/public/flight-replay.json
```

转换器读取位置、姿态和执行器主题，输出最多 12,000 帧的网页回放 JSON；为避免穿入地形，它只对整条轨迹应用固定的视觉原点平移。执行器归一化值仅映射为视觉转速，不代表实测 RPM。

## 验证

```powershell
npm run ci
node threejs/test-airframe.mjs
```

接口和集成说明见 [API](docs/API.md)、[本机 HTTP 控制](docs/HTTP_CONTROL.md)、[MAVLink 风格状态通道](docs/MAVLINK_LOCAL.md) 与[使用说明](docs/USER_GUIDE.md)。

## Transwing 源资产

- `models/transwing/assets/blender/xp4.blend`：完整可编辑原生模型。
- `threejs/public/transwing/models/xp4.glb`：网页使用的运行时模型。
- `models/transwing/`：原生模型、动画参考、契约、当前重建/验证工具和 Python 桥。
- `threejs/src/aircraft/transwing/`：原生机型适配器及可测试核心。

源版本和几何哈希见 [来源记录](models/transwing/PROVENANCE.md)。
