"""Python显式step驱动平滑圆形轨迹；Ctrl+C后finally关闭会话并停桨。"""
import math
import time
from transwing_sim import Client, MOTOR_IDS


def trajectory_pose(frame: int, total_frames: int = 600):
    angle = 2 * math.pi * frame / total_frames
    # +Z机头沿圆周切线：位置导数为[cos(angle),0,-sin(angle)]。
    yaw = angle + math.pi / 2
    return ([3 * math.sin(angle), 2, 3 * math.cos(angle)], [0, math.sin(yaw / 2), 0, math.cos(yaw / 2)])


def main():
    with Client(client_name="trajectory-example") as client:
        if not client.ready(timeout=10):
            raise SystemExit("没有就绪查看器：请打开 http://127.0.0.1:8765 并启用Python外部控制")
        client.command("reset", {}, wait_applied=True)
        client.set_state(motors={key: {"targetRpm": 1800, "enabled": True} for key in MOTOR_IDS}, wait_applied=True)
        dt = 1 / 30
        for frame in range(600):
            position, attitude = trajectory_pose(frame)
            client.set_pose(position, attitude, wait_applied=True)
            receipt = client.step(dt, wait_applied=True)
            time.sleep(dt)
        client.wait_applied(client.stop_motors())
        for _ in range(120):
            client.step(dt, wait_applied=True)
            time.sleep(dt)
        print("逐帧应用回执：", receipt)


if __name__ == "__main__":
    main()
