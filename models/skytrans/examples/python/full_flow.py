"""生成全流程JSON；--live会通过本机Python桥逐帧驱动真正前端。"""
import argparse
import math
from pathlib import Path
import time
from skytrans_sim import Client, MOTOR_IDS, Recording


def build_recording() -> Recording:
    record = Recording().reset()
    dt = .1
    motors_on = {key: {"targetRpm": 1800, "enabled": True} for key in MOTOR_IDS}
    motors_off = {key: {"targetRpm": 0, "enabled": False} for key in MOTOR_IDS}
    record.set_state(motors=motors_on, display={"environment": "sky"})
    for _ in range(20):
        record.step(dt)
    # 米采用视景约定；轨迹和时长是演示值，没有真实动力学含义。
    for frame in range(40):
        u = (frame + 1) / 40
        record.set_state(positionM=[0, 3 * u, 0]).step(dt)
    for frame in range(60):
        u = (frame + 1) / 60
        record.set_state(positionM=[0, 3, 6 * u], wingTilt=u)
        if frame == 44:
            record.set_state(motors={key: {"targetRpm": 0, "enabled": False} for key in ("L_Rear", "R_Rear")})
        record.step(dt)
    for frame in range(100):
        angle = 2 * math.pi * (frame + 1) / 100
        record.set_state(positionM=[3 * (1-math.cos(angle)), 3, 6 + 3 * math.sin(angle)], attitude=[0, math.sin(angle/2), 0, math.cos(angle/2)]).step(dt)
    record.set_state(motors=motors_on, attitude=[0, 0, 0, 1])
    for frame in range(60):
        u = (frame + 1) / 60
        record.set_state(positionM=[0, 3, 6 * (1-u)], wingTilt=1-u).step(dt)
    for frame in range(40):
        u = (frame + 1) / 40
        record.set_state(positionM=[0, 3 * (1-u), 0]).step(dt)
    record.set_state(motors=motors_off)
    for _ in range(30):
        record.step(dt)
    # 静态安全检视：六片舵面和舱门各有独立输入。
    record.set_state(display={"environment": "hangar"}, surfaces={"L_Inboard": 12, "R_Inboard": -12, "L_Outboard": -8, "R_Outboard": 8, "Tail_L": 6, "Tail_R": -6}, hatchDeg=55)
    for _ in range(20):
        record.step(dt)
    record.set_state(surfaces={key: 0 for key in record.state["surfaces"]}, hatchDeg=0)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="通过本机API驱动，要求页面已启用Python外部控制")
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("full_flow.json"))
    args = parser.parse_args()
    record = build_recording()
    record.save(args.output)
    print(f"已写入 {args.output}，{len(record.commands)} 条命令，{record.state['time']['seconds']:.1f} 秒")
    if args.live:
        with Client(args.url, client_name="full-flow-example") as client:
            if not client.ready(timeout=10):
                raise SystemExit("没有就绪查看器。请打开同源页面并启用Python外部控制。JSON已生成，可在静态网页导入。")
            for command in record.commands:
                receipt = client.command(command["op"], command["payload"], wait_applied=True)
                if command["op"] == "step":
                    time.sleep(command["payload"]["dt"])
            print("查看器已逐条确认应用；这不是截图或真实硬件验证。最后回执：", receipt)


if __name__ == "__main__":
    main()
