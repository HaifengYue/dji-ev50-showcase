# 开发检查与完整审计归档

## 本轻量开发包

本包保留完整网页、Python API、Blender 作者源、全部82项构造输入、`dist` 和轻量测试。大规模材料分片、运动证书、来源数据及其完整消费工具已移至独立完整审计归档，未永久删除。

轻量包使用自己的 `DEVELOPMENT_MANIFEST.json`。它不沿用完整包的成员清单，也不把开发测试称为重新执行全部几何验收。

当前三项模型身份与完整审计包一致：

- 源 GLB：`e0323e3c6d50c3810a17f9e940debe2b13369ce76fcd042fe6ac0ea26b0adedd`
- 运行 GLB：`26fc74f34383dc80342ca1804ccb8d4cf6fda2f8a8dace6e03d84510fb9d6b5c`
- 保存 Blend：`1e29d4697c931545cc7b6e5d3cfa124093c9adb7dfe71a03428cda66cbd15225`

## 可在本包执行的检查

先执行 `npm ci`，然后运行：

```sh
npm test
npm run test:qa
npm run build
python3 python/install.py
.venv/bin/python -m unittest discover -s python/tests -v
```

Windows 将最后两条改为 `py -3 python/install.py` 和 `.\.venv\Scripts\python.exe -m unittest discover -s python/tests -v`。

单独核验82项输入：

```sh
python3 -c "import sys; from pathlib import Path; sys.path.insert(0, 'scripts'); from constructor_inputs import verify_locked_inputs; print(verify_locked_inputs(Path.cwd()))"
```

本次实际执行结果和日志见 [本次轻量检查结果](checks/summary.json)。GLB 加载检查运行时自动创建 `qa/frontend/glb-loader-report.json`；该文件属于本地生成输出。完整重建与精确资产比较见 [ASSETS.md](ASSETS.md)，必要的小型路径守卫和比较方法已随本包放在 `tools/`，不依赖被移出的 `qa/delivery`。

`CONSTRUCTION_INPUTS.json` 的 `historicalInputLock` 是保留的来源说明，旧 `qa/provenance` 文件在完整审计归档内；实际输入校验使用同清单的82条文件与 SHA，不依赖该历史路径。

## 完整审计归档

完整归档名为 `transwing-studio-local-delivery-20261007.tar.gz`，1,039,891,669字节，SHA-256：

`3f1482d273846f6e329ca7475ccc7f62f3fd1f5d8ba1ce2ea644c199591ec0cd`

它已经以三个独立分卷保存在资料库，原聊天附有分卷清单、合并脚本和中文说明。资料库标识与对应总包身份另见 [归档身份说明](../AUDIT_ARCHIVE.json)。需要复核大规模证据时，在另一个目录合并并解压完整归档，按其中的 `qa/delivery/README.md` 操作。不要在轻量包目录运行完整包的 `qa/delivery` 命令，也不要将两个同名根目录直接覆盖合并。

完整包已经完成单根装配、所有收录输入 SHA 核验、材料覆盖消费、源/运行全模型变更范围消费和前端测试。其实际索引 `qa/delivery/assembly/FINAL_LOCAL_DELIVERY_INDEX.json` 记录本地请求检查无剩余项；其中明确保留 `globalProjectAcceptanceGranted=false` 与 `publicationPerformed=false`，并列出并未在装配环节重复执行的物理扫描。归档包含已完成的材料、支承、有限运动、外廓与来源证据及其适用范围。

## 保留的限制

主皮按冻结的实际分片、端面及规定方向核验 `.010 model unit`；机械盲壁另有三维下界，罩壁按完整表面距离。巡航相邻异体层隙底线 `.003`，`.019` 是名义目标，已批准的有限结构域偏离单独记录。

指定机身105个历史自接触见证、8个原有桨叉臂缺陷及2个结构性开口天线保留完整同编码身份与有限范围说明。运行编码叉臂的原退化面及拓扑失败也如实保留。它们没有跨部件运动或支承豁免；不宣称全部网格零自交、全部闭体或制造装配零干涉。

所有动作证据覆盖明确的有限状态与保守包络，不是连续全角证明。浏览器像素、Windows、触屏和实体手机 GPU 未因源码或协议测试通过而自动获得实测结论；本工程也不提供强度、可制造性或真实飞行安全认证。
