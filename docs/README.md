# SkyCaptain 文档导航

先按目标选择入口。当前使用和开发说明与历史验收分开维护；历史提交、测试次数和截图不代表当前候选已经通过。

## 使用与开发

| 目标                                         | 入口                               |
| -------------------------------------------- | ---------------------------------- |
| 本地启动、能力与边界                         | [项目 README](../README.md)        |
| 切机、自由观察、飞行、山区/海岛、航迹、回放  | [使用指南](USER_GUIDE.md)          |
| 双机型程序控制、租约、时钟、ACK 与 HTTP 示例 | [统一控制接口](UNIFIED_CONTROL.md) |
| 单画布架构、状态隔离与资源所有权             | [集成架构](INTEGRATION.md)         |
| 安装、分层测试、提交与发布                   | [开发规范](../CONTRIBUTING.md)     |
| 真实截图、结构预算与验收范围                 | [视觉验收](VISUAL-VALIDATION.md)   |
| 旧名称、SDK、资源 URL 与 wire 协议           | [品牌兼容](BRAND-MIGRATION.md)     |

## 接入方式与端口

这些入口用途不同，不是同一个 HTTP 服务的别名。仅启动需要的服务；公开静态页面不能替代本机控制页面。

| 入口                                           | 适用对象            | 默认地址 / 协议                                                | 文档                                                           |
| ---------------------------------------------- | ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `window.hangarAPI.request`                     | EV50 / SkyTrans     | 页面内 `hangar.control.v1`                                     | [统一控制](UNIFIED_CONTROL.md)                                 |
| `npm --prefix threejs run control:hangar`      | EV50 / SkyTrans     | `http://127.0.0.1:8790/?control=local`；`/api/hangar/v1`       | [本机统一服务](UNIFIED_CONTROL.md#single-origin-local-service) |
| `window.ev50API`                               | EV50 兼容接口       | 页面内 API 3.3.0                                               | [浏览器 API](API.md)                                           |
| `npm --prefix threejs run control-server`      | EV50 兼容控制       | `http://127.0.0.1:8787/api/v1`；另开 Vite 页面                 | [HTTP 桥](HTTP_CONTROL.md)                                     |
| `npm --prefix threejs run mavlink-server`      | EV50 视景状态       | `ws://127.0.0.1:8765`；MAVLink 风格 JSON                       | [MAVLink 风格通道](MAVLINK_LOCAL.md)                           |
| `python3 models/skytrans/python/run_server.py` | SkyTrans SDK / 记录 | `http://127.0.0.1:8765/?aircraft=skytrans`；`transwing.sim.v1` | [Python SDK](../models/skytrans/PYTHON.md)                     |

EV50 MAVLink 与 SkyTrans Python 桥默认都占用 8765。需要同时运行时，可将 EV50 服务改为 `npm --prefix threejs run mavlink-server -- 8766`，浏览器选择“外部 MAVLink WebSocket”并填写 `ws://127.0.0.1:8766`；命令行客户端也须传相同的 `--url`，见其文档。Playwright 套件使用 4174、8790、8765，运行前检查这些端口未被自己的其他服务占用。

所有控制均用于浏览器中的可视模型。统一控制需要匹配机型的能力、租约和时钟；EV50 的 11 路旋翼数据不能转成 SkyTrans 的四电机命令。旧协议的保留范围以 [品牌兼容](BRAND-MIGRATION.md) 为准。

## 模型与数据

- [SkyTrans 来源与哈希](../models/skytrans/PROVENANCE.md)
- [SkyTrans 重建与独立验证管线](../models/skytrans/REBUILD.md)
- [SkyTrans Python SDK 与 JSON 记录](../models/skytrans/PYTHON.md)
- [EV50 模型和 ULog 维护](USER_GUIDE.md#ev50-模型与-ulog-维护)
- [第三方 notices](../models/skytrans/THIRD_PARTY_NOTICES.txt)

## 历史依据

以下文件保留原提交、分支、名称、通过/失败与当时的限制，不用作当前操作手册：

- [原生机库集成验证记录（2026-10-08 起）](INTEGRATION-VERIFICATION.md)
- [共享场景与控制迁移基线](SCENE-CONTROL-MIGRATION.md)
- [视觉迭代与软件渲染诊断记录（2026-10-09 起）](history/VISUAL-VALIDATION-20261009.md)
- [绿色山地归档分支](https://github.com/HaifengYue/sky-captain/tree/archive/green-landscape-20261009)

旧名称只在来源、协议与明确的兼容入口中保留。更新文档时优先核对源码、package scripts 与 `.github/workflows/`；新增验收结果必须写明提交和实际运行结果，不从测试文件的存在推断通过。
