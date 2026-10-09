# SkyCaptain / SkyTrans 名称与兼容迁移

SkyCaptain 是整合机库的项目名称；SkyTrans 是原整合机型 Transwing 的新项目内名称。它不改变参考机型的真实名称、厂商、几何来源或许可。

## 规范入口

- 仓库：`HaifengYue/sky-captain`；默认主线：`main`。
- 显示名称：`SkyTrans`；机型 ID：`skytrans`；直达：`?aircraft=skytrans`。
- 源资产、工具及 SDK：`models/skytrans/`。
- 原生适配器：`threejs/src/aircraft/skytrans/`。
- 运行资源：`threejs/public/skytrans/`，在站点中为 `skytrans/`。
- Python 导入：`skytrans_sim`。
- 统一 API：`hangar.control.v1`、`window.hangarAPI`、`/api/hangar/v1`，不变。

## 向后兼容

| 旧入口                                            | 当前行为                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `?aircraft=transwing`                             | 加载 SkyTrans，地址规范为 `aircraft=skytrans`                                                 |
| `hangarAPI.select('transwing')`                   | 选择同一个 SkyTrans 实例                                                                      |
| 统一请求 `aircraft:'transwing'`                   | 校验前映射到 `skytrans`；状态和租约中的机型 ID 返回规范值                                     |
| `transwing.mechanism/motors/surfaces`             | 转交对应 `skytrans.*` 操作；浏览器响应回显当次请求拼写；HTTP 结果保留首次排队请求的不可变回执 |
| 相同 id 的旧/新操作拼写                           | 规范化后共用去重结果，只应用一次；有效载荷不同仍是 `ID_CONFLICT`                              |
| `transwing_sim`                                   | 薄导入别名，复用 `skytrans_sim` 的同一 Client、Recording、Bridge 类                           |
| 原 `PYTHONPATH=models/transwing/python`           | 小型路径兼容包转至规范 SDK                                                                    |
| `models/transwing/python/run_server.py`           | 转至同一 SkyTrans 本机服务入口                                                                |
| 站点 `transwing/models/*`、`transwing/examples/*` | 构建时由规范资源生成兼容文件，内容相同；开发 Vite 源路径使用规范 `skytrans/`                  |

HTTP `/results/{id}` 跨别名重试时仍返回首次排队请求的 operation 和回执，不重写已经保存的 ACK。

统一 API 的列表、能力、状态和 lease 对外使用 `skytrans`。硬编码检查旧输出 ID 的客户端应更新这一检查；兼容旧输入不等于所有任意第三方客户端都无需修改。

### Python wire 协议保持不变

新的 `skytrans_sim` SDK **仍发送 `transwing.sim.v1`**，本机服务仍使用 `/api/v1`，health 的技术服务标识仍为 `transwing-local-bridge`。JSON 导出、SSE、错误消息和渲染 ACK 沿用同一契约。没有新增 `skytrans.sim.v1` 协议或第二个控制服务。

这样旧版严格比较 protocol/service 的客户端仍能工作。新旧包与名称别名共享控制租约和状态，不会同时获得两份控制权。统一机库 API 也保持对 Python 与 JSON 回放占用的检测。单位、帧/秒/百分比语义、四元数顺序、MOTOR_IDS 与 SURFACE_IDS 不变。

## 有意保留的旧名称与证据

以下内容不是遗漏，不能盲目改写：

1. 原 `Transwing` 来源分支、提交 `2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3`、历史验收文档与归档名称。
2. `transwing.sim.v1`、`transwing-local-bridge`、旧 ID/操作/SDK/资源路径的有限兼容代码与测试。
3. 原生 Blend/GLB 的 `TRANSWING_Hover_Cruise_Hover`、`TRANSWING_Motors_Start_Stop` clip 名，以及 `transwing.*.v1` 机械证据 schema、历史生成器名。机械管线与数据的原始契约保持。
4. `Transwing-独立舵面完整工程.zip` 等历史归档字段和历史 hash。归档未复制到当前工程，也不是缺失的执行依赖。
5. Pterodynamics 的真实参考产品名称和原始 PDF URL；参考机型参数不转换成 SkyTrans 的实机参数。
6. CSS/QA 的 `tw-` 作用域钩子是稳定内部选择器，不是用户可见品牌或另一个机型。
7. `xp4` 作为内部源资产变体 ID 保留，显示名称统一为 SkyTrans。

原 `Transwing` 独立分支和独立站点不改动；`ev50` 备份仍保留。品牌迁移不重写 Git 历史，不添加或改写统一许可证。

## 模型一致性

- 原生完整 Blend：SHA-256 `4bb048190cd9fc5009f2b4090711cae157a4df37cd056b0e32d5a2a77fca07b3`。
- 运行完整 GLB：SHA-256 `380e44e92fa9790e2e7145bded8d15b2bcab3480a147776c8246486f9bb35c4d`。
- 352 个 GLB 节点的原有名称及 rig 引用保持；只迁移外层路径。

浏览器构建、核心/协议测试和这些哈希检查不等同于重新运行 Blender 全量 rebake、物理有限采样或认证。
