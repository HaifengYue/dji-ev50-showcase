# 当前翼下动力与平整翼腹媒体

本目录来自同一当前运行模型的真实离线像素，不能替代独立几何验收。

捕获记录保留渲染当时的状态，其中“几何验收待完成”仅表示捕获时尚未结束；当前同一组源/运行/Blend/manifest字节随后已通过[原65阶段完整链](../current/results/summary.json)及[索引保护强化定向补充](../current/host-protection-supplement/summary.json)。两套验收范围分别列明，原始捕获记录不被改写。

- [巡航展开，四套完整动力舱位置](NACELLE_LAYOUT_CRUISE.png)：1200×900
- [收翼俯视，对照用户红箭头方向](NACELLE_LAYOUT_HOVER.png)：1600×1000
- [平整翼腹正前正交视角](WING_UNDERSIDE_PROFILE.png)：1600×700
- [翼腹斜下与真实内自由边](WING_UNDERSIDE_OBLIQUE.png)：1200×900
- [短舱与机翼真实安装区域](NACELLE_WING_MOUNT.png)：1300×900
- [翼腹正下接回范围](WING_UNDERSIDE_BOTTOM.png)：1400×1000
- [巡航整机下视](CRUISE_UNDERSIDE.png)：1200×900
- [关节上开口与真实主轴罩](HINGE_CLEARANCE_DETAIL.png)：960×720

[实际整翼联动](NACELLE_WING_MOTION.mp4)：900×780，5.000秒，81帧，由41个真实生产rig姿态往返组成。推进器停机并收叶，没有光流或虚构中间模型。

源GLB SHA-256：801b02ca6b12c326a04e0a1fe7741a99f168c629384ae836f490f7779428570e

运行GLB SHA-256：062fd09dee64984221316ede5ba684f6c1b6ff4f7b7ee2a0bd818a8888fd6f43

每幅PNG与捕获逐字节一致；聊天JPG仅重新JPEG编码。全部图片和视频帧完整解码，并已人工检查所列视角和视频起点、展开极值、终点。

[媒体量测与尺寸](MEDIA_VALIDATION.json)、[静态捕获](CAPTURE_REPORT.json)、[动作捕获](MOTION_CAPTURE_REPORT.json)、[捕获输入](RENDER_INPUTS.json)、[全部视频帧解码](VIDEO_DECODE.framemd5.txt)。

[灰色下翼皮身份](UNDERSIDE_IDENTITY.json)记录本次正前图灰带像素的实际射线命中；两侧活动翼各为单一闭合连接实体，内自由边并非独立悬片。

实际解码GLB、生产rig和原材质在Native EGL/Mesa离线栅格化，使用生产灯光数值和ACES。标准材质区域反射为记录在捕获报告中的近似；不移除遮挡，不修改蒙皮或材质来隐藏问题。该记录不等同于真实浏览器、PMREM、雾/阴影、手机GPU、触控或制造与适航验收。
