# EV50 VTOL 视景演示

这是一个 Blender、TypeScript 和 Three.js 构成的本地无人机视景演示。它提供产品观察、预设任务、统一 MAVLink 风格遥测可视化，以及来自本地 PX4 ULog 的只读回放。它不是飞控、物理仿真器或工程 CAD。

## 启动

```powershell
npm ci
npm --prefix threejs run dev
```

打开终端给出的本机地址。选择“飞行演示”，在“视景仿真”中点击“本地 ULog 回放”，即可通过 `simulation.replay.load` 播放已转换的本地记录。

## 唯一资产与脚本

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
