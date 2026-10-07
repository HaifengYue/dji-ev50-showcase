# Transwing 交互展示工程

按照标注将左右内侧舵面向翼根延长50%，实际投影面积增加约50.62%。六片舵面均可分别驱动，界面提供左/右内侧、左/右外侧和左/右V尾独立控制，Python API 保留原规范ID与旧分组接口。

本轮还补齐两根腹部天线的真实端盖，将8条吊舱U形装配线贴合宿主并消除贴合后的局部连接扭转。保留关节、折桨、舵面与检修所需的真实边界，不将运动缝封死。

## 开发与运行

```sh
npm ci
npm ci --prefix scripts
QA_EXPECTED_SOURCE_CANDIDATE_SHA256=2f6d6a1a5a616351643233342a1e175b2483aa3785b50185aac104799ac84f4b npm test
npm run test:qa
npm run format:check
npm run build -- --configLoader native
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=python python3 -m unittest discover -s python/tests -v
python3 python/run_server.py
```

Python 服务同源提供 dist 和 API。独立舵面ID、兼容别名、输入优先级与例子见 [Python API](docs/PYTHON_API.md)。单项规范ID优先于单项别名，再优先于旧分组；复位、非法输入原子拒绝和界面/外部控制接管均有测试。

## 验证与重建

- 14,592个组合状态：六片全部64种正负限位组合、19个倾转角、3种折桨状态和4种桨相位，表面与闭体包含检查通过
- 逐片每1度扫描共150状态、661全机姿态、252折桨/相位、1,201内部传动姿态检查通过
- 187项Node、5项轻量QA与GLB加载、30项Python、格式、TypeScript/Vite构建通过
- 276项输入全链冷重建通过；285网格、352节点的存储坐标、有向面/材质与父子矩阵精确一致
- 全机285网格中265闭合；20个开放对象为涂装面或装配线端口。实际主壳与六舵面闭合，修复件有有限材料接合证据

```sh
python3 tools/verify_edge_package.py
python3 tools/rebuild_controls_revision.py --output ../transwing-rebuilt --run
```

输出必须为新的项目外目录。使用Blender 4.3.2、Node 24、Python 3.12；冻结父代构造为独立4线程进程，前轮增量与本轮增量分别在独立2线程进程冷载。最终Blend/GLB不是重建几何输入。旧171项输入保留；当前应用测试中的父提交身份期望随本轮正常更新。

运行体为4,094,144字节，较上一版增加59,108字节（1.46%），低于既有4,200,000字节预算。没有为体积降低关键几何精度或删去结构。

详见 [验证说明](docs/VERIFICATION.md) 与 [资产说明](docs/ASSETS.md)。所有尺寸为概念单位u，并非制造毫米。有限采样、网格闭合和接合检查不构成气密、强度、制造或适航认证；必要运动口和继承薄羽缘仍保留。没有浏览器GPU或实体手机实测声明。
