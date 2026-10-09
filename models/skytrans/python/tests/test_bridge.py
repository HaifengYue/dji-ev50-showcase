"""内存服务核心测试：顺序、幂等、重连、租约、并发与销毁。"""
from concurrent.futures import ThreadPoolExecutor
import unittest
from skytrans_sim.protocol import PROTOCOL, ProtocolError
from skytrans_sim.server import Bridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.now = [100.0]
        self.bridge = Bridge(clock=lambda: self.now[0])
        self.session = self.bridge.create_session({"protocol": PROTOCOL, "clientName": "测试"})
        self.sid = self.session["sessionId"]

    def command(self, seq=1, op="set", payload=None):
        return {"protocol": PROTOCOL, "sessionId": self.sid, "seq": seq, "op": op, "payload": payload or {}}

    def test_order_conflict_and_idempotence(self):
        command = self.command(payload={"wingTilt": .2})
        first = self.bridge.command(command)
        duplicate = self.bridge.command(command)
        self.assertEqual(first["revision"], duplicate["revision"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(first["delivery"], "no_viewer")
        for other in [self.command(payload={"wingTilt": .3}), self.command(seq=3), self.command(seq=0), self.command(seq=True)]:
            with self.assertRaises(ProtocolError):
                self.bridge.command(other)
        self.assertEqual(self.bridge.state["wingTilt"], .2)

    def test_invalid_command_does_not_consume_sequence(self):
        with self.assertRaises(ProtocolError):
            self.bridge.command(self.command(payload={"wingTilt": 2}))
        self.assertEqual(self.bridge.command(self.command())["seq"], 1)

    def test_no_viewer_pending_applied_and_stale_ack(self):
        self.bridge.register_viewer({"viewerId": "actual_viewer", "ready": True})
        generation = self.bridge.connect_viewer("actual_viewer")
        receipt = self.bridge.command(self.command())
        self.assertEqual(receipt["delivery"], "pending")
        ack = {"viewerId": "actual_viewer", "revision": receipt["revision"], "applied": True}
        with self.assertRaises(ProtocolError):
            self.bridge.acknowledge(ack)
        self.bridge.mark_delivered("actual_viewer", receipt["revision"], generation)
        self.bridge.acknowledge(ack)
        self.assertEqual(self.bridge.receipt(self.sid, 1)["delivery"], "applied")
        second = self.bridge.command(self.command(seq=2))
        self.bridge.mark_delivered("actual_viewer", second["revision"], generation)
        self.bridge.acknowledge({**ack, "revision": second["revision"]})
        with self.assertRaises(ProtocolError):
            self.bridge.acknowledge(ack)
        self.bridge.disconnect_viewer("actual_viewer", generation)
        self.assertEqual(self.bridge.health()["connectedViewers"], 0)
        self.assertEqual(self.bridge.receipt(self.sid, 1)["delivery"], "applied")

    def test_false_observer_never_counts_as_viewer(self):
        self.bridge.register_viewer({"viewerId": "observer", "ready": False})
        self.bridge.connect_viewer("observer")
        self.assertEqual(self.bridge.health()["connectedViewers"], 0)

    def test_disconnect_reconnect_replay_and_generation(self):
        self.bridge.register_viewer({"viewerId": "v", "ready": True})
        old = self.bridge.connect_viewer("v")
        first = self.bridge.command(self.command(op="step", payload={"dt": .1}))
        self.bridge.disconnect_viewer("v", old)
        self.bridge.command(self.command(seq=2, op="step", payload={"dt": .2}))
        new = self.bridge.connect_viewer("v")
        self.bridge.disconnect_viewer("v", old)
        self.assertTrue(self.bridge.viewers["v"].connected)
        replay = self.bridge.events_after(first["revision"])
        self.assertEqual([item["dt"] for item in replay], [.2])
        self.assertFalse(self.bridge.mark_delivered("v", first["revision"], old))
        self.assertTrue(self.bridge.mark_delivered("v", first["revision"], new))

    def test_history_overrun_safely_resyncs(self):
        bridge = Bridge(history_size=2)
        sid = bridge.create_session({"protocol": PROTOCOL, "clientName": "test"})["sessionId"]
        for seq in range(1, 5):
            bridge.command({**self.command(seq=seq), "sessionId": sid})
        events = bridge.events_after(0)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["op"], "snapshot")
        self.assertTrue(events[0]["resync"])
        with self.assertRaises(ProtocolError):
            bridge.events_after(100)
        with self.assertRaises(ProtocolError):
            bridge.receipt(sid, 1)

    def test_lease_and_close_stop_targets(self):
        self.bridge.command(self.command(payload={"motors": {"L_Front": {"enabled": True, "targetRpm": 1500}}}))
        self.now[0] += 29
        self.bridge.heartbeat(self.sid)
        self.now[0] += 29
        self.assertEqual(self.bridge.health()["owner"], "external")
        self.now[0] += 2
        self.assertEqual(self.bridge.health()["owner"], "ui")
        self.assertEqual(self.bridge.state["motors"]["L_Front"], {"targetRpm": 0, "enabled": False})
        with self.assertRaises(ProtocolError):
            self.bridge.command(self.command(seq=2))
        self.bridge.close_session(self.sid)
        self.bridge.close_session(self.sid)

    def test_exclusive_ownership_and_ui_interrupt(self):
        with self.assertRaises(ProtocolError):
            self.bridge.create_session({"protocol": PROTOCOL, "clientName": "second"})
        self.bridge.register_viewer({"viewerId": "v", "ready": True})
        result = self.bridge.interrupt({"viewerId": "v"})
        self.assertEqual(result["owner"], "ui")
        with self.assertRaises(ProtocolError):
            self.bridge.heartbeat(self.sid)
        self.bridge.create_session({"protocol": PROTOCOL, "clientName": "second"})

    def test_concurrent_duplicates_linearize_once(self):
        command = self.command(op="step", payload={"dt": .5})
        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(lambda _: self.bridge.command(command), range(40)))
        self.assertEqual(len({item["revision"] for item in results}), 1)
        self.assertEqual(self.bridge.state["time"]["seconds"], .5)

    def test_destroy_and_version(self):
        with self.assertRaises(ProtocolError):
            self.bridge.command({**self.command(), "protocol": "wrong"})
        self.bridge.close()
        self.bridge.close()
        self.assertEqual(self.bridge.state["owner"], "ui")
        with self.assertRaises(ProtocolError):
            self.bridge.snapshot()


if __name__ == "__main__":
    unittest.main()
