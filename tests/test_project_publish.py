import http.client
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import test_backend as backend
from test_projects import artifact, workspace
from workbench.project_publish import ProjectPublisher
from workbench.publish import DeliveryError
from workbench.server import Handler


class ProjectPublisherTests(unittest.TestCase):
    setUp = backend.HttpTests.setUp
    tearDown = backend.HttpTests.tearDown

    def client(self):
        return ProjectPublisher(self.server.server_port, self.token, timeout=2)

    def body(self, value):
        return json.dumps(value, ensure_ascii=False).encode('utf-8')

    def test_register_item_and_refresh_durable_readback(self):
        client = self.client()
        root = Path(self.tmp.name) / "project"
        root.mkdir()
        result = client.publish_project("workspaces", None, self.body(workspace(root)))
        self.assertTrue(result["readback_confirmed"])
        self.assertTrue(client.publish_project("artifacts", "project-1", self.body(artifact()))["readback_confirmed"])
        refresh = {"schema_version": 1, "operation_key": "refresh", "expected_version": 1, "filenames": ["README.md"]}
        self.assertTrue(client.publish_project("refresh", "project-1", self.body(refresh))["readback_confirmed"])

    def test_real_response_loss_recovers_without_duplicate_and_rejects_key_reuse(self):
        client = self.client()
        value = workspace(Path(self.tmp.name))
        original = Handler.send_json
        def drop(handler, status, body):
            if handler.command == "POST" and status == 201:
                handler.close_connection = True
                return
            return original(handler, status, body)
        with patch.object(Handler, "send_json", drop):
            self.assertTrue(client.publish_project("workspaces", None, self.body(value))["readback_confirmed"])
        self.assertEqual(len(self.store.projects.list_workspaces(include_test=True)["items"]), 1)
        value["workspace"]["name"] = "不同内容"
        with self.assertRaises(DeliveryError) as error:
            client.publish_project("workspaces", None, self.body(value))
        self.assertEqual(error.exception.code, "operation_conflict")

    def test_recovery_digest_mismatch_is_not_success(self):
        client = self.client()
        value = workspace(Path(self.tmp.name))
        client.publish_project("workspaces", None, self.body(value))
        request = client.request
        def lost(method, path, body=None):
            if method == "POST":
                raise DeliveryError("transport_error", True)
            return request(method, path, body)
        value["workspace"]["name"] = "不同内容"
        with patch.object(client, "request", lost):
            with self.assertRaises(DeliveryError) as error:
                client.publish_project("workspaces", None, self.body(value))
        self.assertEqual(error.exception.code, "receipt_mismatch")

    def test_powershell_project_and_maintenance_entrypoints(self):
        root = Path(__file__).resolve().parents[1]
        token_path = Path(self.tmp.name) / "api-token.txt"
        token_path.write_text(self.token, encoding="ascii")
        payload = Path(self.tmp.name) / "project.json"
        payload.write_bytes(self.body(workspace(Path(self.tmp.name))))
        result = subprocess.run(["pwsh", "-NoProfile", "-File", str(root / "scripts/publish-project.ps1"), "-Collection", "workspaces", "-Payload", str(payload), "-DataDir", self.tmp.name, "-Port", str(self.server.server_port)], capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["readback_confirmed"])
        self.assertNotIn(self.token, result.stdout+result.stderr)
        result = subprocess.run(["pwsh", "-NoProfile", "-File", str(root / "scripts/maintain-backend.ps1"), "-Action", "check", "-Source", str(self.store.path)], capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
