"""边界与原子性测试；不涉及真实浏览器渲染。"""
import copy
import math
import tempfile
from pathlib import Path
import unittest

from transwing_sim import Recording, snapshot_to_patch
from transwing_sim.protocol import MOTOR_IDS, SURFACE_IDS, PROTOCOL, ProtocolError, apply_command, apply_patch, initial_state, validate_recording


class ProtocolTests(unittest.TestCase):
    def test_all_fields_and_boundaries(self):
        state = initial_state()
        patch = {"positionM": [-100000, 0, 100000], "attitude": [0, math.sin(math.pi/4), 0, math.cos(math.pi/4)], "motors": {key: {"targetRpm": 12000, "enabled": True} for key in MOTOR_IDS}, "wingTilt": 1, "surfaces": {"L_Inboard": -12, "Tail_R": 12}, "hatchDeg": 55, "display": {"wireframe": True, "environment": "sky"}}
        result = apply_patch(state, patch)
        self.assertEqual(result["positionM"], [-100000, 0, 100000])
        self.assertEqual(result["motors"]["R_Rear"]["targetRpm"], 12000)
        self.assertEqual(state, initial_state())
        self.assertAlmostEqual(sum(x*x for x in result["attitude"]), 1)

    def test_reject_invalid_values_without_partial_mutation(self):
        patches = [
            {"positionM": [0, 0, float("nan")]}, {"positionM": [0, 0, float("inf")]},
            {"positionM": [0, 0, True]}, {"positionM": [0, 0, 100001]}, {"positionM": [0, 0, 10**500]},
            {"positionM": [1, 2]}, {"attitude": [0, 0, 0, 0]}, {"attitude": [0, 0, 0, 2]},
            {"attitude": [0, 0, 1]}, {"motors": {"X": {"targetRpm": 20}}},
            {"motors": {"L_Front": {"targetRpm": -1}}}, {"motors": {"L_Front": {"enabled": 1}}},
            {"surfaces": {"Tail_L": 12.01}}, {"surfaces": {"Tail_L": -12.01}}, {"hatchDeg": 55.01},
            {"wingTilt": -0.01}, {"wingTilt": 1.01}, {"display": {"wireframe": "yes"}},
            {"display": {"environment": "moon"}}, {"time": {"mode": "realtime"}},
            {"time": {"seconds": 1}}, {"owner": "external"}, {"unknown": 1},
        ]
        for patch in patches:
            with self.subTest(patch=patch):
                state = initial_state()
                before = copy.deepcopy(state)
                with self.assertRaises(ProtocolError):
                    apply_patch(state, patch)
                self.assertEqual(state, before)

    def test_motor_and_surface_partial_updates(self):
        first = apply_patch(initial_state(), {"motors": {"L_Rear": {"targetRpm": 600, "enabled": True}}})
        second = apply_patch(first, {"motors": {"L_Rear": {"enabled": False}}})
        self.assertEqual(second["motors"]["L_Rear"], {"targetRpm": 600, "enabled": False})
        self.assertEqual(second["motors"]["R_Rear"], {"targetRpm": 0, "enabled": False})

    def test_exploded_requires_atomic_stop(self):
        state = apply_patch(initial_state(), {"motors": {"L_Rear": {"targetRpm": 100, "enabled": True}}})
        with self.assertRaises(ProtocolError):
            apply_patch(state, {"display": {"exploded": True}})
        result = apply_patch(state, {"display": {"exploded": True}, "motors": {"L_Rear": {"targetRpm": 0, "enabled": False}}})
        self.assertTrue(result["display"]["exploded"])

    def test_independent_surfaces_group_precedence_and_partial_updates(self):
        for surface_id in SURFACE_IDS:
            result = apply_patch(initial_state(), {"surfaces": {surface_id: 7}, "hatchDeg": 22})
            self.assertEqual(result["surfaces"], {key: 7 if key == surface_id else 0 for key in SURFACE_IDS})
            self.assertEqual(result["hatchDeg"], 22)
        pairs = [("L_Inboard", 0), ("inboard_L", 4), ("inboard", 10), ("outboard_R", -3), ("tail", 6)]
        expected = dict(zip(SURFACE_IDS, [0, 10, 0, -3, 6, 6]))
        for items in (pairs, list(reversed(pairs))):
            result = apply_patch(initial_state(), {"surfaces": dict(items)})
            self.assertEqual(result["surfaces"], expected)
            updated = apply_patch(result, {"surfaces": {"tail_L": 0}})
            self.assertEqual(updated["surfaces"], {**expected, "Tail_L": 0})
            self.assertEqual(result["surfaces"], expected)

    def test_invalid_shadowed_group_or_leaf_rejects_whole_patch(self):
        for invalid in (None, True, "5", float("nan"), float("inf"), -float("inf"), -12.01, 12.01):
            state = apply_patch(initial_state(), {"surfaces": {"L_Inboard": 2, "Tail_R": -3}, "hatchDeg": 22})
            before = copy.deepcopy(state)
            for patch in ({"inboard": invalid, "L_Inboard": 1, "R_Inboard": 2}, {"L_Inboard": 8, "Tail_R": invalid}):
                with self.subTest(invalid=invalid, patch=patch), self.assertRaises(ProtocolError):
                    apply_patch(state, {"wingTilt": 1, "surfaces": patch})
                self.assertEqual(state, before)

    def test_recording_surface_helpers_seek_and_reset(self):
        record = Recording().set_surfaces(inboard=8, inboard_L=0, tail_R=-5).set_surface("L_Outboard", 3)
        expected = dict(zip(SURFACE_IDS, [0, 8, 3, 0, 0, -5]))
        self.assertEqual(record.state["surfaces"], expected)
        record.step(.1).seek(.05, {"surfaces": {"tail_L": 4}})
        self.assertEqual(record.state["surfaces"], {**expected, "Tail_L": 4})
        record.reset()
        self.assertEqual(record.state["surfaces"], initial_state()["surfaces"])
        validate_recording(record.as_dict())

    def test_clock_seek_pause_reset(self):
        state = initial_state("external")
        state, dt = apply_command(state, "step", {"dt": 60})
        self.assertEqual(dt, 60)
        self.assertTrue(state["time"]["paused"])
        self.assertEqual(state["time"]["seconds"], 60)
        state, _ = apply_command(state, "seek", {"seconds": 86400, "state": {"wingTilt": 1}})
        self.assertEqual(state["time"]["seconds"], 86400)
        for op, payload in [("step", {"dt": .1}), ("step", {"dt": 60.1}), ("seek", {"seconds": -1}), ("seek", {"seconds": 86401}), ("seek", {"seconds": True})]:
            with self.subTest(op=op, payload=payload), self.assertRaises(ProtocolError):
                apply_command(state, op, payload)
        state, _ = apply_command(state, "pause", {"paused": False})
        self.assertFalse(state["time"]["paused"])
        state, _ = apply_command(state, "reset", {})
        self.assertEqual(state, initial_state("external"))

    def test_recording_is_deterministic_and_validated(self):
        record = Recording().reset().set_state(positionM=[1, 2, 3], wingTilt=.5).step(.02).step(.03)
        with tempfile.TemporaryDirectory() as directory:
            path = record.save(Path(directory) / "test.json")
            self.assertTrue(path.is_file())
        self.assertEqual(record.state["time"]["seconds"], .05)
        validate_recording(record.as_dict())
        for bad in [{"protocol": "v0", "commands": []}, {"protocol": PROTOCOL, "commands": [{"op": "reset"}]}, {"protocol": PROTOCOL, "commands": [{"op": "step", "payload": {"dt": -1}}]}]:
            with self.assertRaises(ProtocolError):
                validate_recording(bad)

    def test_snapshot_conversion(self):
        snapshot = {"state": initial_state("external")}
        patch = snapshot_to_patch(snapshot)
        self.assertNotIn("owner", patch)
        self.assertNotIn("seconds", patch["time"])
        self.assertIn("seconds", snapshot["state"]["time"])
        apply_patch(initial_state(), patch)


if __name__ == "__main__":
    unittest.main()
