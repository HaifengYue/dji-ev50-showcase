# DJI EV50 VTOL 3D 展示与飞行演示

本项目包含 Blender 可复现建模工程、EV50 GLB 模型、50 秒 30 FPS 飞行演示渲染，以及 Vite + TypeScript + Three.js 交互式展示页面。

## 本地运行

```powershell
cd threejs
npm install
npm run dev
```

打开终端提示的地址即可查看。页面支持产品展示、飞行演示、时间轴拖动、循环、自由/跟随/电影相机、部件说明和 Low/Medium/High 画质。

## 构建与验证

```powershell
cd threejs
npm run build
node test-flight.mjs
node validate-glb.mjs
```

最终视频位于 `renders/EV50_flight_50s_1080p.mp4`，图像序列位于 `renders/flight_sequence_v02/`（发布包中排除该大型中间目录）。完整交付压缩包位于 `deliverables/EV50_project.zip`。

## Blender

使用 `D:\blender\blender.exe -b --factory-startup --python blender/build_model.py -- --version 3 --export` 可重复生成 v03 模型、GLB 和固定视角预览。建模依据、推测边界和每轮修正记录见 `docs/ASSUMPTIONS.md` 与 `docs/ITERATION_LOG.md`。

## GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。将 `main` 推送到 GitHub 后，Actions 会自动构建 `threejs/dist` 并发布到 GitHub Pages；仓库设置中将 Pages Source 设为 **GitHub Actions** 即可。

官方参考页面：[DJI EV50](https://www.dji.com/cn/ev50)

## 当前交付版本（2026-09-09）

网页已更新为 v05 模型及 60 秒飞行。固定翼巡航从 14 秒增加到 24 秒，航线扩大到约 96×150 m。新增针叶林、溪流、河岸、起伏地面和岩面远山，支持三档实例密度与 4096 高画质阴影。

当前模型：`models/v05/ev50_v05.blend`、`models/v05/ev50_v05.glb`；七视图：`previews/v05/`；新飞行场景：`models/ev50_flight_scene_v03.blend`；新版包：`deliverables/EV50_project_v05.zip`。

重建当前模型时将上方命令的版本参数改为 `--version 5 --export`。`python scripts/generate_flight.py` 生成 60 秒共享航线。`blender/render_flight.py` 输出新版关键帧，添加 `--sequence` 输出完整 1800 帧。旧版 `EV50_flight_50s_1080p.mp4` 仍为上一轮成片，本轮只完成新版关键帧，尚未重新渲染完整视频。

目标仓库：<https://github.com/HaifengYue/dji-ev50-showcase>。推送成功后仍需启用仓库 Settings → Pages → GitHub Actions，并以工作流成功和在线实际加载为发布完成依据。
