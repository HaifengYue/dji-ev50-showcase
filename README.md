# Transwing 交互展示工程

本树记录交付冻结时的状态：几何已冻结，限定域材料/运动及开发检查通过；用户审图仍待确认，尚未发布。模型为未标定尺度的原创概念，单位u；不作制造、强度、适航认证。

## 已验证与边界

- 当前交付原生作者源SHA：742ef52939de40f5d2eb46b87d38c8e85f99bffafc270c302afd59b9ea398adf
- 当前运行GLB：3,696,884 B，SHA352b1b6fd28026e5c9b50e981e1fb30aa4d5fad805084d7186ca2e9c7c375b16；开发性能预算3,800,000 B，非用户硬限
- 285逻辑mesh owner、352原始节点、287渲染primitive；177关键owner/179primitive保源Float32与精确TRS
- 实际176/176、QA、TypeScript/Vite、格式、Python26/26通过；真实动画/丝杠相位/4001姿态rig和电机故障检查通过
- 原生661有限姿态0接触、0包含、0未判定；252桨组合0接触。有限采样不等于全机连续状态证明
- 全新目录实际从冻结V24→V25→M→I→平腹/连接肋/内孔/相位重新生成B，285mesh/352节点与冻结参考全等；以新作者SHA继续fresh烘焙、压缩、全部管线和176/TS/Vite/Python均通过。再生资产字节与当前交付B不同，未混用
- 该全流程实际逐组件执行；wrapper的准备、环境清理、绝对脚本定位、输入验证及篡改拒绝均实测。未声称单次不中断的完整--run执行
- 没有浏览器GPU或实体手机测试；不绕过现有访问限制

## 外形与有限厚度声明

巡航上皮投影让位口最大X宽约.06891u，由同轴刚体扫掠占位约束保留；这不是透光孔面积、最小机械净距或全局最优口宽证明。当前双侧上皮投影间隙面积约.01754454u²，较M约.03934523u²减少55.4%。

新后部主壁有限样点最低.01019986u、巡航层隙最低.00365993u；新轴区自然主皮样点固定侧最低.01363156u、活动侧.01084013u。不得扩写为全机或全表面≥.010。

自然羽缘仅按原V25自然薄缘恢复，不能把M后来人为下加厚当原始基准。224对应截面保留218，授权内收去掉6；B局部最低竖直厚约.00911129u、法向约.00936805u，适用范围见最终复核。旧孔屋顶还有真实继承薄区约.00754–.00983u，代表值.00896127u；继承不等于豁免。1.25°旧接缝约.00172605u正净空是V25/M同片原面沿袭，不能把巡航.003规则说成全运动≥.003。

完整限定与来源见 qa/revision-20261007-inset/FINAL_GEOMETRY_REVIEW_B.json 及其引用。大扫描数组、多PNG和历史审计留在包外且未删除；包内小收据的历史引用不表示所有大证据均随包提供。

## 开发与校验

在本目录执行（实际验证环境：Blender4.3.2含NumPy/SciPy，Node24.19.0，Python3.12）：

```sh
python3 tools/verify_package.py
npm ci
npm ci --prefix scripts
export QA_EXPECTED_SOURCE_CANDIDATE_SHA256=742ef52939de40f5d2eb46b87d38c8e85f99bffafc270c302afd59b9ea398adf
npm test
npm run test:qa
npm run format:check
npm run build -- --configLoader native
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=python python3 -m unittest discover -s python/tests -v
python3 python/run_server.py
```

Python服务同源提供dist和API；在用户本机打开 http://127.0.0.1:8765。接口说明见 docs/PYTHON_API.md。npm依赖按两个lockfile安装，包内没有node_modules或凭据。

## 全新目录严格再生

先安装上述依赖，再使用从未存在的工程外目标：

```sh
python3 tools/rebuild_inset_revision.py --output ../rebuilt-v27-b --dry-run
python3 tools/rebuild_inset_revision.py --output ../rebuilt-v27-b --run --deps-from . --hardlink-inputs
```

171项新输入锁保留旧82/103/136行与原字节。冻结V24 Blend包内一份；单独冻结V25 runtime只用于旧量化缺陷身份核验，不读取主public/models/xp4.glb冒充V25。当前B原生/GLB成品不是几何构造输入。再生候选容器SHA可不同，先核完整几何参考，再按实际新SHA烘焙并执行独立验证。详见 tools/REBUILD_INSET_REVISION.md 和 qa/revision-20261007-inset/baked-integrated-b/rebuild-checks/DEFAULT_RECONSTRUCTION_CHECK.json。

发布父提交为7dcd5cde3a650c48a164c72bd9473671ec74b641。FILE_MAP仅供原发布线程比对交付树；本次没有推送、部署或远端写入。历史M/旧版本文件只作输入与背景，不是当前模型状态。
