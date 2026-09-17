#!/usr/bin/env python3
"""MAVLink-shaped control client for the loopback EV50 visual test broker.

This uses only the Python standard library and is intentionally restricted to
the local visualization server. It is not a flight-control client for hardware.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import sys
from urllib.parse import urlparse


def connect(url):
    parsed = urlparse(url)
    if parsed.scheme != "ws" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("仅允许连接本机 ws://127.0.0.1 MAVLink 视景测试服务")
    port = parsed.port or 80
    client = socket.create_connection((parsed.hostname, port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
    client.sendall(
        (
            f"GET {path} HTTP/1.1\r\nHost: {parsed.hostname}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii")
    )
    response = client.recv(4096).decode("ascii", "replace")
    expected = base64.b64encode(
        hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
    ).decode("ascii")
    if "101 Switching Protocols" not in response or expected not in response:
        raise SystemExit("WebSocket 握手失败")
    return client


def send_json(client, message):
    data = json.dumps(message, separators=(",", ":")).encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])
    if len(data) < 126:
        header.append(0x80 | len(data))
    elif len(data) <= 65535:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", len(data)))
    else:
        raise SystemExit("消息过大")
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
    client.sendall(bytes(header) + mask + masked)


def receive_json(client):
    first = client.recv(2)
    if len(first) != 2:
        raise SystemExit("服务已断开")
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", client.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", client.recv(8))[0]
    data = b""
    while len(data) < length:
        chunk = client.recv(length - len(data))
        if not chunk:
            raise SystemExit("服务已断开")
        data += chunk
    if first[0] & 0x0F == 8:
        raise SystemExit("服务已关闭")
    return json.loads(data.decode("utf-8"))


def wait_for(client, expected):
    while True:
        message = receive_json(client)
        if message.get("type") == expected:
            return message


def command(args):
    if args.command == "state":
        return None
    if args.command in {"arm", "disarm"}:
        return {"type": "COMMAND_LONG", "command": "MAV_CMD_COMPONENT_ARM_DISARM", "param1": 1 if args.command == "arm" else 0}
    if args.command == "takeoff":
        return {"type": "COMMAND_LONG", "command": "MAV_CMD_NAV_TAKEOFF", "param7": args.altitude}
    if args.command == "land":
        return {"type": "COMMAND_LONG", "command": "MAV_CMD_NAV_LAND"}
    if args.command == "transition":
        return {"type": "COMMAND_LONG", "command": "MAV_CMD_DO_VTOL_TRANSITION", "param1": 4 if args.state == "fw" else 3}
    if args.command in {"pause", "resume"}:
        return {"type": "COMMAND_LONG", "command": "MAV_CMD_DO_PAUSE_CONTINUE", "param1": 0 if args.command == "pause" else 1}
    if args.command == "position":
        return {"type": "SET_POSITION_TARGET_LOCAL_NED", "x": args.xyz[0], "y": args.xyz[1], "z": args.xyz[2]}
    if args.command == "velocity":
        return {"type": "EV50_CONTROL", "velocity_ned": args.xyz}
    if args.command == "attitude":
        return {"type": "SET_ATTITUDE_TARGET", "q1": args.q[0], "q2": args.q[1], "q3": args.q[2], "q4": args.q[3], "thrust": args.thrust}
    if args.command == "actuators":
        return {"type": "SET_ACTUATOR_CONTROL_TARGET", "controls": [args.aileron, args.elevator, args.rudder, args.lift, args.cruise]}
    if args.command == "mode":
        return {"type": "SET_MODE", "custom_mode": args.value}
    if args.command == "mission":
        return {"type": "MISSION_SET_CURRENT", "mission": args.id}
    if args.command == "control":
        payload = {"type": "EV50_CONTROL"}
        if args.position_ned is not None: payload["position_ned"] = args.position_ned
        if args.velocity_ned is not None: payload["velocity_ned"] = args.velocity_ned
        if args.quaternion_wxyz is not None: payload["quaternion_wxyz"] = args.quaternion_wxyz
        if args.surfaces is not None: payload["surfaces"] = args.surfaces
        if args.lift_rpm is not None: payload["lift_rpm"] = args.lift_rpm
        if args.cruise_rpm is not None: payload["cruise_rpm"] = args.cruise_rpm
        if len(payload) == 1: raise SystemExit("control 至少指定一个状态输入")
        return payload
    raise SystemExit("未知指令")


def main():
    parser = argparse.ArgumentParser(description="控制本地 EV50 MAVLink 风格视景测试服务")
    parser.add_argument("--url", default="ws://127.0.0.1:8765/?role=controller")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("state")
    commands.add_parser("arm"); commands.add_parser("disarm")
    takeoff = commands.add_parser("takeoff"); takeoff.add_argument("altitude", type=float)
    commands.add_parser("land")
    transition = commands.add_parser("transition"); transition.add_argument("state", choices=["mc", "fw"])
    commands.add_parser("pause"); commands.add_parser("resume")
    for name in ("position", "velocity"):
        item = commands.add_parser(name); item.add_argument("xyz", nargs=3, type=float)
    attitude = commands.add_parser("attitude"); attitude.add_argument("q", nargs=4, type=float); attitude.add_argument("--thrust", type=float, default=0)
    actuators = commands.add_parser("actuators")
    for name in ("aileron", "elevator", "rudder", "lift", "cruise"): actuators.add_argument(name, type=float)
    mode = commands.add_parser("mode"); mode.add_argument("value")
    mission = commands.add_parser("mission"); mission.add_argument("id")
    control = commands.add_parser("control")
    control.add_argument("--position-ned", nargs=3, type=float); control.add_argument("--velocity-ned", nargs=3, type=float)
    control.add_argument("--quaternion-wxyz", nargs=4, type=float); control.add_argument("--surfaces", nargs=3, type=float)
    control.add_argument("--lift-rpm", type=float); control.add_argument("--cruise-rpm", type=float)
    args = parser.parse_args()
    client = connect(args.url)
    try:
        initial = wait_for(client, "EV50_CONTROL_STATE")
        outgoing = command(args)
        if outgoing is None:
            print(json.dumps(initial, ensure_ascii=False, indent=2)); return 0
        send_json(client, outgoing)
        reply = wait_for(client, "EV50_COMMAND_ACK")
        print(json.dumps(reply, ensure_ascii=False, indent=2))
        return 0 if reply.get("result") == "ACCEPTED" else 1
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
