# 资产与重建说明

工程维护一架当前参考飞机及其生成、验证输入。独立动力模块用于同一飞机的概念部件检视，不是额外机型。当前模型包含真实机腹直槽、低置驱动和单直斜输出，见[机构说明](MECHANISM.md)。

## 冻结生产资产

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `public/models/xp4.glb` | 2,437,828 | `313b014ec70b409175b34a08f66ec56820a51ea094085ce1eef96fc444ce4b2b` |
| `assets/blender/xp4-source.glb` | 7,322,536 | `14deba2a8cb20fb13c6cc05f8c4c09d441285b9754b014499942ad39992f7ce4` |
| `assets/blender/xp4.blend` | 31,073,592 | `0dc4feb2a628dad23f1e82d122167a08154b7f72f301bc5f5fc8e59c210b6857` |
| `public/models/manifest.json` | 430,108 | `5c75a42613bd42c5229204236b6a3605cf59f0190f8d4e7fdb8cb6611ffa04d9` |

生产模型为283个网格、348个节点、227,746个渲染三角形、6种材质、0独立纹理；运行文件低于3,500,000字节预算。完整Blender源可编辑，源GLB未压缩，网页使用Meshopt运行编码。以上身份在当前工程作者链前后均未变化。

`assets/blender/nacelle-system-concept-source.glb`与公开压缩副本保留独立动力模块。`examples/python/full_flow.py`、同名JSON及`public/examples/python-full-flow.json`提供公开演示生成器和离线回放，不包含私有用户参考。

## 真实生成依赖

- `drive_layout.py`：驱动轴、导轨、横梁、鞍座及支承的共享布局
- `internal_drive.py`、`linkage_geometry.py`：低置驱动、有限孔腔与直件连接
- `output_slot_profile.py`、`slot_topology.py`、`preserved_surfaces.py`：真实直唇、短圆端、局部共同剖分、邻接装饰及域外保护
- `generate_transwing.py`、`export-transition.py`：保存同一原生场景及动作，导出源GLB
- `compress-model.mjs`：薄壁/孔腔保留所需Float32位置，再做Meshopt压缩
- `scripts/data/`中的原生局部表面、涂装校准与数字配准数据：当前真实输入，详见其README

独立重建验证绑定30项实际输入，包含`slot_topology.py`、`drive_layout.py`及正式表面数据。来源标记和校准哈希用于追溯，不表示分发旧发行版或完整历史整机。原始用户图片、外部摄影、官方视频、凭据及本机依赖目录不进入交付。

## 已执行的作者链

当前功能化命名工程中真实执行了以下检查，8份真实报告保存在`qa/current/author/`，最终统一索引见`qa/current/results/summary.json`的`sourceChecks`字段：

- 231个源部件拓扑检查；前两条装饰明确保留原8开边，不冒充闭壳
- 2001个原生驱动采样，最大qerror约3.78e−15，低于原1e−10门槛；禁用自动执行仍通过
- 1001个机构采样和673个旋翼动作采样
- 保存的Blender重新导出，与生产源GLB逐字节一致
- 当前源/运行两个动作共18姿态的实际顶点、法线、材质对照
- 26项Python协议、桥接、HTTP测试及4项截面参数测试
- 无预置模型的独立目录，使用30项同字节生成输入实际生成、压缩并验证
- 重建源/运行各283网格的原始解码属性、有向三角多重集、材质、局部矩阵、父级及动作轨道逐值相同，未应用数值舍入；另完成重建运行模型18姿态对照

独立重建GLB包装字节与生产文件不同。`generator-reproducibility.json`如实保留该事实，`regeneration-exact.json`补充原始值不舍入的严格等价证据；重建文件没有替换生产文件。

独立物理早筛还证明最终双编码各331个支承接口通过，283网格都有实际支承路径；正式完整物理、前端及视觉汇总由[验证说明](VERIFICATION.md)登记。作者链通过不等于所有项目验收均已完成。

## 复验入口

环境为Blender4.3.2、Node.js24，前端最低Node.js22.12；实际依赖以锁文件为准：

```sh
npm ci
npm ci --prefix scripts
mkdir -p qa/current/author
blender -b -t 4 --python-exit-code 1 --python scripts/verify-solids.py
blender --disable-autoexec -b -t 4 --python-exit-code 1 --python scripts/verify-native-drive.py
blender -b -t 4 --python-exit-code 1 --python scripts/verify-source.py
blender -b -t 4 --python-exit-code 1 --python scripts/verify-motor-animation.py
blender -b -t 4 --python-exit-code 1 --python scripts/reexport-source.py
node scripts/verify-source-runtime.mjs
python scripts/test-straight-slot.py
python python/install.py
PYTHONPATH=python .venv/bin/python -m unittest discover -s python/tests -v
```

需要重新生成时，先在独立目录按`verify-regeneration.mjs`的实际`generatorFiles`清单复制当前输入、概念资源和manifest，保留原生产文件。在该独立目录执行：

```sh
TRANSWING_RENDER=0 blender -b -t 4 --python-exit-code 1 --python scripts/generate_transwing.py
node scripts/compress-model.mjs
```

当前作者复验采用`qa/regenerated/`作为独立目录。从工程根验证结果：

```sh
node scripts/verify-regeneration.mjs qa/regenerated/assets/blender/xp4-source.glb
node scripts/verify-regeneration-exact.mjs
TRANSWING_COMPARE_SOURCE=qa/regenerated/public/models/xp4.glb TRANSWING_COMPARE_REPORT=qa/current/author/regenerated-runtime-geometry.json node scripts/verify-source-runtime.mjs
```

独立目录也须安装或引用锁定的压缩工具依赖。`ASSET_TOOL_ROOT`可指定已安装这些依赖的本工程`scripts`绝对路径，不是额外几何输入。Windows环境的Python安装及运行方式见[Python接口](PYTHON_API.md)。

构建使用`npm run build`及`--emptyOutDir false`保留原文件；实际交付仅包含本次入口引用的构建闭包。模型、源码或合同发生变化后，应重新运行受影响验证，不能沿用旧哈希或只改说明。

本工程没有取得原厂CAD、材料、制造公差或认证资料。有限采样及数值验收不证明连续无碰撞、强度、疲劳、气动、制造性或适航。
