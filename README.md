# Transwing 交互展示工程

本次根据标注补齐折起机翼前后端轮廓，保留巡航上片原圆角；左右连杆翼端支点由 |X|=1.12 内移到 1.06u，并同步调整定长杆、内部前支承、导轨、丝杆有效段、限位与侧槽前端。页面交互保持原有功能。

## 工程与验证

- 原生构造、烘焙动画及压缩运行体均包含；运行体为 4,035,036 字节，相比父版增加 9.15%，预算上限为 4,200,000 字节
- 本轮原生模型完成 661 姿态翼面及闭体包含检查、252 折桨/桨相位检查、1,201 姿态内部传动检查，均未检出材料干涉
- 179 项 Node 测试、5 项轻量 QA、26 项 Python 测试及格式、TypeScript/Vite 构建通过
- 新端部局部主壁样点最小 .0101987u；后部静态层隙有限网格最小 .0030450u。前后端局部自交按独立精确分类检查通过
- 旧 171 项构造输入逐字节保留，新增局部增量独立锁定；最终资产不作为全链构造输入

完整检查范围、SHA 和限制见 [验证说明](docs/VERIFICATION.md)、[资产说明](docs/ASSETS.md)。所有尺寸为未标定概念单位 u，并非制造毫米；本项目不提供强度、制造或适航认证。

## 开发

```sh
npm ci
npm ci --prefix scripts
npm test
npm run test:qa
npm run format:check
npm run build -- --configLoader native
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=python python3 -m unittest discover -s python/tests -v
python3 python/run_server.py
```

Python 服务同源提供 dist 和 API，接口见 docs/PYTHON_API.md。依赖与凭据不随包分发。

## 从冻结输入重建

使用 Blender 4.3.2、Node 24 和 Python 3.12；先安装上述依赖，然后执行：

```sh
python3 tools/verify_edge_package.py
python3 tools/rebuild_edge_linkage_revision.py --output ../transwing-rebuilt --run
```

输出目录须为新的项目外目录。固定的进程合同为：冻结父代构造独立使用 4 个 Blender 线程，保存后在独立 2 线程进程冷载再应用本轮增量。线程配置会影响旧布尔运算的 Float32 舍入，不应擅自改变。完整原生身份比较包括每个 Float32 顶点、有向面/材质、父级和局部矩阵；当前最终 Blend/GLB 不作构造输入。

## 保留的合理边界

保留关节轴口、控制面铰缝、桨毂与折桨叉运动间隙、舱盖和短舱装配线。旧天然薄羽缘、轴孔屋顶约 .00754–.00983u 薄域，以及旧接缝约 .001726u 动态净空均为明确继承限制。侧槽延长域保留约 .006u 原机身壳厚，其标准不同于机翼新主壁。

有限姿态与有限壁厚样点不证明全连续状态或全机最小壁厚。未声称浏览器 GPU 或实体手机实测。
