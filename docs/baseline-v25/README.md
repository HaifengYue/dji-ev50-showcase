# Transwing 飞行展示工作室

一个可本地运行、可编辑模型的整翼倾转三维概念工程。本包保存2026-10-07的V25本地检查点：网页、Python API、当前Blender/GLB、原82项不变输入、冻结V24基线、新修订方法、预构建网页和关键证据。

V25已完成下文限定范围的本地验收并独立保存。用户已接受当前关节突出程度，另要求继续修整前后缘薄片细节；这些后续改动不包含在本检查点中，当前暂不发布。浏览器像素验证和整条新目录再生wrapper仍未完成，详见 [验证说明](docs/VERIFICATION.md)。

原大型审计归档对应V24，完整保留且未删除；V25与它不是同一模型身份，也不继承其几何证书。本包排除历史候选、依赖目录和缓存。

## 启动网页

需要 Node.js 22.12 或更高版本。在本工程根目录执行：

```sh
npm ci
npm run dev
```

打开终端提供的本机地址。首次安装需要访问 npm 仓库；页面与模型运行不需要 API 密钥。不要直接双击 HTML 文件。

```sh
npm run build
npm run preview
```

本包包含 `dist`，也可直接用 `python3 -m http.server 8080 --directory dist` 预览。重新构建使用 `--emptyOutDir false`，不会自动清空已有输出。

## Python 联动

服务与 SDK 使用标准库，需要 Python 3.10 或更高版本：

```sh
python3 python/install.py
.venv/bin/python -m transwing_sim.server
```

Windows 使用 `py -3 python/install.py` 和 `.\.venv\Scripts\python.exe -m transwing_sim.server`。打开服务输出的本机网页地址，点击“连接本机 Python 桥”，再运行 `examples/python/full_flow.py --live`。实时联动使用同源本机页面，远程静态页面可以导入 JSON 回放。

## 开发检查

```sh
npm test
npm run test:qa
npm run build
```

Python 测试命令、构造输入校验及本次结果见 [验证说明](docs/VERIFICATION.md)。GLB 加载检查会自动建立自己的输出目录，无需完整审计包。

- [操作导航](docs/NAVIGATION.md)：形态、检查视图、四电机和控制权
- [Python 接口](docs/PYTHON_API.md)：协议、SDK、HTTP/SSE 和回执
- [模型与独立重建](docs/ASSETS.md)：当前作者源、原82项输入、新修订输入锁和再生限制
- `REVISION_CONSTRUCTION_INPUTS.json`：V25分层构造与验证输入锁
- `DEVELOPMENT_MANIFEST.json`：独立ZIP成员清单和SHA-256；解压后运行 `python3 tools/verify_package.py` 核验

本工程是独立制作的概念展示，不是官方数字孪生、生产 CAD、真实飞控或结构安全认证。尺寸、行程和运动时间是展示设计；数值几何检查不证明实际制造和载荷能力。
