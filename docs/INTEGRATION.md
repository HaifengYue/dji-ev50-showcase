# EV50 / SkyTrans 集成架构

本文描述当前代码的边界。原始来源提交、迁移分支与当时的验收过程见 [历史集成记录](INTEGRATION-VERIFICATION.md)；其中旧路径与结果不能代替当前操作或候选验收。

## 单一宿主

`threejs/` 是唯一 Vite 应用。`src/main.ts` 持有一个主 WebGL 画布、renderer、scene 和动画循环，并负责产品舞台、地景、天空、灯光、后处理、共享导航、航线图、航迹与输出。High 质量可能包含多个后处理 pass；“一个宿主”不意味着只有一次 draw call 或一个 render pass。

EV50 复用原有 `flight.ts`、`api/` 和 `simulation/`。SkyTrans 在选择时动态加载原生适配器，不挂载 React、iframe、第二个应用或私有机库/灯光。可选概念系统和内部机构是模型表现，不是第二套飞行场景。

## 模块与所有权

| 模块                                                                                 | 职责                                                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/aircraft/registry.ts`、`identity.ts`                                            | 机型、能力、相机清单与有限旧名称归一化                     |
| `src/aircraft/types.ts`                                                              | 适配器、世界状态、共享播放控制与资源生命周期边界           |
| `src/aircraft/selection.ts`                                                          | 最新选择优先、立即终止旧选择、异步加载取消和迟到资源释放   |
| `src/aircraft/skytrans/index.ts`                                                     | SkyTrans 运行时、机构、面板、视角、导入与连接所有权        |
| `src/aircraft/skytrans/core/`                                                        | 原生机械、执行器、记录协议、曝光和相机数学                 |
| `src/aircraft/skytrans/worldFlight.ts`、`demoProfile.ts`                             | 共享水平航线、独立本地演示时间表与确定性转子采样           |
| `src/control/`                                                                       | 统一契约、配置、租约、去重、epoch、帧后 ACK 与可选 HTTP 桥 |
| `src/aircraft/ev50Control.ts`、`skytrans/controlAdapter.ts`                          | 将统一命令原子地应用到对应机型，不混用执行器               |
| `src/landscape-settings.ts`、`terrain.ts`、`island-landscape.ts`、`landscape-sky.ts` | 地景偏好、山区/海岛几何、天空和有界资源重建                |
| `src/scene-appearance.ts`                                                            | 产品/飞行曝光、环境强度、雾与天空颜色的共享表现参数        |
| `src/flight-trail.ts`                                                                | 只读实际位姿/仿真时间，维护固定容量视觉航迹                |

以上路径相对 `threejs/`。适配器拥有自己的模型、相机行为、事件和外控连接；共享景观与渲染资源由宿主管理，不能由一个机型释放另一机型或宿主的资源。

共享色调参数集中在 `scene-appearance.ts`：产品曝光 1、环境强度 0.45，飞行曝光 0.96，默认雾近/远端 2000/7400 m。`scene-details.ts` 的默认能见度读取同一来源，显式 `scene.configure` 能见度仍优先。天空渐变与云层只改变表现，不改几何、相机或飞行状态。

`skytrans/core/sceneLighting.ts` 保留原生光照基线及其测试，当前适配器不导入它；不能因它不在运行时调用链就删除历史管线依据，也不能把它当成共享场景的调色入口。

## 选择、导航与资源释放

- 正在加载的同机型选择复用一个 Promise；已就绪的同机型选择不重新加载。
- 切换先使旧控制失效并释放旧实例，再接受新实例。可取消 fetch 会被中止；GLTF parse 无法真正中止时，迟到结果在挂载前释放。
- 加载失败可重试，不会破坏机库入口。过期成功/错误、JSON 导入、概念几何与录制回调不得覆盖最新选择。
- URL 保留其他参数；`aircraft=transwing` 规范为 `skytrans`，未知值回退 EV50。同页 Back/Forward 使用同一选择流程。
- 完整页面卸载释放控制。`pageshow.persisted` 恢复时保留宿主 renderer/监听器，重新建立已清理的选择器和机型；丢失 WebGL context 时使用整页重载回退。
- 切机清理模型、播放、导入、网络与输入。已完成的下载保留，尚未完成或仍在编码中的截图/视频取消，不能回写新机型状态。

## 相机、时间与景观

产品模式使用自由观察。显式进入飞行模式会播放并选择跟随；机构滑块、普通观察视角和已经播放中的重复飞行点击不能重新开始演示。相机、机体世界位姿与机构局部变换各自独立；外控位移在相机过渡中仍保持完整。

SkyTrans 的 316 秒本地演示通过 `demoProfile.ts` 重映射共享 180 秒航线参考时间，使用 3 m/s 上升、2 m/s 下降、4 秒速度过渡和 6 秒停机。它是视觉时间表，不是空气动力学求解器。EV50 的 180 秒任务、Python 外部步进时钟和 JSON 帧索引不被此重映射改写。共享 HUD 根据 seconds / frames / percent 展示时间，不能假定每种时间轴位置都以秒计。

山区/海岛选择是表现偏好，不是 `config.update` 或旧 `scene.configure` 的新增键。切换只替换地景自有资源并重置旧航迹，保留 generation、租约、控制源、位姿、时钟、播放与相机。同值选择不重建；URL、站点保存偏好及存储异常由 `landscape-settings.ts` 处理。

航迹使用位姿所有者的仿真时间。暂停时冻结，跳时、瞬移、过大采样间隔和生命周期变化时断开。当前地表高度只用于视觉航迹净空；旧名义地面/控制包络独立保留，不用新地景改写权威位置。

## API 与所有权隔离

新集成入口 `window.hangarAPI.request` 返回 Promise；`list()`、`state()` 和 `select()` 保留机型发现/选择接口。`window.hangarDiagnostics` 是只读验收快照，不是外部修改模型的控制入口。

统一网关每帧最多应用一个机体命令，只有真实 render/composer 完成后才返回 applied ACK。选择、断开、过期和 epoch 轮换遵循 [统一控制契约](UNIFIED_CONTROL.md)，不靠 DOM 变化判断命令完成。配置和管理操作的 completed ACK 与机体应用 ACK 含义不同。

EV50 的 `window.ev50API`、`ev50-command` 和 11 路旋翼遥测仍仅适用于 EV50；选择 SkyTrans 或统一租约占用时旧 EV50 网关不会接管模型。离开 EV50 清理订阅。其 HTTP 桥保留命令游标和原始结果 outbox：结果重传不重执行命令，重新进入后首批旧命令以 `STALE_SELECTION` 隔离。

SkyTrans Python/JSON 保留 `transwing.sim.v1`、独立时钟和 pose-before-ACK 约定。Python、JSON 回放与统一外控互斥；它们的租约/回执协议并未合并成同一个 wire 协议。新旧品牌输入共享同一机型和租约，详见 [兼容映射](BRAND-MIGRATION.md)。

## 验证边界

运行命令见 [CONTRIBUTING](../CONTRIBUTING.md)，当前真实浏览器检查与像素证据见 [视觉验收](VISUAL-VALIDATION.md)。控制/几何测试不会创建真实 GPU 上下文；截图成功不能证明视频编码、实机性能或连续机械无碰撞。

原生 Blend/GLB 的来源与哈希以 [PROVENANCE](../models/skytrans/PROVENANCE.md) 和模型契约为准。视觉及控制集成不证明制造可行性、适航性、UAVRL 训练或外部环境端到端训练成功。
