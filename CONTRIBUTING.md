# 开发与仓库规范

## 目录职责

- `threejs/`：唯一可部署的 Vite + Three.js 应用；运行时模型固定为 `threejs/public/ev50.glb`。
- `threejs/src/`：应用、API 契约、实时视景与回放逻辑；功能变更必须有对应测试。
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
