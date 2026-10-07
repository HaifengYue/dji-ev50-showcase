# V25资产与分层再生

本包是2026-10-07的V25本地检查点，尚未远端发布。用户已接受当前关节突出程度，并要求继续修改前后缘薄片；后续细节不包含在本检查点中。

## 当前模型身份

| 文件 | 用途 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| `assets/blender/xp4.blend` | 可编辑场景和两套保存动作 | 34,026,724 | `948e6a83b19b87bbfe7efe6d0e5e461e1679b40a8e8da31027d9a290a54e373b` |
| `assets/blender/xp4-source.glb` | 完整源编码 | 9,885,884 | `5913af2abefc60672934b76ce038a9c43935d08b5a68a22d354d9be02b7c8b28` |
| `public/models/xp4.glb` | 网页Meshopt运行编码 | 3,653,208 | `7d8f17becf588b7dbebcd95201f89e18bcd95db4eca238451c6e64e85de9e902` |
| `public/models/manifest.json` | V25模型清单 | 241,466 | `f72d468427d43283fb1e359e5d84cc7a485e68542048476fb5653ddba1df7d15` |

两种GLB各有352个原始节点、287个渲染网格实例、303,190个实例三角形、6种材质、2条动画和0个独立纹理。运行编码有230个去重网格定义，不能把它当成实例数。两套动作分别保留18和26条通道。3,700,000字节性能预算未通过减少关键几何精度实现。

`assets/blender/annotated-mechanism.json`与`public/models/annotated-mechanism.json`来自当前源GLB的机构契约。保存Blend中历史“候选/未验收”标签属于构造时状态；最新限定范围检查状态以本包[验证说明](VERIFICATION.md)和检查结果为准，不表示全项目或制造认证。

## 构造输入

- `CONSTRUCTION_INPUTS.json`仍锁定原82项输入，所有原字节和SHA保持不变
- `assets/baseline-20261007/`明确保存V24的Blend、manifest和机构契约，来自发布父提交`7dcd5cde3a650c48a164c72bd9473671ec74b641`
- `REVISION_CONSTRUCTION_INPUTS.json`另外锁定103项构造/验证输入，包括上述82项、旧锁本身、冻结基线、新修订方法和wrapper
- `REVISION_GEOMETRY_REFERENCE.json`只作完整几何、父级和局部矩阵身份比较，构造程序不读取其中的几何数据
- 当前最终`assets/blender/xp4.blend`、源GLB、运行GLB和当前manifest不作为V25构造输入

这是“明确冻结V24基线→V25修订”的分层再生，不是声称V25已从纯初始几何全流程重建。旧82项的独立再生背景见[保留的V24说明](baseline-v24/ASSETS.md)。旧入口`tools/rebuild_isolated.py`只构造V24。

## 新目录入口与实际验证边界

先做只读输入核验；`/path/to/new-parent/transwing-studio`必须不存在：

```sh
python3 tools/rebuild_revision.py --output /path/to/new-parent --dry-run
```

准备输入，或另行执行完整新目录流程：

```sh
python3 tools/rebuild_revision.py --output /path/to/new-parent
python3 tools/rebuild_revision.py --output /path/to/another-new-parent --install-deps --run
```

运行需要Blender 4.3.2、Node.js 22.12或以上及npm。依赖安装需要访问npm仓库。Windows可用`py -3`替换`python3`，并用`--blender`传入可执行文件路径。

wrapper按新构造、完整几何参考比较、重烘焙、精度压缩、源/运行身份比较和新清单生成顺序执行；机构sidecar从新烘焙GLB的`extras.annotatedMechanism`重新生成，再复制至作者源和网页位置，不拷贝旧机构冒充新行程。

已完成：103项输入SHA核验、wrapper语法检查和dry-run；单独构造的287网格/352节点已与完整几何参考逐值比较通过。尚未完成：该wrapper在全新目录内从头到尾安装、构造、烘焙、压缩并运行全部检查。因此不能把dry-run或单步再生报告称为完整新目录再生成功。

## 归档与限制

原V24完整审计归档身份见`AUDIT_ARCHIVE.json`，未删除、未合并覆盖；其证据不自动适用于V25。当前同一性、动画、局部材料和有限运动证据见[验证说明](VERIFICATION.md)。旧候选Blend/GLB没有放入小包；中间候选身份通过保存的参考和烘焙比较报告连接到当前作者源。

动力概念模块继续独立保留，20网格实例、3,144三角形。模型单位是原创概念单位u，不是实机测绘米或毫米；所有资料不构成强度、制造、真实飞控或适航证明。
