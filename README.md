# DJI EV50 VTOL 3D 展示与飞行演示

本项目包含 Blender 建模工程、GLB 模型，以及 Vite + TypeScript + Three.js 交互式展示页面。当前为 **v09 / API 3.0**，浏览器预设任务为 **180 秒**。这是非官方视觉演示，模型细节为参考图像基础上的独立设计，不是工程 CAD 或真实飞行控制软件。

## 当前版本 v09（2026-09-13）

网页已接入 `models/v09/ev50_v09.glb`，增加机壳涂层、复材法线细节与金属材质调整，沿用 v08 的外形和 8+3 动力部件层级。新增三分之四/正面/侧面/俯视预设、自动环绕、日光/金色时刻、沉浸展示、PNG 保存和浏览器录屏。小屏通过“展示设置”展开控制面板。

录屏只包含三维画面，无 HTML 面板或声音，最长 200 秒；输出格式由浏览器支持决定。按 Escape 可退出沉浸展示，录制期间沉浸视图保留停止按钮。这些展示操作不改变 API 3.0 契约；切换产品模式仍采用原有任务重置语义。

构建、飞行/API 回归、7 组展示逻辑测试已通过。完整 GLB 校验为 **0 错误、39 警告**，没有截断报告。**本轮浏览器自动验收被安全检查拦截，尚未验证实际渲染、真实文件编码或移动端布局。** 详情见 [v09 验证记录](docs/VALIDATION_V09.md)；操作见 [使用说明](docs/USER_GUIDE.md)。以下历史章节不代表当前版本。

## 本地运行

```powershell
cd threejs
npm ci
npm run dev
```

打开终端提示的地址即可查看。页面支持产品展示、飞行演示、时间轴拖动、循环、五种相机、部件说明和 Low/Medium/High 画质。

## 构建与验证

```powershell
cd threejs
npm run build
node test-flight.mjs
npm run test:api
npm run test:presentation
node validate-glb.mjs
```

当前交付包为 `deliverables/EV50_project_v09.zip`，包含源码、构建文件、v08 重建依赖、v09 模型、七视图与验证说明；包内 `MANIFEST.json` 记录逐文件 SHA-256。可运行 `python scripts/package_v09.py` 重新打包；它会核对模型版本、校验报告和 ZIP 完整性。

历史 50 秒视频位于 `renders/EV50_flight_50s_1080p.mp4`，图像序列位于 `renders/flight_sequence_v02/`。它们没有重制为 v09，不能代表当前外观或任务，未收入本轮包。旧 `deliverables/EV50_project.zip` 同样保留为历史交付；本轮文件清单以 v09 验证记录为准。

## Blender

运行 `blender -b --python blender/polish_visuals.py`，从 `models/v08/ev50_v08.blend` 生成 v09 模型、GLB 和七视图。追加 `-- --export-only` 可只重建模型和 GLB，保留现有预览。随后将 `models/v09/ev50_v09.glb` 复制至 `threejs/public/ev50.glb` 并运行完整校验。Blender 未加入 PATH 时使用实际安装路径，例如 `D:\blender\blender.exe`。

建模依据和历史修正记录见 `docs/ASSUMPTIONS.md` 与 `docs/ITERATION_LOG.md`。`blender/render_flight.py` 仍引用旧版资产，未同步 v09。

## GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。将 `main` 推送到 GitHub 后，Actions 会自动构建 `threejs/dist` 并发布到 GitHub Pages；仓库设置中将 Pages Source 设为 **GitHub Actions** 即可。

