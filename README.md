# SkyCaptain · EV50 / SkyTrans 交互飞行机库

[![Build and test](https://github.com/HaifengYue/sky-captain/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HaifengYue/sky-captain/actions/workflows/ci.yml)
[![Chromium shared hangar](https://github.com/HaifengYue/sky-captain/actions/workflows/integration-browser.yml/badge.svg?branch=main)](https://github.com/HaifengYue/sky-captain/actions/workflows/integration-browser.yml)

**在一个场景里观察两种飞行器，从机体细节到完整飞行演示。**

SkyCaptain（空中机长）是由 Blender、TypeScript 和 Three.js 构成的交互视景机库。EV50 与 SkyTrans 共用一个主画布、渲染器、产品舞台和可切换地景，提供可编辑模型、确定性演示/回放与本机外部控制接口。

[打开公开机库](https://haifengyue.github.io/sky-captain/) · [直接观察 SkyTrans](https://haifengyue.github.io/sky-captain/?aircraft=skytrans) · [使用指南](docs/USER_GUIDE.md) · [文档导航](docs/README.md) · [开发约定](CONTRIBUTING.md)

> SkyTrans 是本项目的模型名称，原整合版本称为 Transwing。它是依据公开资料制作的非官方视觉重建，不是厂家改名、官方数字模型、飞控、工程 CAD 或经过认证的物理仿真器。参考机型规格与本项目演示配置分别标注。

## 主要能力

| 能力       | EV50                                             | SkyTrans                                                |
| ---------- | ------------------------------------------------ | ------------------------------------------------------- |
| 机体与机构 | 复合翼机体、8 个垂起旋翼 + 3 个巡航推进单元      | 连续整翼转换、四电机折桨、六片独立舵面、货舱盖          |
| 飞行演示   | 180 秒任务，山谷/高原/山脊航线                   | 共用水平航线，独立 316 秒演示时间表                     |
| 观察       | 自由、地面、侧面、跟随、远景、机鼻/下视          | 自由、正面、侧面、俯视、左右关节、跟随、远景、机鼻/下视 |
| 数据接入   | EV50 API、MAVLink 风格 JSON、PX4 ULog 转换后回放 | Python 桥、独立电机/舵面控制、JSON 记录回放             |
| 统一接口   | `hangar.control.v1`，浏览器与本机 HTTP           | 同一接口、租约和生命周期，独立执行器契约                |

- 产品模式默认自由观察；明确进入“飞行演示”会播放并跟随。机构操作保留观察机位，只有明确选择视角才重新取景。
- 山区与海岛共用蓝天、程序云与渐隐航迹。切换场景保留飞机、仿真时间、播放状态、相机和控制租约，只重建地景并断开旧航迹。
- 机型切换清理旧机型的播放、输入、外控连接、异步导入和专属资源；尚未完成的截图/视频输出会取消。
- 支持 `?aircraft=ev50`、`?aircraft=skytrans`，以及 `?landscape=mountains`、`?landscape=islands`。旧 `?aircraft=transwing` 规范为同一个 SkyTrans 实例。

![EV50 透视模型预览](previews/aircraft/perspective.png)

更多固定视角见 [previews/aircraft](previews/aircraft/)。这些图是视觉预览，不是尺寸检验或硬件性能报告。

## 本地启动

需要 **Node.js 24**（与 `.nvmrc` 和 CI 一致）。从仓库根目录执行：

```sh
npm ci
npm ci --prefix threejs
npm --prefix threejs run dev
```

打开终端打印的地址。普通机库、机构操作和 JSON 回放不依赖 Python 或 Blender；需要支持 WebGL 的浏览器。

构建与预览：

```sh
npm --prefix threejs run build
npm --prefix threejs run preview
```

唯一部署产物为 `threejs/dist/`。Vite 使用相对资源路径，支持 GitHub Pages 仓库子路径；构建后自动从规范资产生成旧 `transwing/` 资源 URL 的兼容副本，不在源目录维护第二套模型。

## 演示、场景与航迹

SkyTrans 的 [演示配置](threejs/src/aircraft/skytrans/demoProfile.ts) 为 316 秒：180 m 垂直段、上升峰值 3 m/s、下降峰值 2 m/s、各 4 秒起步/制动过渡与 6 秒落地停机。位置与速度使用仿真时间；播放倍率只改变播放快慢。后桨在巡航前减速、寻位和折叠，回转前展开、恢复转速。暂停和跳时保留确定性转子相位，0.1× 可观察实体叶片，高速使用历史相位快门扫掠。这些数值是视觉演示选择，不是厂家性能或实测 RPM。

右侧“飞行场景”选择山区或海岛。新浏览器默认山区，有效 URL 参数优先于站点保存的偏好；存储不可用仍能使用。产品模式保持摄影棚，飞行模式显示景观。

两机型的白色航迹从实际世界位置和当前仿真时间采样，随仿真推进变宽、变淡、消散，暂停时冻结。跳时、重启、切机、控制来源变化或瞬移会断开旧带；稀疏采样也保守断开。Low / Medium / High 的视觉寿命上限为 14 / 20 / 24 个仿真秒，最多 384 个采样点。航迹是风格化路径提示，不是电动无人机必然产生凝结尾迹的物理断言。

景观不是碰撞地图，不会偷偷抬高外部位姿；低空外控可能进入可见地形。操作说明见 [使用指南](docs/USER_GUIDE.md)，视觉与性能证据范围见 [视觉验收](docs/VISUAL-VALIDATION.md)。

## 外部程序接入

新集成优先使用 `window.hangarAPI.request`。本机 HTTP 服务同时支持两机型：

```sh
npm --prefix threejs run build
npm --prefix threejs run control:hangar
```

打开服务打印的地址，默认 `http://127.0.0.1:8790/?control=local`。先读取能力、机型、`generation` 和 `commandEpoch`，再取得唯一控制租约；外部时钟通过 `clock.step` 显式推进。飞机命令只有在实际渲染后才返回 applied ACK。切机、断开、过期或旧 epoch 会使失效命令无法继续应用。

服务只绑定 loopback，租约用于协调页面客户端，不是安全认证凭据。公开静态机库不会自动连接或探测本机服务。完整示例、单位、去重和长流会话轮换见 [统一控制接口](docs/UNIFIED_CONTROL.md)。

现有接口继续保留：

- [EV50 浏览器 API](docs/API.md)、[本机 HTTP 桥](docs/HTTP_CONTROL.md)、[MAVLink 风格状态通道](docs/MAVLINK_LOCAL.md)。
- [SkyTrans Python SDK / JSON](models/skytrans/PYTHON.md)：规范导入名 `skytrans_sim`，仍使用 `transwing.sim.v1` 与 `/api/v1`；旧导入名共享同一实现。网页“播放公开 Python 示例”只读取打包 JSON，不执行 Python。
- [接口与端口速查](docs/README.md#接入方式与端口)：EV50 MAVLink 和 SkyTrans Python 桥默认均使用 8765，不能同时占用同一端口。

控制接口与渲染 ACK 证明的是本站视景状态的应用，不构成 UAVRL 训练成功、外部训练环境端到端联调成功或真实飞行安全的证据。

## 目录与模型维护

```text
blender/                         EV50 导出入口
models/ev50.blend、ev50.glb       EV50 源工程与模型
models/skytrans/                 SkyTrans 源资产、SDK、机械契约与验证工具
models/transwing/python/        旧 Python 路径的兼容转发包
threejs/src/aircraft/            机型注册、异步生命周期与适配器
threejs/src/control/             统一契约、租约、校验与渲染 ACK
threejs/src/simulation/          EV50 遥测、记录回放和场景描述
threejs/public/                  网页运行时资产
threejs/e2e/                     Chromium 真实页面回归
scripts/replay_log.py            EV50 ULog 检查与转换
previews/                        固定视角预览
docs/                            使用、接口、架构和验证说明
```

SkyTrans 原生模型、GLB、动画 clip 与机械证据的内部标识保留，`xp4` 是内部资产变体 ID。来源和哈希见 [PROVENANCE](models/skytrans/PROVENANCE.md)，重建见 [REBUILD](models/skytrans/REBUILD.md)，兼容映射见 [品牌迁移](docs/BRAND-MIGRATION.md)。EV50 导出与 ULog 转换命令见 [使用指南](docs/USER_GUIDE.md#ev50-模型与-ulog-维护)。原始 `.ulg` 默认为本地文件，不随仓库提供。

## 验证与发布

完整非浏览器校验还需要 **Python 3**：

```sh
npm run ci
# 真实浏览器测试另行安装 Chromium，并先构建：
npx --prefix threejs playwright install --with-deps chromium
npm --prefix threejs run build
npm --prefix threejs run test:browser
```

`npm run ci` 执行格式、TypeScript/构建与根目录 `test` 的所有契约、飞行、模型、景观和 Python 测试，不包含 Chromium 或完整 Blender 重建。浏览器套件会启动本机测试服务，端口需求、分层检查和发布流程见 [CONTRIBUTING](CONTRIBUTING.md)。

历史验证记录只证明其所列提交；当前候选须查看同一 SHA 的普通 CI、三个 Chromium job 与部署后的公开 Pages 验证。部署完成不等于后续公开页面验收通过。见 [文档导航中的历史记录](docs/README.md#历史依据)。

## 来源与限制

- SkyTrans 依据 Pterodynamics Transwing P4 公开资料进行非官方视觉重建；内部传动、行程、转角、转速和停止/折桨时序含理想化约定。
- 页面引用的参考机型 41 kg、6.8 kg、31 m/s、70 min 来自[厂商 2025 年公开资料](https://pterodynamics.com/media/PD_TranswingSpecs_2025.pdf)，不是 SkyTrans 实机性能或模型计算结果。
- 本项目不证明连续无碰撞、制造可行性、结构强度或适航性。几何/纹理计数不是物理显存、实机 GPU 或 FPS 基准。
- 第三方许可见 [THIRD_PARTY_NOTICES](models/skytrans/THIRD_PARTY_NOTICES.txt)。仓库没有适用于整个工程的统一许可证；这些 notices 不授予原作者之外的额外素材权利。
