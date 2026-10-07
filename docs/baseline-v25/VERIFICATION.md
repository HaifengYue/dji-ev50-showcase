# V25本地检查与旧审计归档

## 当前状态

V25已完成以下限定范围的本地验收并保存为独立检查点。用户已接受当前关节突出程度，另要求修整前后缘薄片；新细节尚未计入本检查点，当前暂不发布。原V24审计不删除、不覆盖，也不自动继承到新几何。

- Node测试：176/176通过
- 轻量QA与网页构建：通过
- Python协议/桥服务：26/26通过
- 新增两片下蒙皮闭合拓扑、Float32位置及4001姿态刚杆/滑架包络：通过当前GLB测试
- 当前源/运行GLB：179个关键Float32网格的完整有向三角位置及局部矩阵保留；全命名层级和两动画的解码时间/值数组保留
- 重烘焙作者源：287个完整网格身份、352个命名父级和330个非动画局部框通过比较
- 原生全翼661个有限姿态材料交叉/包含筛查和16对局部有限支承：通过相应当前输入报告

完整日志与状态：[V25检查摘要](checks/v25/summary.json)。旧`docs/checks/summary.json`及其同级日志是V24历史结果，不是本轮结果。

## 关键证据

- `qa/revision-20261007/REVISION_REBUILD_COMPARISON.json`：单独修订再生与完整几何参考比较
- `qa/revision-20261007/baked-candidate/BAKE_GEOMETRY_IDENTITY.json`：构造几何到当前保存Blend的身份关系
- `qa/revision-20261007/baked-candidate/SOURCE_RUNTIME_IDENTITY.json`：当前源/运行身份范围
- `qa/revision-20261007/baked-candidate/BAKED_ANIMATION_CHECK.json`：实际AnimationMixer播放检查，不用网页程序动画代替保存动作
- `qa/revision-20261007/candidate-final-material-and-support-check.json`与`candidate-final-dense-wing-material-check.json`：实际构造网格材料、有限支承和661姿态检查
- `qa/revision-20261007/independent-wall-check/FINAL_INDEPENDENT_REVIEW.json`：独立主皮、层隙和有限支承复核，连同细分角色与基线比较数据保存
- `qa/revision-20261007/ANIMATION_IMAGE_PROVENANCE.json`：保存Blend实际动作关键帧图片身份

候选材料报告的输入SHA通过几何参考和烘焙身份报告连接到当前作者源；文件名本身不是身份依据。未收录旧large-raised的旋翼相位/扫掠预检作为V25最终证书。

独立复核中，新下蒙皮主皮采样法向厚度最小约0.011499u；中央修改窗口约0.010485u；巡航重叠层实际采样距离约0.004460u，分别高于对应0.010u和0.003u要求。局部旧孔缘、自然前后缘和斜终止面另有有界角色与旧基线比较，不能把它们扩展成任何新薄区的通用豁免。

## 可执行开发检查

```sh
npm ci
npm test
npm run test:qa
npm run build
python3 python/install.py
.venv/bin/python -m unittest discover -s python/tests -v
python3 tools/verify_package.py
```

Windows的Python入口可用`py -3`；虚拟环境测试解释器用`.venv\Scripts\python.exe`。新修订输入核验和再生入口见[资产说明](ASSETS.md)。

## 尚未完成或不作的声明

- 新wrapper已完成103项输入核验与dry-run，但未在全新目录从头到尾执行；单步再生比较不替代这一环节
- Chromium启动因运行环境禁止socket创建而失败，没有完成浏览器像素或交互验证；源码布局、GLB数值取景和Blender渲染不冒充浏览器实测
- 没有Windows、触屏、实体手机GPU或实际飞行实测
- 材料和运动证据均覆盖明确的有限样本与角色，不是全机连续运动、全局最小壁厚、自交为零、制造或结构安全认证
- 下蒙皮和环形底座为单连通分量的闭合实体，但带设计轴孔；不称数学意义的“无孔实体”
- 原有机身自接触、叉臂表示缺陷和结构性开放天线不因本轮局部检查自动清除或获无限豁免

## 原V24完整审计归档

`AUDIT_ARCHIVE.json`仍指向原`transwing-studio-local-delivery-20261007.tar.gz`，1,039,891,669字节，SHA-256为`3f1482d273846f6e329ca7475ccc7f62f3fd1f5d8ba1ce2ea644c199591ec0cd`。原分卷和历史证据未删除；需要时另目录恢复，不能覆盖合并本V25小包。旧模型与再生说明保存在`docs/baseline-v24/`。
