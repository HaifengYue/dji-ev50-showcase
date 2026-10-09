"""真实HTTP/SSE和SDK联测；查看器为协议模拟器，不冒称浏览器验证。"""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from skytrans_sim import ApplicationTimeout, Client, Recording, RemoteError
from skytrans_sim.client import UncertainCommand
from skytrans_sim.protocol import MAX_BODY_BYTES, PROTOCOL, ProtocolError
from skytrans_sim.server import LocalServer


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.dist = Path(cls.directory.name) / "dist"
        cls.dist.mkdir()
        (cls.dist / "index.html").write_text("<html>本地测试UI</html>")
        (Path(cls.directory.name) / "secret.txt").write_text("不得从dist外读取")
        cls.server = LocalServer(("127.0.0.1", 0), dist=cls.dist)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)
        cls.directory.cleanup()

    def setUp(self):
        self.client = Client(self.base, heartbeat=False).connect()

    def tearDown(self):
        self.client.close()

    def request(self, method, path, payload=None, headers=None):
        body = json.dumps(payload).encode() if payload is not None else None
        hdr = {"Content-Type": "application/json", **(headers or {})}
        try:
            with urlopen(Request(self.base + path, data=body, headers=hdr, method=method), timeout=2) as response:
                return response.status, dict(response.headers), response.read()
        except HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def viewer(self, name="viewer", after=None):
        self.request("POST", "/api/v1/viewers", {"viewerId": name, "ready": True})
        suffix = f"&afterRevision={after}" if after is not None else ""
        return urlopen(self.base + f"/api/v1/events?viewerId={name}" + suffix, timeout=3)

    @staticmethod
    def event(stream):
        kind = None
        while True:
            line = stream.readline().decode().strip()
            if line.startswith("event:"):
                kind = line[6:].strip()
            if line.startswith("data:") and kind == "state":
                return json.loads(line[5:])
            if not line and stream.closed:
                raise EOFError("SSE disconnected")

    def test_real_command_sse_ack_and_reconnect(self):
        self.assertFalse(self.client.ready())
        first = self.client.set_motor("L_Front", 1000)
        self.assertEqual(first["delivery"], "no_viewer")
        stream = self.viewer("actual_model_protocol_simulator")
        event = self.event(stream)
        self.assertEqual(event["state"]["motors"]["L_Front"]["targetRpm"], 1000)
        self.assertTrue(self.client.ready())
        status, _, _ = self.request("POST", "/api/v1/ack", {"viewerId": "actual_model_protocol_simulator", "revision": event["revision"], "applied": True})
        self.assertEqual(status, 200)
        self.assertEqual(self.client.receipt(first["seq"])["delivery"], "applied")
        step = self.client.step(.1)
        stepped = self.event(stream)
        self.assertEqual(stepped["op"], "step")
        self.assertEqual(stepped["dt"], .1)
        stream.close()
        # 显式关闭模拟查看器；真实断网由SSE写失败检测。
        self.request("DELETE", "/api/v1/viewers/actual_model_protocol_simulator")
        self.client.step(.2)
        stream = self.viewer("actual_model_protocol_simulator", stepped["revision"])
        replay = self.event(stream)
        self.assertEqual(replay["dt"], .2)
        self.assertEqual(replay["revision"], step["revision"] + 1)
        stream.close()
        self.request("DELETE", "/api/v1/viewers/actual_model_protocol_simulator")

    def test_snapshot_subscription_is_read_only_observer(self):
        with self.client.subscribe() as subscription:
            event = next(subscription)
            self.assertEqual(event["op"], "snapshot")
            self.assertFalse(self.client.ready())
            receipt = self.client.step(.01)
            self.assertEqual(next(subscription)["revision"], receipt["revision"])
        self.assertFalse(self.client.ready())

    def test_sdk_six_surfaces_preserve_hatch_and_sse_canonical_ids(self):
        self.client.reset()
        self.client.set_state(hatchDeg=22)
        angles = {"L_Inboard": 2, "R_Inboard": -3, "L_Outboard": 4, "R_Outboard": -5, "Tail_L": 6, "Tail_R": -7}
        for surface_id, degrees in angles.items():
            self.client.set_surface(surface_id, degrees)
        self.assertEqual(self.client.snapshot()["state"]["surfaces"], angles)
        stream = self.viewer("independent_surface_viewer")
        try:
            initial = self.event(stream)
            self.assertEqual(initial["state"]["surfaces"], angles)
            self.client.set_surfaces(inboard=8, inboard_L=0, Tail_R=0)
            updated = self.event(stream)["state"]
            self.assertEqual(updated["surfaces"], {**angles, "L_Inboard": 0, "R_Inboard": 8, "Tail_R": 0})
            self.assertEqual(updated["hatchDeg"], 22)
            before = self.client.snapshot()
            with self.assertRaises(RemoteError):
                self.client.set_surfaces(inboard=100, L_Inboard=1, R_Inboard=2)
            self.assertEqual(self.client.snapshot()["state"], before["state"])
            self.client.reset()
            reset = self.event(stream)["state"]
            self.assertEqual(reset["surfaces"], {key: 0 for key in angles})
            self.assertEqual(reset["hatchDeg"], 0)
        finally:
            stream.close()
            self.request("DELETE", "/api/v1/viewers/independent_surface_viewer")

    def test_many_viewer_refreshes_do_not_exhaust_capacity(self):
        for index in range(80):
            vid = f"refresh_{index}"
            self.assertEqual(self.request("POST", "/api/v1/viewers", {"viewerId": vid, "ready": False})[0], 201)
            self.assertEqual(self.request("DELETE", f"/api/v1/viewers/{vid}")[0], 200)
        self.assertLess(len(self.server.bridge.viewers), 64)

    def test_sdk_parallel_commands_and_replay(self):
        self.client.reset()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.client.step(.1), range(20)))
        self.assertEqual(len({result["seq"] for result in results}), 20)
        self.assertAlmostEqual(self.client.snapshot()["state"]["time"]["seconds"], 2)
        record = Recording().reset().set_state(positionM=[1, 2, 3], wingTilt=.2).step(.2).as_dict()
        self.client.replay(record)
        first = self.client.snapshot()["state"]
        self.client.replay(record)
        self.assertEqual(first, self.client.snapshot()["state"])
        with self.assertRaises(ApplicationTimeout) as exc:
            self.client.wait_applied(results[-1], timeout=0)
        self.assertEqual(exc.exception.receipt["delivery"], "no_viewer")

    def test_security_origin_host_static_and_limit(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("本地测试UI".encode(), body)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("GET", "/api/v1/state", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/v1/state", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/v1/state", headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.request("GET", "/api/v1/state", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("GET", "/%2e%2e/secret.txt")[0], 404)
        self.assertEqual(self.request("GET", "/api/v1/state", headers={"Origin": self.base})[0], 200)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request("POST", "/api/v1/commands", body=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(MAX_BODY_BYTES + 1)})
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        connection.close()

    def test_bad_json_deep_nesting_and_mime(self):
        for raw in [b'{"x":NaN}', b'{"x":1,"x":2}', b'{"x":' + b'['*1500 + b'0' + b']'*1500 + b'}']:
            connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
            connection.request("POST", "/api/v1/commands", body=raw, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
            connection.close()
        self.assertEqual(self.request("POST", "/api/v1/commands", {}, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("OPTIONS", "/api/v1/commands")[0], 404)

    def test_disconnect_and_interruption_close_client(self):
        self.client.set_motor("R_Rear", 1200)
        self.request("POST", "/api/v1/viewers", {"viewerId": "interrupt_test", "ready": True})
        self.assertEqual(self.request("POST", "/api/v1/interrupt", {"viewerId": "interrupt_test"})[0], 200)
        self.assertEqual(self.client.snapshot()["state"]["owner"], "ui")
        with self.assertRaises(RemoteError) as exc:
            self.client.step(.1)
        self.assertEqual(exc.exception.code, "session_closed")
        self.request("DELETE", "/api/v1/viewers/interrupt_test")

    def test_uncertain_transport_reuses_sequence(self):
        original = self.client._request
        initial_seconds = self.client.snapshot()["state"]["time"]["seconds"]
        count = [0]
        def uncertain(method, path, payload=None):
            if path == "/commands" and count[0] == 0:
                count[0] += 1
                original(method, path, payload)
                raise OSError("模拟响应丢失，服务器已接受")
            return original(method, path, payload)
        self.client._request = uncertain
        with self.assertRaises(UncertainCommand):
            self.client.step(.2)
        with self.assertRaises(UncertainCommand):
            self.client.step(.3)
        receipt = self.client.retry_pending()
        self.assertTrue(receipt["duplicate"])
        self.assertEqual(self.client.next_seq, 2)
        self.assertAlmostEqual(self.client.snapshot()["state"]["time"]["seconds"], initial_seconds + .2)

    def test_binding_restricted(self):
        with self.assertRaises(ValueError):
            LocalServer(("0.0.0.0", 8765))
        with self.assertRaises(ValueError):
            Client("https://example.com")


if __name__ == "__main__":
    unittest.main()
