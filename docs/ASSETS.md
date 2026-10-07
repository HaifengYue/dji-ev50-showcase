# Transwing 资产说明

当前交付资产：

- assets/blender/xp4.blend：39,514,764 字节，SHA256 74f4c082d150dedc160565eefbd5bc99ec0ff87999e86a835f7f4b62a32e4274
- assets/blender/xp4-source.glb：10,920,584 字节，SHA256 db57f5fa421f10e5be27d236ad6d7733e354f3827d09d8d96f5adc55971e3be1
- public/models/xp4.glb：4,035,036 字节，SHA256 334febcb77aa1a3f9eaead2c5931323093479664308b737362420d74d4b7f3dd；dist 中模型逐字节相同
- 原生作者模型：qa/revision-20261007/candidate-inset-integrated-b-edge-linkage.blend，SHA256 f38764881b5c597cc3be98aab79a9b2ad932f6c8c07359d7f9f30c218969c084

运行体含 285 个网格所有者、352 个节点、287 个渲染 primitive、357,070 个三角形；177 个关键所有者均经身份检查。父版运行体为 3,696,884 字节，本轮增加 338,152 字节（9.15%）。批准的运行体预算为 4,200,000 字节，未因此降低几何精度或物理检查阈值。

assets/baseline-20261007/xp4.blend 是冻结初始几何输入；assets/baseline-v25-20261007/xp4-runtime.glb 仅用于历史量化身份比较。历史构造锁与必要输入保留，当前完整锁为 REVISION_EDGE_LINKAGE_CONSTRUCTION_INPUTS.json。历史技术修订编号仅用于追溯。
