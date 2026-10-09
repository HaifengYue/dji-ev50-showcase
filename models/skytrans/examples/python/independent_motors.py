"""四电机逐个启停；其余电机目标保持关闭，后桨沿真实折叶轴归位。"""
import time
from skytrans_sim import Client, MOTOR_IDS, Recording

record = Recording().reset().set_state(wingTilt=.35)
for motor_id in MOTOR_IDS:
    record.set_state(motors={motor_id: {"targetRpm": 1800, "enabled": True}})
    for _ in range(75):
        record.step(1 / 30)
    record.set_state(motors={motor_id: {"targetRpm": 0, "enabled": False}})
    for _ in range(105):
        record.step(1 / 30)

if __name__ == "__main__":
    with Client(client_name="independent-motors") as client:
        if not client.ready(timeout=10):
            raise SystemExit("没有就绪查看器，请先启用同源页面的Python外部控制")
        for command in record.commands:
            receipt = client.command(command["op"], command["payload"], wait_applied=True)
            if command["op"] == "step":
                time.sleep(command["payload"]["dt"])
        print("独立电机序列已由查看器确认应用：", receipt)
