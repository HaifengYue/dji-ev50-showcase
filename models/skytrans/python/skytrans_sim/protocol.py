"""视景仿真协议与严格输入校验；此接口不连接真实飞控。"""
from __future__ import annotations

import copy
import math
from typing import Any

PROTOCOL = "transwing.sim.v1"
VERSION = "1.0.0"
MOTOR_IDS = ("L_Front", "R_Front", "L_Rear", "R_Rear")
SURFACE_IDS = ("L_Inboard", "R_Inboard", "L_Outboard", "R_Outboard", "Tail_L", "Tail_R")
SURFACE_GROUPS = {
    "inboard": ("L_Inboard", "R_Inboard"),
    "outboard": ("L_Outboard", "R_Outboard"),
    "tail": ("Tail_L", "Tail_R"),
}
SURFACE_ALIASES = {
    "inboard_L": "L_Inboard", "inboard_R": "R_Inboard",
    "outboard_L": "L_Outboard", "outboard_R": "R_Outboard",
    "tail_L": "Tail_L", "tail_R": "Tail_R",
}
MAX_BODY_BYTES = 1024 * 1024
MAX_RECORDING_COMMANDS = 10000


class ProtocolError(ValueError):
    """可安全传回客户端的协议错误。"""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status


def object_value(value: Any, label: str, allowed: set[str], required: set[str] | None = None) -> dict:
    if not isinstance(value, dict):
        raise ProtocolError("invalid_type", f"{label} 必须是对象")
    unknown = set(value) - allowed
    if unknown:
        raise ProtocolError("unknown_field", f"{label} 含未知字段：{sorted(unknown)}")
    missing = (required or set()) - set(value)
    if missing:
        raise ProtocolError("missing_field", f"{label} 缺少字段：{sorted(missing)}")
    return value


