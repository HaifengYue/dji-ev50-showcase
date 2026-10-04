"""标准库 Python SDK：命令接受与查看器应用分开报告。"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import uuid

from .protocol import MAX_BODY_BYTES, MOTOR_IDS, PROTOCOL, ProtocolError, require_protocol, validate_recording


class RemoteError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code


class ApplicationTimeout(TimeoutError):
    def __init__(self, receipt: dict | None):
        super().__init__(f"超时前未获得查看器应用确认：{receipt}")
        self.receipt = receipt


class UncertainCommand(ConnectionError):
    """传输结果未知；用 retry_pending 重发同seq，而不是另发新命令。"""


class Subscription:
    """只读观察者，不冒充真正模型查看器、不产生 applied 回执。"""

    def __init__(self, client: "Client", after_revision: int | None = None):
        self.client = client
        self.viewer_id = "observer_" + uuid.uuid4().hex
        self.closed = False
        self.response = None
        client._request("POST", "/viewers", {"viewerId": self.viewer_id, "ready": False})
        query = {"viewerId": self.viewer_id}
        if after_revision is not None:
            query["afterRevision"] = str(after_revision)
        try:
            request = Request(client.base_url + "/api/v1/events?" + urlencode(query), headers={"Accept": "text/event-stream"})
            self.response = urlopen(request, timeout=max(client.timeout, 5))
        except BaseException:
            client._request("DELETE", f"/viewers/{self.viewer_id}")
            raise

    def __iter__(self):
        return self

    def __next__(self):
        data = []
        event = "message"
        while not self.closed:
            line = self.response.readline()
            if not line:
                self.close()
                raise StopIteration
            text = line.decode("utf-8").rstrip("\r\n")
            if not text:
                if event == "state" and data:
                    result = json.loads("\n".join(data))
                    require_protocol(result.get("protocol"))
                    return result
                data, event = [], "message"
            elif text.startswith("event:"):
                event = text[6:].strip()
            elif text.startswith("data:"):
                data.append(text[5:].lstrip())
        raise StopIteration

    def close(self):
        if not self.closed:
            self.closed = True
            if self.response is not None:
                self.response.close()
            try:
                self.client._request("DELETE", f"/viewers/{self.viewer_id}")
            except (RemoteError, OSError):
                pass
            self.client._subscriptions.discard(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class Client:
    def __init__(self, base_url: str = "http://127.0.0.1:8765", *, client_name: str = "python-sdk", timeout: float = 5, heartbeat: bool = True):
        parsed = urlsplit(base_url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("SDK仅接受本机loopback的HTTP来源地址")
        self.base_url = base_url.rstrip("/")
        self.client_name = client_name
        self.timeout = timeout
        self.auto_heartbeat = heartbeat
        self.session_id: str | None = None
        self.next_seq = 1
        self.closed = False
        self.connection_error: Exception | None = None
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._heartbeat_thread: threading.Thread | None = None
        self._pending: dict | None = None
        self._subscriptions: set[Subscription] = set()
        self._recording: list[dict] | None = None

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        try:
            body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode() if payload is not None else None
        except (ValueError, TypeError) as exc:
            raise ProtocolError("invalid_json_value", "payload 必须由有限JSON值组成") from exc
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base_url + "/api/v1" + path, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read(MAX_BODY_BYTES + 1))
        except HTTPError as exc:
            try:
                error = json.loads(exc.read(MAX_BODY_BYTES)).get("error", {})
            except ValueError:
                error = {}
            raise RemoteError(exc.code, error.get("code", "http_error"), error.get("message", str(exc))) from exc
        require_protocol(result.get("protocol"))
        return result

    def connect(self) -> "Client":
        with self._lock:
            if self.closed:
                raise RuntimeError("客户端已关闭，请新建 Client")
            if self.session_id:
                return self
            result = self._request("POST", "/sessions", {"protocol": PROTOCOL, "clientName": self.client_name})
            self.session_id = result["sessionId"]
            self.next_seq = result["nextSeq"]
            if self.auto_heartbeat:
                interval = max(0.05, result["leaseSeconds"] / 3)
                self._heartbeat_thread = threading.Thread(target=self._keep_alive, args=(interval,), daemon=True, name="transwing-lease")
                self._heartbeat_thread.start()
            return self

    def _keep_alive(self, interval: float):
        while not self._stop.wait(interval):
            try:
                self.heartbeat()
                self.connection_error = None
            except (RemoteError, OSError) as exc:
                self.connection_error = exc
                if isinstance(exc, RemoteError) and exc.code in ("session_closed", "unknown_session"):
                    return

    def heartbeat(self) -> dict:
        if not self.session_id or self.closed:
            raise RuntimeError("请先调用 connect")
        return self._request("POST", f"/sessions/{self.session_id}/heartbeat", {})

    def health(self) -> dict:
        return self._request("GET", "/health")

    def snapshot(self) -> dict:
        return self._request("GET", "/state")

    def ready(self, timeout: float = 0) -> bool:
        """等待已连接且模型ready的查看器；不声称画面已验证。"""
        end = time.monotonic() + timeout
        while True:
            if self.health()["connectedViewers"] > 0:
                return True
            if time.monotonic() >= end:
                return False
            time.sleep(min(0.1, max(0, end - time.monotonic())))

    def command(self, op: str, payload: dict | None = None, *, wait_applied: bool = False, timeout: float = 5) -> dict:
        with self._lock:
            if self.closed or not self.session_id:
                raise RuntimeError("请先连接，再发送命令")
            if self._pending:
                raise UncertainCommand("上一命令结果未知；请先调用 retry_pending，再发送新命令")
            envelope = {"protocol": PROTOCOL, "sessionId": self.session_id, "seq": self.next_seq, "op": op, "payload": payload if payload is not None else {}}
            # 拒绝非有限值后才建立待重试记录。
            try:
                json.dumps(envelope, allow_nan=False)
            except (ValueError, TypeError) as exc:
                raise ProtocolError("invalid_json_value", "payload 必须由有限JSON值组成") from exc
            self._pending = copy.deepcopy(envelope)
            receipt = self.retry_pending()
        return self.wait_applied(receipt, timeout=timeout) if wait_applied else receipt

    def retry_pending(self) -> dict:
        with self._lock:
            if self._pending is None:
                raise RuntimeError("没有等待重试的命令")
            envelope = self._pending
            try:
                receipt = self._request("POST", "/commands", envelope)
            except RemoteError:
                self._pending = None
                raise
            except (OSError, URLError, TimeoutError) as exc:
                raise UncertainCommand("命令结果未知；retry_pending 会以相同 sessionId/seq 幂等重试") from exc
            self.next_seq = envelope["seq"] + 1
            self._pending = None
            if self._recording is not None:
                self._recording.append({"op": envelope["op"], "payload": copy.deepcopy(envelope["payload"])})
            return receipt

    def receipt(self, seq: int) -> dict:
        if not self.session_id:
            raise RuntimeError("请先调用 connect")
        return self._request("GET", f"/commands/{self.session_id}/{seq}")

    def wait_applied(self, receipt: dict, *, timeout: float = 5) -> dict:
        end = time.monotonic() + timeout
        while True:
            current = self.receipt(receipt["seq"])
            if current["delivery"] == "applied":
                return current
            if current["delivery"] == "superseded" or current["rejectedViewers"] or time.monotonic() >= end:
                raise ApplicationTimeout(current)
            time.sleep(min(0.05, max(0, end - time.monotonic())))

    def set_state(self, *, wait_applied: bool = False, **patch) -> dict:
        return self.command("set", patch, wait_applied=wait_applied)

    def set_pose(self, position_m, attitude_xyzw=(0, 0, 0, 1), *, wait_applied=False) -> dict:
        return self.set_state(positionM=list(position_m), attitude=list(attitude_xyzw), wait_applied=wait_applied)

    def set_motor(self, motor_id: str, target_rpm: float, *, enabled: bool = True, wait_applied=False) -> dict:
        return self.set_state(motors={motor_id: {"targetRpm": target_rpm, "enabled": enabled}}, wait_applied=wait_applied)

    def stop_motors(self) -> dict:
        return self.set_state(motors={key: {"targetRpm": 0, "enabled": False} for key in MOTOR_IDS})

    def step(self, dt: float, *, wait_applied=False) -> dict:
        return self.command("step", {"dt": dt}, wait_applied=wait_applied)

    def seek(self, seconds: float, state: dict | None = None, *, wait_applied=False) -> dict:
        payload = {"seconds": seconds}
        if state is not None:
            payload["state"] = state
        return self.command("seek", payload, wait_applied=wait_applied)

    def pause(self, paused: bool = True) -> dict:
        return self.command("pause", {"paused": paused})

    def reset(self) -> dict:
        return self.command("reset", {})

    def subscribe(self, after_revision: int | None = None) -> Subscription:
        if self.closed:
            raise RuntimeError("客户端已关闭")
        subscription = Subscription(self, after_revision)
        self._subscriptions.add(subscription)
        return subscription

    def start_recording(self, *, include_reset: bool = True):
        self._recording = []
        if include_reset:
            self.reset()

    def save_recording(self, path: str | Path) -> dict:
        if self._recording is None:
            raise RuntimeError("请先调用 start_recording")
        value = validate_recording({"protocol": PROTOCOL, "commands": self._recording})
        encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_BODY_BYTES:
            raise ProtocolError("recording_too_large", "记录大小不得超过1 MiB")
        Path(path).write_bytes(encoded)
        return value

    def replay(self, recording: dict | str | Path, *, wait_applied: bool = False) -> list[dict]:
        if isinstance(recording, (str, Path)):
            raw = Path(recording).read_bytes()
            if len(raw) > MAX_BODY_BYTES:
                raise ProtocolError("recording_too_large", "记录大小不得超过1 MiB")
            recording = json.loads(raw)
        checked = validate_recording(recording)
        self.reset()
        return [self.command(item["op"], item["payload"], wait_applied=wait_applied) for item in checked["commands"]]

    def close(self) -> dict | None:
        if self.closed:
            return None
        self._stop.set()
        if self._heartbeat_thread and threading.current_thread() != self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=self.timeout + 0.1)
        for subscription in list(self._subscriptions):
            subscription.close()
        with self._lock:
            self.closed = True
            if self.session_id:
                return self._request("DELETE", f"/sessions/{self.session_id}")
        return None

    def __enter__(self):
        return self.connect()

    def __exit__(self, exc_type, exc, traceback):
        try:
            self.close()
        except (RemoteError, OSError):
            if exc is None:
                raise