官方参考页面：[DJI EV50](https://www.dji.com/cn/ev50)

## 控制 API

完整、版本化的接口契约和后续功能接入约定见 [docs/API.md](docs/API.md)。页面内 API 可配合已有的本机 HTTP 桥使用。

本地实时 HTTP 控制桥与 Python 示例脚本见 [docs/HTTP_CONTROL.md](docs/HTTP_CONTROL.md)。它通过 HTTP 指令实时驱动浏览器内的 Three.js 模型，不播放离线视频。

页面加载后可通过 `window.ev50API` 发送指令，所有指令都由统一的飞行控制器处理：

```js
ev50API.motor(0.85, 0.0);                 // 垂起/巡航电机功率 0–1
ev50API.position([120, 26, -80]);         // 位置（米）
ev50API.velocity([8, 0, 12]);              // 速度（米/秒）
ev50API.attitude([0, 0, 0, 1]);             // 四元数姿态
ev50API.setRoute('plateau');               // valley / plateau / ridge
ev50API.play();
ev50API.pause();
```

也可使用 `window.dispatchEvent(new CustomEvent('ev50-command', {detail:{type:'position', position:[120,26,-80]}}))` 发送同样的结构化指令。航线缩略信息和完成进度显示在飞行演示面板中。

## 历史交付 v05（2026-09-09）

当时网页更新为 v05 模型及 60 秒飞行。固定翼巡航从 14 秒增加到 24 秒，航线扩大到约 96×150 m。新增针叶林、溪流、河岸、起伏地面和岩面远山，支持三档实例密度与 4096 高画质阴影。

当前模型：`models/v05/ev50_v05.blend`、`models/v05/ev50_v05.glb`；七视图：`previews/v05/`；新飞行场景：`models/ev50_flight_scene_v03.blend`；新版包：`deliverables/EV50_project_v05.zip`。

重建当前模型时将上方命令的版本参数改为 `--version 5 --export`。`python scripts/generate_flight.py` 生成 60 秒共享航线。`blender/render_flight.py` 输出新版关键帧，添加 `--sequence` 输出完整 1800 帧。旧版 `EV50_flight_50s_1080p.mp4` 仍为上一轮成片，本轮只完成新版关键帧，尚未重新渲染完整视频。

目标仓库：<https://github.com/HaifengYue/dji-ev50-showcase>。推送成功后仍需启用仓库 Settings → Pages → GitHub Actions，并以工作流成功和在线实际加载为发布完成依据。

## 历史 v06：地形与细节更新

该版网页采用 `models/v06` 模型；七视图在 `previews/v06`。运行 `blender -b --factory-startup --python blender/build_model.py -- --version 6 --export` 可重建该版本。

三条航线都从原点停机坪起降，先爬升至 180 m 再巡航。浏览器演示为 240 秒（原始 `flight.json` 60 秒采样按四倍时长重定时），地图显示实际路线、已完成段与当前位置。已有离线视频保持原版，尚未同步此路线。

进入 `threejs` 后运行 `npm run build`、`node test-flight.mjs` 和 `node validate-glb.mjs` 检查。净空测试涵盖每条路线完整 240 秒、60 Hz 采样以及重置/循环/指令控制。当前山体包围高度下界验证余量为 49 m；地形有改动时必须重新检查。

控制指令仍通过 `window.ev50API` 调用。位置单位米、速度单位米/秒、姿态为 `[x,y,z,w]` 四元数，电机功率为 `[0,1]`。位置/速度指令有目标高度保护，演示路线为预规划避障；不用于真实飞控。`setRoute()` / 重新开始清除手动指令，`play()` 恢复航线播放。

## 历史 v08 / API 3.0（2026-09-11）

使用与集成请阅读 [完整说明文档](docs/USER_GUIDE.md)。本版为平滑机壳与主翼直连结构，去除凸起检修罩、降低锁扣和铰链线；源文件/GLB/七视图位于 models/v08、previews/v08。High 加入多重采样后处理与轻微泛光，Medium/Low 保持直接渲染。

该版将默认任务时长调整为 **180 秒**，垂起 12 秒、两次悬停各 2 秒，支持页面 0.25×–4× 播放和 m/s 速度显示，明确前向/后向转换标签。API 独立保存位置、速度、姿态和两组电机功率，支持状态查询、订阅、回执、暂停/恢复和调速。这些任务和接口语义在 v09 中沿用。
