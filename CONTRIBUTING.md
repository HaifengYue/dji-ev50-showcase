# SkyCaptain 开发与仓库规范

## 环境与安装

- Node.js 24：与 `.nvmrc` 和 GitHub Actions 保持一致。
- Python 3：根目录 `npm test` / `npm run ci` 包含标准库协议与 HTTP 测试；Linux/macOS 使用 `python3`，Windows 包装脚本使用 `python`。
- Chromium：仅真实浏览器测试需要；其本机服务占用 4174、8790、8765。
- Blender 与原生管线依赖：仅模型重建/独立验证需要，普通网页构建不需要。

从仓库根目录执行：

```sh
npm ci
npm ci --prefix threejs
npm --prefix threejs run dev
```

## 目录职责

- `threejs/`：唯一可部署的 Vite + Three.js 应用；部署目录为 `threejs/dist/`。
- `threejs/src/main.ts`：共享宿主与帧循环；`aircraft/` 管理注册、异步选择、资源生命周期与机型适配器。
- `threejs/src/control/`：双机型统一控制；`api/` 与 `simulation/` 保留 EV50 浏览器契约和遥测/回放。
- `threejs/src/terrain.ts`、`island-landscape.ts`、`landscape-sky.ts`、`flight-trail.ts`：程序化景观、天空与仿真时间航迹；`scene-appearance.ts` 集中管理共享曝光、雾与天空配色。
- `threejs/public/`：运行时模型与记录；`models/`、`blender/`：源资产、SDK 和导出工具；`previews/`：受控预览。
- `threejs/e2e/`、`threejs/qa/`、`scripts/`：浏览器验收、测试辅助和发布/数据转换工具。
- `docs/`：当前指南、接口与架构；[历史记录](docs/README.md#历史依据)只保留当时证据。

本地 `references/`、`renders/`、原始 `.ulg`、Blender 自动保存、依赖、构建目录和浏览器报告由 `.gitignore` 排除。`deliverables/*.zip` 不提交；确需发布的归档使用 Release 附件。不要用 `git add -f` 绕过这些边界。`models/` 与 `previews/` 不在根 Prettier 范围内，源资产变更应走各自的验证管线。

## 日常变更

1. 从 `main` 创建 `feature/<主题>` 或 `codex/<主题>` 分支。
2. 先明确变更属于共享宿主、统一控制、EV50 兼容接口还是 SkyTrans 适配器；按能力与所有权边界改动。
3. 同步更新实现、对应测试和文档。统一控制修改 `src/control/` 与 `docs/UNIFIED_CONTROL.md`；EV50 接口修改 `src/api/`、对应桥/客户端和 `docs/API.md` / `docs/HTTP_CONTROL.md`。不能仅新增文档中的 HTTP 路由。
4. 本地提交钩子依次执行 `lint-staged`、`npm run typecheck`、完整 `npm run test`。其中 `typecheck` 实际包含 TypeScript、Vite 构建和兼容资产复制；完整格式检查另在 `npm run ci` 中执行。
5. 合并前检查候选 SHA 的普通 CI 与三个 Chromium job。不得以取消保护、强推或删除有效断言代替修复。

## 分层验证

| 检查             | 根目录命令                                                                  | 覆盖与边界                                                                                                     |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 文本格式         | `npm run format:check`                                                      | Prettier；遵守 `.prettierignore`                                                                               |
| 类型与生产构建   | `npm run typecheck`                                                         | `tsc`、Vite 与旧资源 URL 兼容副本                                                                              |
| 非浏览器测试     | `npm test`                                                                  | EV50 API/仿真/HTTP/MAVLink、展示、飞行、GLB、机体、机库、SkyTrans 核心、Python、统一控制、共享世界、品牌和景观 |
| 非浏览器完整检查 | `npm run ci`                                                                | 格式 + 类型/构建 + 上述全部测试；不运行 Chromium                                                               |
| 机库真实页面     | `npm --prefix threejs run test:browser -- e2e/hangar.spec.ts`               | 切机、模型/机构、相机、演示、回放、Python 与统一控制                                                           |
| 景观真实页面     | `npm --prefix threejs run test:browser -- e2e/landscapes.spec.ts`           | 山区/海岛、外控状态保持、URL/本地偏好、Back 与持久页恢复                                                       |
| 场景色调实渲染   | 由 `Chromium scene appearance` job 运行 `threejs/qa/capture-appearance.mjs` | 固定机位参考/当前截图、两机型两场景、金色光线、移动端与返回产品曝光                                            |
| Python 专项      | `npm run test:python`                                                       | 跨平台包装器设置规范 SDK 路径后运行 unittest                                                                   |
| 原生模型预检     | `npm --prefix models/skytrans run check`                                    | 独立工具依赖、路径、哈希和管线前提；不是完整 Blender rebake                                                    |

首次运行浏览器测试：

```sh
npx --prefix threejs playwright install --with-deps chromium
npm --prefix threejs run build
npm --prefix threejs run test:browser
```

Playwright 使用构建后的页面、单 worker、SwiftShader 与零自动重试；配置会启动嵌套 `/hangar/` 静态预览、统一 HTTP 服务和 SkyTrans Python 桥。`test:browser` 不自动构建，源码改动后须重新 build。截图、trace 和 JSON 在 `threejs/test-results/`，HTML 报告在 `threejs/playwright-report/`，均不提交。

原生模型预检先安装锁定依赖：`npm ci --prefix models/skytrans/scripts --ignore-scripts`。完整重建、机械采样及适用工具版本见 [REBUILD](models/skytrans/REBUILD.md)。不能把单元测试、构建或 preflight 写成 Blender/真实浏览器/外部训练已经通过。

## 多机型与视觉不变量

- 一个主画布、共享渲染器和帧循环。新适配器不能私建另一套宿主或私自替换共享地景、灯光和后处理。
- 模型、事件监听、相机、导入、录制与连接必须有可释放的所有者；迟到加载应被丢弃并释放，不能覆盖最新选择。
- 机构操作保留观察机位；普通换镜头不改变时间、控制源或航迹历史。进入飞行的显式取景与自由观察保持分别测试。
- 场景切换只影响表现资源与旧航迹，保留权威位姿、时钟、播放和控制租约；同值选择不重置资源。
- 航迹读取仿真时间，暂停不按墙钟消散；不将稀疏状态、跳时或瞬移连接成长条，也不修改外部位置避障。
- EV50 与 SkyTrans 执行器、时钟和协议不能混用。统一控制保留单一租约、严格校验、去重、epoch 与渲染后 ACK。
- 旧名称和二进制资产不能全局替换；先查 [兼容约定](docs/BRAND-MIGRATION.md) 和资产来源。

更多模块边界见 [集成架构](docs/INTEGRATION.md)，像素检查和证据边界见 [视觉验收](docs/VISUAL-VALIDATION.md)。

## CI 与发布

- `Verify SkyCaptain hangar / Build and test`：所有 push 和 PR 执行 `npm run ci`。
- `Verify integrated aircraft browsers`：所有 push 和面向 `main` 的 PR 分别执行 `Chromium shared hangar`（40 分钟 job 上限）、`Chromium landscape switching`（20 分钟）与 `Chromium scene appearance`（20 分钟）。三者均无部署权限。
- `Deploy SkyCaptain hangar`：`main` 的 push 或手动触发，重新执行 `npm run ci`，仅发布 `threejs/dist/`，再验证实际公开 Pages 资源与三维页面。

色调截图工作流固定使用已验收参考 `5ca848ea00f57d846eb33d6a239cf2c6948acc6c`，本地缺少时拉取该准确提交，不回退父提交。参考与候选 SHA 保存在 `appearance.json`；更新参考必须是明确的验收决定，不能随提交自动漂移。

Pages Source 需为 **GitHub Actions**。部署工作流和浏览器工作流独立触发，部署并不会等待另一工作流通过，因此候选是否完成验收须检查同一 SHA 的所有相关结果。公开验证在部署后执行：站点可能已经更新，而随后的 smoke 仍失败；不能仅凭部署步骤绿色宣称整项发布验证完成。

公开检查固定到仓库 Pages URL，逐文件对比上传构建的 SHA-256，再验证 EV50、运行中的 SkyTrans、旧 query 规范化、切回 EV50 和海岛渲染。证据 artifact 名为 `public-pages-evidence`；三个浏览器 artifact 为 `hangar-browser-evidence`、`landscape-browser-evidence` 与 `scene-appearance-evidence`，保留 14 天。提交报告应区分通过、失败、未运行和受环境阻塞的检查，并关联准确 SHA。
