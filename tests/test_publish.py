import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from workbench.publish import DeliveryError, Publisher
from workbench.server import Handler, Server
from workbench.store import Store
from test_backend import sample


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.token = "t" * 40
        (self.data / "api-token.txt").write_text(self.token, encoding="ascii")
        self.store = Store(self.data / "workbench.sqlite3")
        self.server = Server(("127.0.0.1", 0), self.store, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = Publisher(self.server.server_port, self.token, timeout=2)
        self.body = json.dumps(sample(), ensure_ascii=False).encode("utf-8")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def test_accept_duplicate_and_readback(self):
        first = self.client.publish(self.body)
        self.assertEqual(first["status"], "accepted")
        self.assertTrue(first["readback_confirmed"])
        self.assertFalse(first["verified"])
        self.assertEqual(self.client.publish(self.body)["status"], "duplicate")
        self.assertEqual(len(self.store.list(include_test=True)["items"]), 1)
        self.assertEqual(self.store.list()["items"], [])

    def test_real_lost_http_response_recovers_committed_key(self):
        original = Handler.send_json
        def drop(handler, status, value):
            if handler.command == "POST" and status == 201:
                handler.close_connection = True
                return  # Close the real TCP socket without sending a response.
            return original(handler, status, value)
        with patch.object(Handler, "send_json", drop):
            result = self.client.publish(self.body)
        self.assertTrue(result["recovered_by_delivery_key"])
        self.assertTrue(result["readback_confirmed"])
        self.assertEqual(len(self.store.list(include_test=True)["items"]), 1)

    def test_retry_before_commit_uses_identical_bytes(self):
        request = self.client.request
        posted = []
        def transient(method, path, body=None):
            if method == "POST":
                posted.append(body)
                if len(posted) == 1:
                    raise DeliveryError("transport_error", True)
            return request(method, path, body)
        with patch.object(self.client, "request", transient):
            self.assertEqual(self.client.publish(self.body)["status"], "accepted")
        self.assertEqual(posted, [self.body, self.body])

    def test_conflict_does_not_retry_or_claim_success(self):
        self.client.publish(self.body)
        changed = sample()
        changed["discovery"]["source"]["sha256"] = "b" * 64
        with patch.object(self.client, "request", wraps=self.client.request) as request:
            with self.assertRaises(DeliveryError) as ctx:
                self.client.publish(json.dumps(changed).encode())
            self.assertEqual(ctx.exception.code, "delivery_conflict")
            self.assertEqual(request.call_count, 1)

    def test_recovery_checks_digest_even_when_key_exists(self):
        self.client.publish(self.body)
        request = self.client.request
        def lost(method, path, body=None):
            if method == "POST":
                raise DeliveryError("transport_error", True)
            return request(method, path, body)
        changed = sample()
        changed["discovery"]["interpretation"] = "不同解释"
        with patch.object(self.client, "request", lost):
            with self.assertRaises(DeliveryError) as ctx:
                self.client.publish(json.dumps(changed).encode())
        self.assertEqual(ctx.exception.code, "receipt_mismatch")

    def test_auth_failure_is_not_retried(self):
        client = Publisher(self.server.server_port, "x" * 40)
        with patch.object(client, "request", wraps=client.request) as request:
            with self.assertRaises(DeliveryError) as ctx:
                client.publish(self.body)
        self.assertEqual(ctx.exception.code, "unauthorized")
        self.assertEqual(request.call_count, 1)

    def test_bounded_failure_and_readback_required(self):
        self.client.attempts = 2
        with patch.object(self.client, "request", side_effect=DeliveryError("transport_error", True)) as request:
            with self.assertRaises(DeliveryError):
                self.client.publish(self.body)
        self.assertEqual(request.call_count, 4)  # Two POSTs and two key lookups.
        request = self.client.request
        def unreadable(method, path, body=None):
            if path.startswith("/v1/receipts/"):
                raise DeliveryError("transport_error", True)
            return request(method, path, body)
        with patch.object(self.client, "request", unreadable):
            with self.assertRaises(DeliveryError):
                self.client.publish(self.body)
        self.assertEqual(len(self.store.list(include_test=True)["items"]), 1)

    def test_powershell_entrypoint_and_local_validation(self):
        root = Path(__file__).resolve().parents[1]
        payload = self.data / "payload.json"
        payload.write_bytes(self.body)
        command = ["pwsh", "-NoProfile", "-File", str(root / "scripts/publish-discovery.ps1"),
                   "-Payload", str(payload), "-DataDir", str(self.data), "-Port", str(self.server.server_port)]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["readback_confirmed"])
        self.assertNotIn(self.token, result.stdout + result.stderr)
        payload.write_bytes(b'{"schema_version":1,"schema_version":1}')
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["status"], "local_error")


if __name__ == "__main__":
    unittest.main()
