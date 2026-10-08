# 开发与仓库规范

## 目录职责

- `threejs/`：唯一可部署的 Vite + Three.js 应用；EV50 运行时模型为 `threejs/public/ev50.glb`，Transwing 运行时资产位于 `threejs/public/transwing/`。
- `threejs/src/`：应用、API 契约、实时视景与回放逻辑；`aircraft/` 管理机型注册、异步生命周期与机型专属适配器。功能变更必须有对应测试。
- `docs/`：用户、API、HTTP 桥和验证文档。
- `blender/` 与 `scripts/`：可复现的建模、验证和打包脚本。
- `models/`、`previews/`：已发布版本的受控资产；本地实验性建模文件不会进入 Git。
- `deliverables/`：只保留明确发布的交付物；临时 ZIP 不提交，应通过 Release 附件分发。

`references/`、`renders/`、本地 Blender 自动保存、下载工具压缩包和构建目录均为本机工作材料，已在 `.gitignore` 中排除。请勿用 `git add -f` 绕过这些规则。

## 日常工作流

1. 从 `main` 创建 `feature/<主题>` 或 `codex/<主题>` 分支。
2. 变更 API 时，同步更新 `threejs/src/api/contracts.ts`、网关/桥接实现、测试和 `docs/API.md` 或 `docs/HTTP_CONTROL.md`。
3. 在仓库根目录运行 `npm ci`，并在 `threejs/` 运行 `npm ci`。
4. 提交前钩子会格式化暂存文本并运行构建和 API 测试；完整校验执行 `npm run ci`。
5. 通过拉取请求合并到 `main`。应在 GitHub 仓库设置中保护 `main`：要求 `Verify EV50 showcase / Build and test` 通过、要求至少一次审查、禁止强制推送和直接删除分支。

## 发布

推送到 `main` 会触发 `Verify EV50 showcase` 与 `Deploy EV50 showcase`。部署工作流会再次完成格式、构建、API、视景、展示、净空和 GLB 校验，仅把 `threejs/dist` 发布到 GitHub Pages。仓库的 Pages Source 必须设置为 **GitHub Actions**。

## 多机型集成约束

只保留一个主画布、渲染器和帧循环。新机型须声明能力并实现可清理的适配器；资源、事件监听、录制导入、相机和外控连接都必须有所有者。所有迟到加载应忽略并释放资源，不能影响新选择。EV50 和 Transwing 的遥测协议不能混用。

`npm --prefix threejs run test:hangar` 验证切换和状态隔离。`npm --prefix threejs run test:browser` 在允许启动 Chromium 的环境运行真实浏览器测试。浏览器测试工作流只为独立整合分支及该分支的 PR 执行，无部署权限。
