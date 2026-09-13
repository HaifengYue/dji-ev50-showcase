# v09 验证与交付记录

日期：2026-09-13。视觉资产为 v09，页面控制契约仍为 API 3.0。

## 已完成

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 与 Vite 生产构建 | 通过；Three.js 分块有超过 500 kB 的体积提示 | `npm run build` |
| 三条任务回归 | 通过，每条 10,801 个 60 Hz 样本，共 32,403 个 | `flight_tests.json` |
| API 网关、HTTP 服务 | 通过 | `npm run test:api` |
| 展示逻辑 | 7 组通过，使用 DOM 与编码器替身 | `presentation_tests.json` |
| GLB 完整校验 | 0 错误、39 警告、95 条信息；未截断 | `gltf_validator.json` |
| 网页模型与 v09 输出 | SHA-256 一致 | 下方资产标识 |
| 本地静态服务 | 首页 HTTP 200；不代表浏览器成功渲染 | `npm run dev` |

模型文件与页面资源共同 SHA-256：

```text
A031DE58A0CE30ADF4E9D531E61B240537C97770AD0CA5E2916396BADE7C012F
```

模型包含 131 个 mesh objects、8 个垂起轴心和 3 个巡航轴心。v09 的七视图为此前已生成的材质预览；本次导出使用 `--export-only`，没有重新渲染这些图片。源 Blender 结构和控制轴心保留。

## 验证边界

自动浏览器验收调用在执行前被安全检查拦截，未产生浏览器截图或测试结果。实际桌面/移动端布局、产品与户外视觉、各相机和画质、PNG 非空画面、视频编码/播放、真实后台切换和端到端 HTTP 到页面控制仍需浏览器验收。逻辑测试生成的是内存中的模拟数据，没有将其作为真实媒体文件交付。

模型法线贴图使用运行时生成的切线空间，存在兼容性警告。尝试显式切线时出现零长度向量，已撤回该导出设置。此前校验器的 100 条上限会截断报告，现提高为 10,000 条；当前结果完整，不以“0 错误”表示“无警告”。

当前渲染器帧率未实测，也未宣称具有确定的实时性、物理准确性或官方外观精度。录屏功能已实现，但没有完成 v09 成片。旧 50 秒 MP4 和旧离线渲染脚本继续保留为历史资料；本轮没有发布或验证线上站点。

## 当前文件

源码：`threejs/src/presentation.ts`、`main.ts`、`environment.ts`、`style.css` 与 `threejs/index.html`。展示功能不增加 API 3.0 操作名，截图/光线/沉浸逻辑与任务控制分开。

资产：`models/v09/ev50_v09.blend`、`models/v09/ev50_v09.glb`、`threejs/public/ev50.glb`、`previews/v09/`。重建入口：`blender/polish_visuals.py`，依赖 v08 源场景。

交付包：`deliverables/EV50_project_v09.zip`，打包入口 `scripts/package_v09.py`。包内 `MANIFEST.json` 包含文件尺寸和 SHA-256；同一清单也写至工作区 `docs/package_v09.json`。包含源码、生产构建、v08 重建依赖和 v09 资产，不包含 node_modules、旧电影、历史图像序列或原始参考媒体。

复查命令（在 `threejs` 目录执行）：

```powershell
npm ci
npm run build
node test-flight.mjs
npm run test:api
npm run test:presentation
node validate-glb.mjs
```
