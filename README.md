# Transwing

倾转翼无人机交互展示，包含完整内部机构、四电机与折桨、六片独立舵面、网页界面和 Python 控制 API。

## 开发

```sh
npm ci
npm ci --prefix scripts
npm run dev
npm test
npm run test:qa
npm run build -- --configLoader native
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=python python3 -m unittest discover -s python/tests -v
python3 python/run_server.py
```

Python 服务提供构建后的 `dist/` 与 API。控制项、输入优先级、兼容别名和例子见 [Python API](docs/PYTHON_API.md)。依赖声明见 [第三方说明](THIRD_PARTY_NOTICES.txt)。

## 唯一可编辑原生模型

`assets/blender/xp4.blend` 是当前完整、未烘焙的 Blender 作者模型。打开即可编辑网格、节点、六舵面和真实机构，无需加载历代工程目录。`public/models/xp4.glb` 是网页实际使用的压缩运行模型。

```sh
npm run build:model
npm run test:pipeline
npm run verify:model  # 当前native的完整有限状态物理扫描，耗时较长
```

需要 Blender 4.3.2、Node 24 和 Python 3.12。默认在内存重烘焙，从原生模型导出，再验证完整节点、父子、材质、关键 Float32 几何和动画。输出写入未跟踪的 `build/model/`，不会覆盖作者模型或自动替换已发布模型。需要独立播放的烘焙 Blend 时可用 `python3 tools/rebuild_model.py --save-baked-blend`。

这是“从当前可编辑原生基线重烘焙/导出”。历史276输入的程序化从零构造链已移出当前提交，完整历史工程仍保存在归档中；不把两种重建能力混为一谈。更新原生模型时，必须独立复核并更新 `scripts/data/current-model-contract.json` 中的源SHA、机构目标及关键几何名单，再执行验证。

仓库不提交 `node_modules/`、重复烘焙Blend、未压缩GLB、`dist/`、大验证输出或历代版本目录。详见 [资产与重建](docs/ASSETS.md) 和 [验证范围](docs/VERIFICATION.md)。

尺寸为概念单位u，不是制造毫米。有限状态检查与网格闭合不代表气密、强度、制造或适航认证。
