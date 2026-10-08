"""仅绑定 loopback 的同源桥接服务；没有自动运行的仿真时钟。"""
from __future__ import annotations

import argparse
from collections import OrderedDict, deque
import copy
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

from .protocol import (MAX_BODY_BYTES, PROTOCOL, VERSION, ProtocolError, apply_command,
                       boolean, identifier, initial_state, integer, object_value, require_protocol)


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


@dataclass
class Session:
    session_id: str
    client_name: str
    deadline: float
    next_seq: int = 1
    closed: bool = False
    records: OrderedDict = field(default_factory=OrderedDict)


@dataclass
class Viewer:
    ready: bool = False
    generation: int = 0
    connected: bool = False
    last_revision: int = -1
    delivered: set = field(default_factory=set)
    report: dict | None = None


class Bridge:
    """所有修改在一把锁下线性化；服务线程只处理传输与租约。"""

    def __init__(self, lease_seconds: float = 30, history_size: int = 4096, clock=time.monotonic):
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.clock = clock
        self.lease_seconds = lease_seconds
        self.history_size = history_size
        self.state = initial_state()
        self.revision = 0
        self.session_id: str | None = None
        self.sessions: OrderedDict[str, Session] = OrderedDict()
        self.viewers: dict[str, Viewer] = {}
        self.history = deque(maxlen=history_size)
        self.last_event = {"protocol": PROTOCOL, "revision": 0, "state": copy.deepcopy(self.state), "op": "snapshot"}
        self.closed = False
        self._viewer_generation = 0

    def _viewers(self) -> list[str]:
        return [key for key, viewer in self.viewers.items() if viewer.ready and viewer.connected]

    def _commit(self, op: str, *, dt=None, seq=None, session_id=None) -> dict:
        self.revision += 1
        event = {"protocol": PROTOCOL, "revision": self.revision, "state": copy.deepcopy(self.state), "op": op}
        if dt is not None:
            event["dt"] = dt
        if seq is not None:
            event["seq"] = seq
        if session_id is not None:
            event["sessionId"] = session_id
        self.last_event = event
        self.history.append(event)
        self.condition.notify_all()
        return event

    def _release(self, reason: str) -> None:
        if self.session_id is None:
            return
        self.sessions[self.session_id].closed = True
        self.session_id = None
        self.state["owner"] = "ui"
        self.state["time"]["paused"] = True
        for motor in self.state["motors"].values():
            motor.update(enabled=False, targetRpm=0.0)
        self._commit("interrupt")
        self.last_event["reason"] = reason

    def _expire(self) -> None:
        if self.session_id and self.sessions[self.session_id].deadline <= self.clock():
            self._release("lease_expired")

    def _open(self) -> None:
        if self.closed:
            raise ProtocolError("service_closed", "桥接服务正在关闭", 503)
        self._expire()

    def health(self) -> dict:
        with self.lock:
            self._open()
            return {"protocol": PROTOCOL, "service": "transwing-local-bridge", "version": VERSION,
                    "connectedViewers": len(self._viewers()), "owner": self.state["owner"], "revision": self.revision}

    def snapshot(self, resync: bool = False) -> dict:
        with self.lock:
            self._open()
            result = {"protocol": PROTOCOL, "revision": self.revision, "state": copy.deepcopy(self.state), "op": "snapshot"}
            if resync:
                result["resync"] = True
            return result

    def create_session(self, data: dict) -> dict:
        data = object_value(data, "session", {"protocol", "clientName"}, {"protocol", "clientName"})
        require_protocol(data["protocol"])
        name = data["clientName"]
        if not isinstance(name, str) or not 1 <= len(name) <= 100:
            raise ProtocolError("invalid_client_name", "clientName 必须包含1至100个字符")
        with self.lock:
            self._open()
            if self.session_id:
                raise ProtocolError("owner_busy", "另一会话持有外部控制权；请关闭该会话，或在查看器中退出外部控制", 409)
            sid = uuid.uuid4().hex
            self.sessions[sid] = Session(sid, name, self.clock() + self.lease_seconds)
            self.session_id = sid
            # 新控制者从静态状态接管，不能继承另一时钟的隐藏动量。
            self.state["owner"] = "external"
            self.state["time"]["paused"] = True
            self._commit("snapshot")
            while len(self.sessions) > 32:
                self.sessions.popitem(last=False)
            return {"protocol": PROTOCOL, "sessionId": sid, "nextSeq": 1, "leaseSeconds": self.lease_seconds, "revision": self.revision}

    def _session(self, sid: str, active: bool = True) -> Session:
        identifier(sid, "sessionId")
        session = self.sessions.get(sid)
        if session is None:
            raise ProtocolError("unknown_session", "会话不存在，或过期历史已被回收", 404)
        if active and (session.closed or sid != self.session_id):
            raise ProtocolError("session_closed", "该会话已失去外部控制权", 409)
        return session

    def heartbeat(self, sid: str) -> dict:
        with self.lock:
            self._open()
            session = self._session(sid)
            session.deadline = self.clock() + self.lease_seconds
            return {"protocol": PROTOCOL, "sessionId": sid, "leaseSeconds": self.lease_seconds, "nextSeq": session.next_seq}

    def close_session(self, sid: str) -> dict:
        with self.lock:
            self._open()
            session = self._session(sid, active=False)
            if not session.closed:
                self._release("client_closed")
            return {"protocol": PROTOCOL, "closed": True, "revision": self.revision}

    def command(self, data: dict) -> dict:
        data = object_value(data, "command", {"protocol", "sessionId", "seq", "op", "payload"}, {"protocol", "sessionId", "seq", "op", "payload"})
        require_protocol(data["protocol"])
        sid = identifier(data["sessionId"], "sessionId")
        seq = integer(data["seq"], "seq", 1)
        if not isinstance(data["op"], str):
            raise ProtocolError("invalid_type", "op 必须是字符串")
        # NaN 等输入由具体字段校验；指纹编码也禁止非有限 JSON。
        try:
            fingerprint = json.dumps(data, allow_nan=False, sort_keys=True, separators=(",", ":"))
        except (ValueError, TypeError) as exc:
            raise ProtocolError("invalid_json_value", "命令必须由合法的有限JSON值组成") from exc
        with self.lock:
            self._open()
            session = self._session(sid)
            if seq in session.records:
                record = session.records[seq]
                if record["fingerprint"] != fingerprint:
                    raise ProtocolError("sequence_conflict", "该 seq 已接受过内容不同的命令，不能覆盖", 409)
                session.deadline = self.clock() + self.lease_seconds
                return self._receipt(session, seq, duplicate=True)
            if seq != session.next_seq:
                raise ProtocolError("sequence_out_of_order", f"预期 seq 为 {session.next_seq}，实际收到 {seq}", 409)
            new_state, dt = apply_command(self.state, data["op"], data["payload"])
            self.state = new_state
            event = self._commit(data["op"], dt=dt, seq=seq, session_id=sid)
            session.records[seq] = {"fingerprint": fingerprint, "revision": event["revision"], "applied": set(), "rejected": {}}
            while len(session.records) > self.history_size:
                session.records.popitem(last=False)
            session.next_seq += 1
            session.deadline = self.clock() + self.lease_seconds
            return self._receipt(session, seq)

    def _receipt(self, session: Session, seq: int, duplicate: bool = False) -> dict:
        record = session.records.get(seq)
        if record is None:
            raise ProtocolError("unknown_command", "命令尚未被接受，或已超出有界历史保留范围", 404)
        if record["applied"]:
            delivery = "applied"
        elif not self._viewers():
            delivery = "no_viewer"
        elif any(viewer.last_revision > record["revision"] for viewer in self.viewers.values() if viewer.ready and viewer.connected):
            delivery = "superseded"
        else:
            delivery = "pending"
        return {"protocol": PROTOCOL, "sessionId": session.session_id, "seq": seq, "revision": record["revision"],
                "accepted": True, "delivery": delivery, "appliedViewers": sorted(record["applied"]),
                "rejectedViewers": copy.deepcopy(record["rejected"]), "duplicate": duplicate}

    def receipt(self, sid: str, seq: int) -> dict:
        with self.lock:
            self._open()
            return self._receipt(self._session(sid, active=False), seq)

    def register_viewer(self, data: dict) -> dict:
        data = object_value(data, "viewer", {"protocol", "viewerId", "ready"}, {"viewerId", "ready"})
        if "protocol" in data:
            require_protocol(data["protocol"])
        vid = identifier(data["viewerId"], "viewerId")
        ready = boolean(data["ready"], "ready")
        with self.lock:
            self._open()
            if vid not in self.viewers and len(self.viewers) >= 64:
                self.viewers = {key: viewer for key, viewer in self.viewers.items() if viewer.connected}
            if vid not in self.viewers and len(self.viewers) >= 64:
                raise ProtocolError("too_many_viewers", "同时最多注册64个查看器", 429)
            viewer = self.viewers.setdefault(vid, Viewer())
            viewer.ready = ready
            return {"protocol": PROTOCOL, "viewerId": vid, "ready": ready, "revision": self.revision}

    def _viewer(self, vid: str) -> Viewer:
        identifier(vid, "viewerId")
        viewer = self.viewers.get(vid)
        if viewer is None:
            raise ProtocolError("unknown_viewer", "请先注册查看器，再订阅事件或提交应用回执", 404)
        return viewer

    def connect_viewer(self, vid: str) -> int:
        with self.lock:
            self._open()
            viewer = self._viewer(vid)
            self._viewer_generation += 1
            viewer.generation = self._viewer_generation
            viewer.connected = True
            return viewer.generation

    def disconnect_viewer(self, vid: str, generation: int | None = None) -> dict:
        with self.lock:
            viewer = self.viewers.get(vid)
            if viewer is None:
                return {"protocol": PROTOCOL, "viewerId": vid, "closed": True}
            if generation is None:
                self.viewers.pop(vid, None)
            elif generation == viewer.generation:
                viewer.connected = False
            self.condition.notify_all()
            return {"protocol": PROTOCOL, "viewerId": vid, "closed": True}

    def events_after(self, revision: int | None) -> list[dict]:
        with self.lock:
            self._open()
            if revision is None:
                return [self.snapshot()]
            integer(revision, "afterRevision")
            if revision > self.revision:
                raise ProtocolError("future_revision", "afterRevision 超过服务当前修订号", 409)
            if revision == self.revision:
                return []
            if not self.history or revision < self.history[0]["revision"] - 1:
                return [self.snapshot(resync=True)]
            return copy.deepcopy([event for event in self.history if event["revision"] > revision])

    def mark_delivered(self, vid: str, revision: int, generation: int) -> bool:
        with self.lock:
            viewer = self._viewer(vid)
            if not viewer.connected or viewer.generation != generation:
                return False
            viewer.delivered.add(revision)
            minimum = self.revision - self.history_size
            viewer.delivered = {value for value in viewer.delivered if value >= minimum}
            return True

    def acknowledge(self, data: dict) -> dict:
        data = object_value(data, "ack", {"protocol", "viewerId", "revision", "applied", "motors", "error"}, {"viewerId", "revision", "applied"})
        if "protocol" in data:
            require_protocol(data["protocol"])
        vid = identifier(data["viewerId"], "viewerId")
        revision = integer(data["revision"], "revision")
        applied = boolean(data["applied"], "applied")
        if "error" in data and (not isinstance(data["error"], str) or len(data["error"]) > 500):
            raise ProtocolError("invalid_report", "error 必须是不超过500字符的字符串")
        if "motors" in data:
            # 查看器报告只是遥测，不可回写控制状态；JSON编码仍禁止NaN。
            if not isinstance(data["motors"], dict):
                raise ProtocolError("invalid_report", "motors 遥测报告必须是对象")
            try:
                if len(json_bytes(data["motors"])) > 8192:
                    raise ProtocolError("invalid_report", "motors 遥测报告超过8192字节")
            except (ValueError, TypeError) as exc:
                raise ProtocolError("invalid_report", "motors 遥测报告必须由有限JSON值组成") from exc
        with self.lock:
            self._open()
            viewer = self._viewer(vid)
            if not viewer.ready or not viewer.connected:
                raise ProtocolError("viewer_not_ready", "查看器必须已连接，且模型已就绪", 409)
            if revision not in viewer.delivered:
                raise ProtocolError("revision_not_delivered", "不能确认未通过当前查看器事件流投递的修订号", 409)
            if revision < viewer.last_revision:
                raise ProtocolError("stale_ack", "旧修订号不能覆盖已经应用的新状态", 409)
            if applied:
                viewer.last_revision = revision
                viewer.report = copy.deepcopy(data.get("motors"))
            for session in self.sessions.values():
                for record in session.records.values():
                    if record["revision"] == revision:
                        if applied:
                            record["applied"].add(vid)
                        else:
                            record["rejected"][vid] = data.get("error", "查看器拒绝应用此状态")
            return {"protocol": PROTOCOL, "viewerId": vid, "revision": revision, "applied": applied}

    def interrupt(self, data: dict) -> dict:
        data = object_value(data, "interrupt", {"protocol", "viewerId"}, {"viewerId"})
        if "protocol" in data:
            require_protocol(data["protocol"])
        with self.lock:
            self._open()
            self._viewer(data["viewerId"])
            self._release("viewer_interrupted")
            return {"protocol": PROTOCOL, "owner": self.state["owner"], "revision": self.revision}

    def close(self) -> None:
        with self.lock:
            if not self.closed:
                self._release("service_closed")
                self.closed = True
                self.condition.notify_all()


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address=("127.0.0.1", 8765), *, dist: Path | None = None, bridge: Bridge | None = None):
        if address[0] != "127.0.0.1":
            raise ValueError("仅允许绑定127.0.0.1；此服务不支持公网监听")
        self.bridge = bridge or Bridge()
        self.dist = (dist or Path(__file__).resolve().parents[2] / "dist").resolve()
        super().__init__(address, Handler)

    def server_close(self):
        self.bridge.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server: LocalServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # 不把会话标识和请求正文写入日志。
        pass

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data: dict, status: int = 200):
        self._send(status, json_bytes(data))

    def _guard(self) -> None:
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "") not in hosts:
            raise ProtocolError("host_denied", "仅接受端口匹配的本机loopback Host", 403)
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{host}" for host in hosts}:
            raise ProtocolError("origin_denied", "禁止跨来源控制", 403)
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise ProtocolError("origin_denied", "禁止跨站点请求", 403)

    def _body(self) -> dict:
        if self.headers.get("Transfer-Encoding"):
            raise ProtocolError("invalid_body", "不支持分块传输的请求正文", 400)
        if self.headers.get_content_type() != "application/json":
            raise ProtocolError("json_required", "Content-Type 必须为 application/json", 415)
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdigit():
            raise ProtocolError("length_required", "请求必须提供合法的 Content-Length", 411)
        length = int(raw_length)
        if length > MAX_BODY_BYTES:
            raise ProtocolError("body_too_large", "请求正文超过1 MiB", 413)
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("请求正文不完整")
            def no_constant(value):
                raise ValueError("JSON数值不是有限数")
            def unique_pairs(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("JSON字段重复")
                    result[key] = value
                return result
            value = json.loads(raw.decode("utf-8"), parse_constant=no_constant, object_pairs_hook=unique_pairs)
            stack = [(value, 0)]
            while stack:
                item, depth = stack.pop()
                if depth > 32:
                    raise ValueError("JSON嵌套超过32层")
                if isinstance(item, dict):
                    stack.extend((child, depth + 1) for child in item.values())
                elif isinstance(item, list):
                    stack.extend((child, depth + 1) for child in item)
        except (UnicodeDecodeError, ValueError, RecursionError) as exc:
            raise ProtocolError("invalid_json", "正文必须是有限UTF-8 JSON，不得含重复字段或超过32层嵌套", 400) from exc
        if not isinstance(value, dict):
            raise ProtocolError("invalid_type", "请求正文必须为对象")
        return value

    def _dispatch(self):
        try:
            self.connection.settimeout(15)
            self._guard()
            path = urlsplit(self.path).path
            bridge = self.server.bridge
            method = self.command
            if method == "GET" and path == "/api/v1/health":
                return self._json(bridge.health())
            if method == "GET" and path == "/api/v1/state":
                return self._json(bridge.snapshot())
            if method == "POST" and path == "/api/v1/sessions":
                return self._json(bridge.create_session(self._body()), 201)
            match = re.fullmatch(r"/api/v1/sessions/([A-Za-z0-9_-]+)(/heartbeat)?", path)
            if match:
                if method == "POST" and match[2]:
                    object_value(self._body(), "heartbeat", set())
                    return self._json(bridge.heartbeat(match[1]))
                if method == "DELETE" and not match[2]:
                    return self._json(bridge.close_session(match[1]))
            if method == "POST" and path == "/api/v1/commands":
                return self._json(bridge.command(self._body()), 202)
            match = re.fullmatch(r"/api/v1/commands/([A-Za-z0-9_-]+)/(\d+)", path)
            if method == "GET" and match:
                return self._json(bridge.receipt(match[1], integer(int(match[2]), "seq", 1)))
            if method == "POST" and path == "/api/v1/viewers":
                return self._json(bridge.register_viewer(self._body()), 201)
            match = re.fullmatch(r"/api/v1/viewers/([A-Za-z0-9_-]+)", path)
            if method == "DELETE" and match:
                return self._json(bridge.disconnect_viewer(match[1]))
            if method == "POST" and path == "/api/v1/ack":
                return self._json(bridge.acknowledge(self._body()))
            if method == "POST" and path == "/api/v1/interrupt":
                return self._json(bridge.interrupt(self._body()))
            if method == "GET" and path == "/api/v1/events":
                return self._events()
            if path.startswith("/api/"):
                raise ProtocolError("not_found", "未知API路径或请求方法", 404)
            if method in ("GET", "HEAD"):
                return self._static(path)
            raise ProtocolError("method_not_allowed", "不支持此请求方法", 405)
        except ProtocolError as exc:
            self.close_connection = True
            self._json({"protocol": PROTOCOL, "error": {"code": exc.code, "message": str(exc)}}, exc.status)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    def _events(self):
        query = parse_qs(urlsplit(self.path).query)
        vid = identifier(query.get("viewerId", [None])[0], "viewerId")
        after = query.get("afterRevision", [self.headers.get("Last-Event-ID")])[0]
        try:
            cursor = integer(int(after), "afterRevision") if after is not None else None
        except (ValueError, TypeError) as exc:
            raise ProtocolError("invalid_revision", "afterRevision 必须为非负整数") from exc
        bridge = self.server.bridge
        events = bridge.events_after(cursor)
        generation = bridge.connect_viewer(vid)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.close_connection = True
        try:
            while True:
                for event in events:
                    revision = event["revision"]
                    # 发送之前记录，避免浏览器立即ack与服务线程之间的竞态。
                    if not bridge.mark_delivered(vid, revision, generation):
                        return
                    data = b"id: " + str(revision).encode() + b"\nevent: state\ndata: " + json_bytes(event) + b"\n\n"
                    self.wfile.write(data)
                    self.wfile.flush()
                    cursor = revision
                with bridge.condition:
                    viewer = bridge.viewers.get(vid)
                    if bridge.closed or viewer is None or not viewer.connected or viewer.generation != generation:
                        return
                    bridge._expire()
                    if cursor == bridge.revision:
                        bridge.condition.wait(timeout=1)
                    if bridge.closed:
                        return
                self.wfile.write(b"event: heartbeat\ndata: {}\n\n")
                self.wfile.flush()
                events = bridge.events_after(cursor)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, ProtocolError):
            return
        finally:
            bridge.disconnect_viewer(vid, generation)

    def _static(self, path: str):
        if path == "/":
            path = "/index.html"
        decoded = unquote(path)
        target = (self.server.dist / decoded.lstrip("/")).resolve()
        if not target.is_relative_to(self.server.dist) or not target.is_file():
            raise ProtocolError("not_found", "找不到界面资源，请先运行 npm run build", 404)
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), content_type)

    do_GET = _dispatch
    do_HEAD = _dispatch
    do_POST = _dispatch
    do_DELETE = _dispatch
    do_OPTIONS = _dispatch


def main(argv=None):
    parser = argparse.ArgumentParser(description="Transwing 同源本地视景桥（不连接真实飞控）")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parents[4] / "threejs" / "dist")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在1至65535之间")
    server = LocalServer(("127.0.0.1", args.port), dist=args.dist)
    print(f"Transwing local bridge {PROTOCOL}: http://127.0.0.1:{args.port}/?aircraft=transwing", flush=True)
    print("仅视景仿真。命令 accepted 不等于浏览器已应用或画面已显示。Ctrl+C退出。", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
