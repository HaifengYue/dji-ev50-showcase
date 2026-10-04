# 资产与重建说明

当前四套动力舱整体下挂、内侧舱靠近关节、平整翼腹与等厚抬升中央翼，已完成同一模型的八项作者验证、65阶段独立物理及最终前端五阶段。源索引材料保护检查的后续强化另行绑定定向补充结果，准确状态与边界见[验证说明](VERIFICATION.md)。

工程维护同一架当前参考飞机。主轴随中央翼上移0.029并重新求解定长连杆和前限位，保留机腹直槽与低置驱动固定布局；四个翼根整流罩由实体桥和底座安装，不能描述为直接埋入翼皮。真实构造与参数见[机构说明](MECHANISM.md)。独立动力模块是同一飞机的部件说明。

## 当前冻结生产资产

| 文件 | 用途 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| `public/models/xp4.glb` | 网页运行GLB | 2,511,508 | `062fd09dee64984221316ede5ba684f6c1b6ff4f7b7ee2a0bd818a8888fd6f43` |
| `assets/blender/xp4-source.glb` | 未压缩源GLB | 7,442,036 | `801b02ca6b12c326a04e0a1fe7741a99f168c629384ae836f490f7779428570e` |
| `assets/blender/xp4.blend` | 完整可编辑Blender源 | 31,040,504 | `93b87989cf4b19cd55236d13da99fa592b482429e77c9adf52ad9b36b0d6551d` |
| `public/models/manifest.json` | 模型清单 | 5,591,462 | `b311aa5bfb7dab0923a0b95d83e42d48aa0ba34ea064f78162f6e81863ce33d8` |

源与运行编码各有283个渲染网格实例、348个原始GLB节点、6种材质和0独立纹理。两种编码按实际实例均为226,404个渲染三角形。源GLB有283个网格定义；运行GLB复用为222个网格定义，去重定义合计191,720个三角形，不能把它误写为实际渲染三角总数。Three.js载入器额外建立的Scene容器不属于原始GLB节点。运行文件低于3,500,000字节预算。

`assets/blender/nacelle-system-concept-source.glb`及`public/models/nacelle-system-concept.glb`是独立概念动力部件的源/运行资产。公开Python示例位于`examples/python/`与`public/examples/`。原始用户图像、外部摄影、官方视频、凭据和依赖安装目录不进入交付。

## 实际生成输入

当前独立重建绑定32项真实输入，完整文件名与SHA-256见[生成器复现报告](../qa/current/author/generator-reproducibility.json)的`generatorHashes`：

- `nacelle_wing_layout.py`、`wing_surface_repair.py`与`mesh_precision.py`负责本轮四舱布局、自然翼腹与实际细三角数值保护
- `layered_wing_joint.py`、`wing_seam.py`、`wing_surfaces.py`等构造层叠翼与连接表面
- `joint_fairings.py`、`joint_endcaps.py`、`hinge_supports.py`等构造整流罩、桥接与实体支承
- `drive_layout.py`、`internal_drive.py`、`linkage_geometry.py`构造低置驱动和本轮重新闭合的输出机构
- `output_slot_profile.py`、`slot_topology.py`、`preserved_surfaces.py`及局部原生蒙皮模板维持机腹直槽与受保护表面
- `generate_transwing.py`、`kinematics.py`、`export-transition.py`保存场景和动作并导出源GLB
- `compress-model.mjs`与固定涂装编码数据生成当前Meshopt运行模型

局部蒙皮模板与固定校准数据是明确的重建输入，带来源身份，不冒称新生成或历史整机备份。数据边界见[生成数据说明](../scripts/data/README.md)。必要原始证据和索引保护参考只用于复核声明范围，不是额外当前模型。

## 已执行的当前作者验证

八份作者报告均绑定上表实际资产，正式物理汇总的`sourceChecks`统一索引这些报告：

- 231个源部件通过拓扑检查；两条前装饰保留原8开边形式，不当作闭合结构实体
- 保存Blend重新打开后执行2,001个原生驱动样本，最大四元数误差`3.552713678800501e-15`，低于`1e-10`
- 1,001个源机构样本与673个电机动作样本通过
- 保存Blend实际重新导出的GLB与当前源GLB逐字节相同
- 当前源/运行两种实际动作共18姿态核对顶点、法线与材质；最大双向顶点偏差约`2.9621e-05`，并非断言源与压缩编码原始属性逐字节相同
- 主模型输出初始为空的独立目录使用32项同字节生成输入真实生成与压缩，并完成独立运行模型18姿态对照
- 对应编码之间，生产源与重建源、生产运行与重建运行各283网格的原始解码属性、有向三角多重集、材质、局部矩阵、父级、动作及操作元数据逐值一致，未做小数舍入

独立重建GLB的包装字节与生产文件不同。[原始值精确复现](../qa/current/author/regeneration-exact.json)是对应编码之间不舍入的最终证据，重建文件不替换生产资产。作者链、有限物理样本、离线视觉与真实设备分别报告，完整状态见[验证说明](VERIFICATION.md)。

## 复验与独立重建

实际作者环境为Blender4.3.2与Node.js24；前端最低Node.js22.12，Python最低3.10。更换工具版本后需重新验证输出。先安装两套锁定依赖：

```sh
npm ci
npm ci --prefix scripts
python3 python/install.py
```

在工程根检查当前保存源及其导出：

```sh
blender -b -t 4 --python-exit-code 1 --python scripts/verify-solids.py
blender --disable-autoexec -b -t 4 --python-exit-code 1 --python scripts/verify-native-drive.py
blender -b -t 4 --python-exit-code 1 --python scripts/verify-source.py
blender -b -t 4 --python-exit-code 1 --python scripts/verify-motor-animation.py
blender -b -t 4 --python-exit-code 1 --python scripts/reexport-source.py
node scripts/verify-source-runtime.mjs
python3 scripts/test-straight-slot.py
PYTHONPATH=python .venv/bin/python -m unittest discover -s python/tests -v
```

上述入口会写作者结果，复验前应另行保留需要保留的记录。要验证独立再生，先在新的工程外目录按`verify-regeneration.mjs`的`generatorFiles`清单复制当前输入、两套包锁、概念资源和manifest，不预置当前整机GLB或Blend。安装依赖后执行：

```sh
TRANSWING_RENDER=0 blender -b -t 4 --python-exit-code 1 --python scripts/generate_transwing.py
node scripts/compress-model.mjs
```

交付中的`qa/regenerated/`只保留当前验收输入锁实际依赖的重建输入和结果。可在工程根按以下入口核对，不能把生成出的文件直接覆盖生产模型：

```sh
node scripts/verify-regeneration.mjs qa/regenerated/assets/blender/xp4-source.glb
node scripts/verify-regeneration-exact.mjs
TRANSWING_COMPARE_SOURCE=qa/regenerated/public/models/xp4.glb TRANSWING_COMPARE_REPORT=qa/current/author/regenerated-runtime-geometry.json node scripts/verify-source-runtime.mjs
```

独立目录可用`ASSET_TOOL_ROOT`指定已安装压缩依赖的本工程`scripts`绝对路径，该目录不是额外几何输入。Windows下的Python命令见 [Python接口](PYTHON_API.md)。构建继续使用`npm run build`及`--emptyOutDir false`，当前交付只选择实际入口引用闭包。

所有几何、运动、材料与间隙数值是原创概念模型约定，不是原厂制造尺寸；有限样本通过不证明连续净空、强度、疲劳、气动、制造性或适航。
