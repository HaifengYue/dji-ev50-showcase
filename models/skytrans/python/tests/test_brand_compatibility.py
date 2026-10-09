"""Brand aliases must retain one implementation, one lease and the existing wire contract."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

import skytrans_sim
import transwing_sim
from skytrans_sim.server import Bridge
from skytrans_sim.protocol import ProtocolError
from transwing_sim.server import Bridge as LegacyBridge


class BrandCompatibilityTests(unittest.TestCase):
    def test_import_aliases_are_identical(self):
        self.assertIs(transwing_sim.Client, skytrans_sim.Client)
        self.assertIs(transwing_sim.Recording, skytrans_sim.Recording)
        self.assertIs(LegacyBridge, Bridge)
        self.assertEqual(skytrans_sim.PROTOCOL, "transwing.sim.v1")

    def test_strict_legacy_envelopes_share_one_owner(self):
        bridge = Bridge()
        self.assertEqual(bridge.health()["protocol"], "transwing.sim.v1")
        self.assertEqual(bridge.health()["service"], "transwing-local-bridge")
        old_request = {"protocol": "transwing.sim.v1", "clientName": "original-client"}
        lease = bridge.create_session(old_request)
        self.assertEqual(lease["protocol"], "transwing.sim.v1")
        with self.assertRaises(ProtocolError) as caught:
            bridge.create_session({"protocol": skytrans_sim.PROTOCOL, "clientName": "new-client"})
        self.assertEqual(caught.exception.code, "owner_busy")
        recording = skytrans_sim.Recording().command("set", {"hatchDeg": 4})
        self.assertEqual(recording.as_dict()["protocol"], "transwing.sim.v1")

    def test_original_pythonpath_still_imports_same_sdk(self):
        root = Path(__file__).resolve().parents[4]
        result = subprocess.run(
            [sys.executable, "-c", "import json, transwing_sim, skytrans_sim; "
             "from transwing_sim.server import Bridge; "
             "print(json.dumps({'same': transwing_sim.Client is skytrans_sim.Client, "
             "'protocol': transwing_sim.PROTOCOL, 'service': Bridge().health()['service']}))"],
            cwd=root, env={**os.environ, "PYTHONPATH": str(root / "models/transwing/python")},
            text=True, capture_output=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), {
            "same": True, "protocol": "transwing.sim.v1", "service": "transwing-local-bridge",
        })


if __name__ == "__main__":
    unittest.main()
