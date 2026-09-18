#!/usr/bin/env python3
"""Convert a PX4 ULog into the EV50 browser replay contract.

The converter is deliberately read-only with respect to its ULog input.  It
uses the self-describing format records in the file, needs no Python package,
and writes a bounded JSON recording that can be sent directly to
``simulation.replay.load``.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from bisect import bisect_left
from collections import defaultdict
from pathlib import Path
from typing import Any

MAGIC = b"ULog\x01\x125"
MAX_FRAMES = 12_000
PRIMITIVES = {
    "int8_t": ("b", 1), "uint8_t": ("B", 1), "char": ("b", 1), "bool": ("B", 1),
    "int16_t": ("h", 2), "uint16_t": ("H", 2), "int32_t": ("i", 4),
    "uint32_t": ("I", 4), "int64_t": ("q", 8), "uint64_t": ("Q", 8),
    "float": ("f", 4), "double": ("d", 8),
}


def messages(data: bytes):
    if len(data) < 16 or data[:7] != MAGIC:
        raise ValueError("Not a supported PX4 ULog file")
    offset = 16
    while offset + 3 <= len(data):
        size, kind = struct.unpack_from("<HB", data, offset)
        offset += 3
        if offset + size > len(data):
            break  # An interrupted log still has usable preceding samples.
        yield chr(kind), data[offset : offset + size]
        offset += size


def parse_format(raw: str):
    name, fields = raw.split(":", 1)
    result = []
    for field in fields.split(";"):
        if not field:
            continue
        kind, label = field.split(" ", 1)
        length = 1
        if "[" in kind:
            kind, amount = kind[:-1].split("[", 1)
            length = int(amount)
        result.append((kind, label, length))
    return name, result


def decode(fields, payload: bytes, formats: dict[str, list[tuple[str, str, int]]]):
    """Decode primitive fields recursively; unknown trailing data remains absent."""
    offset = 0
    values: dict[str, Any] = {}
    for kind, label, length in fields:
        if kind in PRIMITIVES:
            code, width = PRIMITIVES[kind]
            needed = width * length
            if offset + needed > len(payload):
                break
            unpacked = struct.unpack_from("<" + code * length, payload, offset)
            offset += needed
            values[label] = list(unpacked) if length > 1 else unpacked[0]
            continue
        nested = formats.get(kind)
        if not nested:
            break
        nested_size = format_size(nested, formats)
        if not nested_size or offset + nested_size * length > len(payload):
            break
        values[label] = [decode(nested, payload[offset + i * nested_size : offset + (i + 1) * nested_size], formats) for i in range(length)]
        offset += nested_size * length
    return values


def format_size(fields, formats: dict[str, list[tuple[str, str, int]]]):
    total = 0
    for kind, _label, length in fields:
        if kind in PRIMITIVES:
            total += PRIMITIVES[kind][1] * length
        elif kind in formats:
            nested = format_size(formats[kind], formats)
            if not nested:
                return 0
            total += nested * length
        else:
            return 0
    return total


def parse_ulog(path: Path):
    raw = path.read_bytes()
    formats: dict[str, list[tuple[str, str, int]]] = {}
    subscriptions: dict[int, str] = {}
    records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    targets = {"vehicle_local_position", "vehicle_attitude", "actuator_motors", "actuator_outputs", "actuator_servos"}
    for kind, payload in messages(raw):
        if kind == "F":
            name, fields = parse_format(payload.decode("utf-8", "replace"))
            formats[name] = fields
        elif kind == "A" and len(payload) >= 3:
            message_id = struct.unpack_from("<H", payload, 1)[0]
            subscriptions[message_id] = payload[3:].decode("utf-8", "replace")
        elif kind == "D" and len(payload) >= 2:
            message_id = struct.unpack_from("<H", payload)[0]
            topic = subscriptions.get(message_id)
            if topic in targets and topic in formats:
                row = decode(formats[topic], payload[2:], formats)
                if isinstance(row.get("timestamp"), int):
                    records[topic].append(row)
    return records


def closest(rows: list[dict[str, Any]], timestamps: list[int], target: int, default: dict[str, Any]):
    if not rows:
        return default
    index = bisect_left(timestamps, target)
    if index == 0:
        return rows[0]
    if index == len(rows):
        return rows[-1]
    before, after = rows[index - 1], rows[index]
    return before if target - before["timestamp"] <= after["timestamp"] - target else after


def finite(value: Any, fallback: float = 0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else fallback


def normalized_controls(values: Any, count: int):
    source = values if isinstance(values, list) else []
    return [max(-1.0, min(1.0, finite(source[i] if i < len(source) else 0))) for i in range(count)]


def build_replay(records: dict[str, list[dict[str, Any]]]):
    positions = records.get("vehicle_local_position", [])
    attitudes = records.get("vehicle_attitude", [])
    if len(positions) < 2 or len(attitudes) < 2:
        raise ValueError("ULog needs at least two vehicle_local_position and vehicle_attitude samples")
    attitude_times = [row["timestamp"] for row in attitudes]
    motor_rows = records.get("actuator_motors", [])
    motor_times = [row["timestamp"] for row in motor_rows]
    servo_rows = records.get("actuator_servos", [])
    servo_times = [row["timestamp"] for row in servo_rows]
    origin = positions[0]
    first_time = positions[0]["timestamp"]
    # Preserve the log's relative altitude while placing its lowest sample a
    # metre above the rendered terrain.  This is a visual origin translation,
    # not an alteration of the ULog trajectory.
    down_offset = max(7.0, max(finite(row.get("z")) - finite(origin.get("z")) for row in positions) + 1.0)
    frames = []
    last_time = -1.0
    for position in positions:
        time = (position["timestamp"] - first_time) / 1_000_000
        if time - last_time < 0.05:  # stable, bounded 20 Hz visual playback
            continue
        attitude = closest(attitudes, attitude_times, position["timestamp"], {})
        quaternion = attitude.get("q")
        if not isinstance(quaternion, list) or len(quaternion) != 4:
            continue
        motors = closest(motor_rows, motor_times, position["timestamp"], {})
        servos = closest(servo_rows, servo_times, position["timestamp"], {})
        motor_values = normalized_controls(motors.get("control"), 12)
        servo_values = normalized_controls(servos.get("control"), 8)
        # PX4 q is w,x,y,z; the visual schema accepts x,y,z,w.  Motor/servo
        # channels are normalized actuator commands, so only their visual
        # magnitude is mapped to RPM; this does not claim physical RPM.
        lift = [max(0.0, motor_values[i]) * 2_600 for i in range(8)]
        cruise = [max(0.0, motor_values[8 + i]) * 2_800 for i in range(3)]
        frames.append({
            "version": 1,
            "sequence": len(frames),
            "time": round(time, 6),
            "frame": "NED",
            "position": [
                round(finite(position.get("x")) - finite(origin.get("x")), 5),
                round(finite(position.get("y")) - finite(origin.get("y")), 5),
                round(finite(position.get("z")) - finite(origin.get("z")) - down_offset, 5),
            ],
            "velocity": [round(finite(position.get(key)), 5) for key in ("vx", "vy", "vz")],
            "quaternion": [round(finite(quaternion[i]), 7) for i in (1, 2, 3, 0)],
            "rotorRpm": [round(value, 2) for value in lift + cruise],
            "surfaces": {
                "aileron": round(servo_values[0], 5),
                "elevator": round(servo_values[1], 5),
                "rudder": round(servo_values[2], 5),
            },
        })
        last_time = time
        if len(frames) == MAX_FRAMES:
            break
    if len(frames) < 2:
        raise ValueError("No complete, decimated visual frames were produced")
    return {
        "version": 1,
        "format": "ev50-json",
        "description": "PX4 ULog-derived visual replay; positions are rebased to a terrain-safe local NED origin. Actuator magnitudes are visual RPM proxies, not measured RPM.",
        "source": {"kind": "PX4 ULog", "frame": "NED", "samples": len(frames)},
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source .ulg")
    parser.add_argument("output", type=Path, nargs="?", help="destination .json")
    parser.add_argument("--inspect", action="store_true", help="print usable topic sample counts")
    args = parser.parse_args()
    records = parse_ulog(args.input)
    summary = {name: len(rows) for name, rows in sorted(records.items())}
    if args.inspect:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.output:
        replay = build_replay(records)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(replay, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(json.dumps({"output": str(args.output), "frames": len(replay["frames"]), "duration": replay["frames"][-1]["time"]}, ensure_ascii=False))
    elif not args.inspect:
        parser.error("output is required unless --inspect is used")


if __name__ == "__main__":
    main()
