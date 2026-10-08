"""离线生成可被网页导入的确定性协议记录，不需要本地服务。"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from .protocol import MAX_BODY_BYTES, MAX_RECORDING_COMMANDS, PROTOCOL, ProtocolError, apply_command, initial_state, validate_recording


def snapshot_to_patch(snapshot: dict) -> dict:
    """把状态快照变为seek/set可用补丁；绝对时间通过seek(seconds)传递。"""
    state = copy.deepcopy(snapshot.get("state", snapshot))
    state.pop("owner", None)
    state.get("time", {}).pop("seconds", None)
    return state


class Recording:
    def __init__(self):
        self.commands: list[dict] = []
        self.state = initial_state("external")

    def command(self, op: str, payload: dict | None = None) -> "Recording":
        if len(self.commands) >= MAX_RECORDING_COMMANDS:
            raise ProtocolError("recording_too_large", "记录最多包含10000条命令")
        payload = payload if payload is not None else {}
        state, _ = apply_command(self.state, op, payload)
        self.commands.append({"op": op, "payload": copy.deepcopy(payload)})
        self.state = state
        return self

    def set_state(self, **patch) -> "Recording":
        return self.command("set", patch)

    def set_surface(self, surface_id: str, degrees: float) -> "Recording":
        return self.set_state(surfaces={surface_id: degrees})

    def set_surfaces(self, **angles: float) -> "Recording":
        return self.set_state(surfaces=angles)

    def step(self, dt: float) -> "Recording":
        return self.command("step", {"dt": dt})

    def seek(self, seconds: float, state: dict | None = None) -> "Recording":
        return self.command("seek", {"seconds": seconds, **({"state": state} if state is not None else {})})

    def reset(self) -> "Recording":
        return self.command("reset", {})

    def as_dict(self) -> dict:
        return validate_recording({"protocol": PROTOCOL, "commands": self.commands})

    def save(self, path: str | Path) -> Path:
        data = json.dumps(self.as_dict(), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(data) > MAX_BODY_BYTES:
            raise ProtocolError("recording_too_large", "记录大小不得超过1 MiB")
        destination = Path(path)
        destination.write_bytes(data)
        return destination