def number(value: Any, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProtocolError("invalid_type", f"{label} 必须是有限数值")
    if not low <= value <= high or not math.isfinite(value):
        raise ProtocolError("out_of_range", f"{label} 必须是 [{low}, {high}] 范围内的有限数值")
    return float(value)


def integer(value: Any, label: str, low: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < low or value > 2**53 - 1:
        raise ProtocolError("invalid_integer", f"{label} 必须是 [{low}, 2**53-1] 范围内的整数")
    return value


def boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise ProtocolError("invalid_type", f"{label} 必须是布尔值")
    return value


def identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 100 or any(not (c.isascii() and (c.isalnum() or c in "_-")) for c in value):
        raise ProtocolError("invalid_identifier", f"{label} 必须由1至100个ASCII字母、数字、下划线或连字符组成")
    return value


def require_protocol(value: Any) -> None:
    if value != PROTOCOL:
        raise ProtocolError("protocol_mismatch", f"协议版本必须是 {PROTOCOL}", 400)


def initial_state(owner: str = "ui") -> dict:
    return {
        "owner": owner,
        "positionM": [0.0, 0.0, 0.0],
        "attitude": [0.0, 0.0, 0.0, 1.0],
        "motors": {key: {"targetRpm": 0.0, "enabled": False} for key in MOTOR_IDS},
        "wingTilt": 0.0,
        "surfaces": {key: 0.0 for key in SURFACE_IDS},
        "hatchDeg": 0.0,
        "display": {"wireframe": False, "exploded": False, "environment": "hangar"},
        "time": {"seconds": 0.0, "mode": "deterministic", "paused": True},
    }


PATCH_FIELDS = {"positionM", "attitude", "motors", "wingTilt", "surfaces", "hatchDeg", "display", "time"}


def resolve_surfaces(value: Any) -> dict[str, float]:
    """所有输入先校验；单项优先于组，既有规范ID优先于UI别名。"""
    patch = object_value(value, "surfaces", set(SURFACE_IDS) | set(SURFACE_GROUPS) | set(SURFACE_ALIASES))
    checked = {key: number(angle, key, -12, 12) for key, angle in patch.items()}
    result = {}
    for group, ids in SURFACE_GROUPS.items():
        if group in checked:
            result.update({key: checked[group] for key in ids})
    for alias, key in SURFACE_ALIASES.items():
        if alias in checked:
            result[key] = checked[alias]
    for key in SURFACE_IDS:
        if key in checked:
            result[key] = checked[key]
    return result


def apply_patch(state: dict, patch: Any) -> dict:
    """先校验副本，再提交；错误不会部分修改状态。"""
    patch = object_value(patch, "state patch", PATCH_FIELDS)
    result = copy.deepcopy(state)
    for key, value in patch.items():
        if key == "positionM":
            if not isinstance(value, list) or len(value) != 3:
                raise ProtocolError("invalid_vector", "positionM 必须恰好包含三个数值，单位为约定米")
            result[key] = [number(v, f"positionM[{i}]", -100000, 100000) for i, v in enumerate(value)]
        elif key == "attitude":
            if not isinstance(value, list) or len(value) != 4:
                raise ProtocolError("invalid_quaternion", "attitude 必须为 [x,y,z,w] 四元数")
            quaternion = [number(v, f"attitude[{i}]", -1.001, 1.001) for i, v in enumerate(value)]
            norm = math.sqrt(sum(v * v for v in quaternion))
            if abs(norm - 1) > 0.001:
                raise ProtocolError("invalid_quaternion", "attitude 必须为单位四元数，模长容差为0.001")
            result[key] = [v / norm for v in quaternion]
        elif key == "motors":
            motors = object_value(value, key, set(MOTOR_IDS))
            for motor_id, settings in motors.items():
                settings = object_value(settings, motor_id, {"targetRpm", "enabled"})
                for field, setting in settings.items():
                    result[key][motor_id][field] = number(setting, f"{motor_id}.targetRpm", 0, 12000) if field == "targetRpm" else boolean(setting, f"{motor_id}.enabled")
        elif key == "surfaces":
            result[key].update(resolve_surfaces(value))
        elif key == "wingTilt":
            result[key] = number(value, key, 0, 1)
        elif key == "hatchDeg":
            result[key] = number(value, key, 0, 55)
        elif key == "display":
            for field, setting in object_value(value, key, {"wireframe", "exploded", "environment"}).items():
                if field == "environment":
                    if setting not in ("hangar", "sky"):
                        raise ProtocolError("invalid_environment", "environment 只允许 hangar 或 sky")
                    result[key][field] = setting
                else:
                    result[key][field] = boolean(setting, f"display.{field}")
        elif key == "time":
            for field, setting in object_value(value, key, {"paused", "mode"}).items():
                if field == "mode":
                    if setting != "deterministic":
                        raise ProtocolError("external_clock_only", "外部控制时 time.mode 只能为 deterministic")
                else:
                    result[key][field] = boolean(setting, "time.paused")
    if result["display"]["exploded"] and any(m["enabled"] or m["targetRpm"] > 0 for m in result["motors"].values()):
        raise ProtocolError("unsafe_display", "拆解视图要求在同一原子状态中停用全部电机，并将全部 targetRpm 设为0")
    return result


def apply_command(state: dict, op: str, payload: Any) -> tuple[dict, float | None]:
    if op == "set":
        return apply_patch(state, payload), None
    if op == "step":
        payload = object_value(payload, "step", {"dt"}, {"dt"})
        dt = number(payload["dt"], "dt", 0, 60)
        result = copy.deepcopy(state)
        result["time"]["seconds"] = number(result["time"]["seconds"] + dt, "time.seconds", 0, 86400)
        return result, dt
    if op == "seek":
        payload = object_value(payload, "seek", {"seconds", "state"}, {"seconds"})
        result = apply_patch(state, payload.get("state", {}))
        result["time"]["seconds"] = number(payload["seconds"], "seconds", 0, 86400)
        result["time"]["paused"] = True
        return result, None
    if op == "pause":
        payload = object_value(payload, "pause", {"paused"})
        result = copy.deepcopy(state)
        result["time"]["paused"] = boolean(payload.get("paused", True), "paused")
        return result, None
    if op == "reset":
        object_value(payload, "reset", set())
        return initial_state(state["owner"]), None
    raise ProtocolError("unknown_operation", f"未知操作：{op}")


def validate_recording(value: Any) -> dict:
    value = object_value(value, "recording", {"protocol", "commands"}, {"protocol", "commands"})
    require_protocol(value["protocol"])
    commands = value["commands"]
    if not isinstance(commands, list) or len(commands) > MAX_RECORDING_COMMANDS:
        raise ProtocolError("invalid_recording", "commands 必须是数组，且最多包含10000条命令")
    state = initial_state("external")
    for index, command in enumerate(commands):
        command = object_value(command, f"commands[{index}]", {"op", "payload"}, {"op", "payload"})
        state, _ = apply_command(state, command["op"], command["payload"])
    return copy.deepcopy(value)
