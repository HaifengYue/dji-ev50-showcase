# 资产与重建

- `assets/blender/xp4.blend`：唯一当前完整可编辑原生模型，未烘焙动画
- `public/models/xp4.glb`：网页运行压缩模型；当前版本身份记录于同目录manifest
- `scripts/data/current-model-contract.json`：独立复核的作者源SHA、机构目标、关键精度名单与4,300,000字节预算
- `scripts/pipeline/`：当前原生基线重烘焙、压缩、完整源/运行身份及运动验证
- `qa/lib/`、`qa/fixtures/`：仍在使用的回归检查与预期接口契约
- `assets/blender/nacelle-system-concept*`：当前界面概念模型的可编辑小源与验证源，非历史飞机副本

`build/`和`dist/`均可重新生成，不纳入Git。默认不落盘重复烘焙Blend；未压缩GLB及大验收报告只存于`build/model/`。源运行逐值动画比较使用`npm run test:pipeline`，因此普通应用单测不要求先安装Blender。

基线迁移明确放弃“当前checkout可由历史276原始输入重新构造”的承诺，换为“当前完整可编辑原生模型可再次烘焙/导出”。历史构造脚本、旧输入、原始验收证据保留在完整归档《Transwing-独立舵面完整工程.zip》（39,298,315字节，在用户Library中保留）。正常Git历史也未改写。

旧模型输出不作为新管线的几何输入；唯一几何输入是明确标注的当前native。预期机构与精度政策由独立契约固定，不能从被测输出自动反推来制造通过。

## 本轮有界改动记录

`scripts/refinement/refine_native_geometry.py`记录2026-10-08成功的标注优化，输入明确绑定SHA `41d1d093ce4b261483ffcc845303fc1e1b8cbb211c4b75ef24663aeb46f0d116`。它只接受显式原输入并输出独立候选，不覆盖当前`assets/blender/xp4.blend`；不是常规重烘焙的前置步骤，也不依赖旧工程目录。`lower-shell-stations.json`来自该输入现存截面顶点，和相关脚本一起保留审计重放能力。正常从当前作者模型导出仍只运行`npm run build:model`。

成功脚本仅含斜杆延长、侧下壳有界重建/实际扫掠、中央后缘/尖端圆顺、独立连接/保留性检查及契约写出。未通过的扩大槽/连续侧壁候选留在不跟踪的`build/refinement/`，不属于当前原生或重放链。当前原生、运行体和同版收据的SHA见`qa/acceptance-summary.json`；可见残留和有限验证边界见`docs/VERIFICATION.md`。
