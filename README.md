# Transwing 飞行展示工作室

这是一个可本地运行、可编辑模型的 Transwing VTOL 三维概念展示工程。工程只维护一个蓝白 P4 参考构型，前端、Blender 源、模型生成器、Python 接口、示例和必要验证资源放在同一目录。

模型内部格式号、稳定资源 ID 和来源标记用于兼容与追溯，不作为工程发行版本；工程迭代由 Git 管理。

当前工程已包含四套完整动力舱整体下挂、内侧舱向关节靠近、自然平整活动翼腹和等厚抬升中央翼；真实主轴同量上移并重算连杆、低置驱动行程与前限位。模型、作者源、全程几何、前端及Python的当前验收状态与精确范围见[验证说明](docs/VERIFICATION.md)，不沿用旧模型的阶段结果。真实浏览器、Windows/触屏及手机GPU未验收。

当前同一模型已完成原65阶段物理链（290输入）、八项作者链和前端五阶段（169单元、5飞行、26Python）。原链完成后，4个QA输入强化了真实索引材料保护及其报告；独立5阶段定向补充在431输入锁下通过，原65所用4份字节随证据保留。未将这次定向补充称为强化后完整65阶段重跑。三套锁按实际路径合并为495项，包内逐项核对。

本项目为依据公开资料独立制作的原创概念演示，不是 PteroDynamics 官方产品、授权数字孪生、生产级 CAD、飞控或空气动力学模拟器。尺寸、行程、转速、轨迹和时间常数是展示约定，不是原厂实测性能。

## 本地启动

需要 Node.js 22.12 或更高版本。以下命令在工程根目录执行：

```sh
npm ci
npm run dev
```

打开终端显示的本机地址。首次安装需要访问公开 npm 仓库；安装后，页面、模型和示例由本地服务提供，无需 API 密钥、账号或付费素材。不要直接双击 `index.html`，模型和 ES 模块需要 HTTP 服务。

生产构建与预览：

```sh
npm run build
npm run preview
```

构建脚本必须保持 `tsc -b && vite build --emptyOutDir false`，更新同名输出但不清空已有 `dist/`。保留旧文件不代表旧文件属于当前交付；交付清单只选择当前入口所需资源与完整复验依赖。

如果已提供并核验 `dist/`，可以使用：

```sh
python3 -m http.server 8080 --directory dist
```

随后打开 `http://localhost:8080`。Windows 可将 `python3` 换为 `py -3`；未安装 Python 时使用 npm 预览。

## Python 本地联动

需要 Python 3.10 或更高版本；服务和 SDK 仅使用标准库。安装器只建立本工程的虚拟环境，不修改全局包：

```sh
python3 python/install.py
.venv/bin/python -m transwing_sim.server
```

Windows PowerShell 使用：

```powershell
py -3 python/install.py
.\.venv\Scripts\python.exe -m transwing_sim.server
```

打开服务输出的本机地址，在页面点击“连接本机 Python 桥”，再在第二个终端运行 `examples/python/full_flow.py --live`。若修改了前端，先重新构建 `dist/`。

远程静态网页只支持本地导入或加载公开示例的 JSON 回放，不能直接运行 Python，也不会探测用户电脑端口。实时联动必须使用 Python 服务提供的同源本机网页。完整命令、协议和回执区别见 [Python 接口](docs/PYTHON_API.md)。

## 常用检查

```sh
npm test
npm run test:qa
npm run format:check
npm run build
python3 python/install.py
.venv/bin/python -m unittest discover -s python/tests -v
```

Windows 的 Python 测试请使用安装器建立的 `.\.venv\Scripts\python.exe`。这些命令分别检查源码、飞行回归与模型加载、格式、构建及 Python。模型独立几何验收、源文件重建、离屏渲染、浏览器操作和真实设备仍须分别核验；命令成功不能替代未运行项目。完整验收脚本、实测结果与有限采样范围见 [验证说明](docs/VERIFICATION.md)。前端五阶段入口为 `python3 qa/frontend/run.py`；独立物理入口为 `bash qa/current/run-safety.sh`，需要先按资产说明准备独立重建输入。

## 当前模型图像

- [四舱巡航布局](qa/visual/NACELLE_LAYOUT_CRUISE.png)
- [收翼俯视](qa/visual/NACELLE_LAYOUT_HOVER.png)
- [平整翼腹正前](qa/visual/WING_UNDERSIDE_PROFILE.png)
- [翼腹斜下](qa/visual/WING_UNDERSIDE_OBLIQUE.png)
- [短舱实际安装](qa/visual/NACELLE_WING_MOUNT.png)
- [5秒实际整翼往返联动](qa/visual/NACELLE_WING_MOTION.mp4)

以上为当前运行GLB与生产rig的真实离线渲染，媒体身份、完整解码和渲染边界见[媒体说明](qa/visual/README_CURRENT.md)。

## 阅读顺序

- [工程说明](docs/PROJECT.md)：工程范围、目录职责和运行边界
- [操作导航](docs/NAVIGATION.md)：镜头、机构、内部驱动、Python 回放
- [机构说明](docs/MECHANISM.md)：真实几何方案、运动约束和概念边界
- [资产与重建](docs/ASSETS.md)：源模型、网页资产、生成依赖和必要夹具
- [Python 接口](docs/PYTHON_API.md)：SDK、状态、时间、HTTP/SSE 和错误处理
- [验证说明](docs/VERIFICATION.md)：当前状态、验收门槛及实际覆盖
- [交付说明](docs/DELIVERY.md)：单一完整工程、清单和发布边界

## 唯一源码目标

唯一源码管理目标为 [HaifengYue/dji-ev50-showcase](https://github.com/HaifengYue/dji-ev50-showcase) 的 `Transwing` 分支。本地目录、报告与归档不证明远端已提交、推送或部署；远端状态以实际发布确认记录为准。网页构建目录只是本工程的生成结果，不是第二套可编辑源码。
