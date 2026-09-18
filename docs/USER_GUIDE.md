# EV50 使用说明

## 页面模式

“产品展示”用于自由观察机体、自动环绕、截图与录制；“飞行演示”显示连续河谷、山地、村镇与飞行轨迹。右侧分组默认收起，按需展开“视景仿真”或“场景与传感器”。

页面内的 `window.ev50API` 提供任务、手动视觉控制、状态订阅与视景仿真操作。它仅更新浏览器中的模型，不会向真实航空器发出飞控指令。

## ULog 回放

仓库的运行时回放文件为 `threejs/public/flight-replay.json`。在页面加载后，展开“视景仿真”并点击“本地 ULog 回放”；页面会读取该文件并将内容交给 `simulation.replay.load`。播放、暂停、重新开始和时间轴都直接作用于该回放。

要替换为自己的本地 PX4 ULog：

```powershell
python scripts/replay_log.py path\to\flight.ulg --inspect
python scripts/replay_log.py path\to\flight.ulg threejs/public/flight-replay.json
```

转换器只读取 ULog，并保留位置、速度、姿态以及可用的执行器通道。NED 轨迹相对首帧重置，并以固定视觉高度偏移放在地形上方；它不是重算飞行动力学。

## 模型维护

编辑 `models/ev50.blend` 后运行：

```powershell
D:\blender\blender.exe -b --python blender/export_aircraft.py
```

该导出器会更新模型元数据、写出 `models/ev50.glb`，并复制到网页运行时位置。预览图位于 `previews/aircraft/`；如需刷新它们，可在 Blender 中按固定视角渲染后覆盖同名文件。

## 验证

在仓库根目录运行 `npm run ci`，并运行 `node threejs/test-airframe.mjs` 检查三点式起落架、旋翼、舵面和运行时绑定。运行 `npm --prefix threejs run dev` 后使用本机地址验收实际画面。
