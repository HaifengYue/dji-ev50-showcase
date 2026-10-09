# EV50 使用说明

## SkyCaptain 双机型入口

顶部机库可切换 EV50 与 SkyTrans；`?aircraft=skytrans` 直达 SkyTrans，旧 `?aircraft=transwing` 会规范到同一机型。SkyTrans 的主标题按当前展示设计为 “Skytrans”，机库、API 和 SDK 的规范产品名为 “SkyTrans”。

产品模式默认自由观察；进入飞行演示自动播放并跟随，再选自由观察可保持手动机位。机构控制不会自动抢占视角。SkyTrans 使用独立 316 秒演示时间表，0.1× 至 4× 播放倍率只改变播放快慢。外控、录制和机型切换的具体限制见 [README](../README.md)、[统一接口](UNIFIED_CONTROL.md) 和 [品牌兼容说明](BRAND-MIGRATION.md)。

以下保留 EV50 原有操作说明。

## 页面模式

“产品展示”用于自由观察机体、自动环绕、截图与录制；“飞行演示”显示连续河谷、山地、村镇与飞行轨迹。右侧分组默认收起，按需展开“视景仿真”或“场景与传感器”。

页面内的 `window.ev50API` 提供任务、手动视觉控制、状态订阅与视景仿真操作。它仅更新浏览器中的模型，不会向真实航空器发出飞控指令。

## 蓝天与飞行场景

在右侧“飞行场景”选择“山区 · 绿色山谷”或“海岛 · 蔚蓝海岸”。先进入“飞行演示”即可看到蓝天白云；产品模式保留摄影棚背景。场景切换保留机型、当前航线/时钟/播放状态、相机与外部控制权，只丢弃旧的视觉尾迹，并在新场景中继续积累。

页面记住当前站点的选择，也支持 `?landscape=mountains` 和 `?landscape=islands`；可与 `aircraft=skytrans` 一起使用。有效直达参数优先，非法值回退到已保存的有效选择或默认山区。禁用本地存储不妨碍使用。

海岛和山区都是程序化虚构视景，不是碰撞地图。低空外部位姿不会被场景擅自抬高。旧 `scene.query` 的 `nominalGroundHeight`/`obstacleCeiling` 继续描述兼容名义地面与包络，不能当作当前海岛渲染面；视觉尾迹使用独立的当前场景净空查询。

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
