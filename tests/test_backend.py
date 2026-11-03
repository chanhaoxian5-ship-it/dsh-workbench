import http.client
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from workbench.contracts import Problem
from workbench.server import Server
from workbench.store import Store

TEMP_ROOT = Path(__file__).resolve().parents[1] / "experiments/20261030-backend-v0/unit-temp"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)


def sample(record_id="test-001", delivery_key="delivery-001"):
    return {"schema_version": 1, "delivery_key": delivery_key, "discovery": {
        "record_id": record_id, "title": "隔离测试发现", "excerpt": "测试摘录，不代表真实文献。",
        "interpretation": "测试解释，尚未人工审阅。", "generated_at": "2026-10-30T08:00:00+08:00",
        "is_test": True,
        "source": {"type": "zotero_pdf", "parent_key": "TESTP001", "attachment_key": "TESTA001",
                   "sha256": "a" * 64, "pdf_page": 2, "printed_page": None, "local_path": "D:\\Workbench-test-nonexistent\\paper.pdf"},
        "producer": {"harness": "dsh", "profile": "test", "working_directory": "D:\\Workbench-test",
                     "run_id": "test-run", "production_session_id": "child-test", "main_session_id": "main-test"},
        "verification": {"mechanical": {"status": "pass", "scope": "producer-declared test only", "evidence": None},
                         "semantic": {"status": "not_reviewed", "reviewed_by": None, "evidence": None}},
    }}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=TEMP_ROOT)
        self.path = Path(self.tmp.name) / "store.sqlite3"
        self.store = Store(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def count(self):
        return len(self.store.list(include_test=True)["items"])

    def test_publish_reopen_and_receipt(self):
        code, receipt = self.store.publish(sample())
        self.assertEqual(code, 201)
        self.assertTrue(receipt["persistence"]["receipt"])
        reopened = Store(self.path)
        self.assertEqual(reopened.receipt(receipt["receipt_id"]), receipt)
        self.assertEqual(reopened.delivery("delivery-001"), receipt)
        detail = reopened.detail("test-001")
        self.assertEqual(detail["session_locator"]["main_session_id"], "main-test")
        self.assertEqual(detail["producer"]["production_session_id"], "child-test")
        self.assertEqual(detail["source_locator"]["status"], "missing" if os.name == "nt" else "not_checked_on_this_platform")
        self.assertEqual(detail["source"]["sha256"], "a" * 64)

    def test_restart_in_separate_process(self):
        _, receipt = self.store.publish(sample())
        code = "from workbench.store import Store; import sys,json; s=Store(sys.argv[1]); print(json.dumps([s.receipt(sys.argv[2]), s.list(include_test=True), s.detail('test-001')]))"
        result = subprocess.run([sys.executable, "-c", code, str(self.path), receipt["receipt_id"]], capture_output=True, text=True, check=True)
        saved, listing, detail = json.loads(result.stdout)
        self.assertEqual(saved, receipt)
        self.assertEqual(len(listing["items"]), 1)
        self.assertEqual(detail["record_id"], "test-001")

    def test_duplicate_and_different_delivery(self):
        self.store.publish(sample())
        for key in ("delivery-001", "delivery-002"):
            code, receipt = self.store.publish(sample(delivery_key=key))
            self.assertEqual((code, receipt["status"]), (200, "duplicate"))
            self.assertEqual(self.store.receipt(receipt["receipt_id"]), receipt)
        self.assertEqual(self.count(), 1)

    def test_concurrent_same_delivery(self):
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda _: self.store.publish(sample()), range(24)))
        self.assertEqual(sum(code == 201 for code, _ in results), 1)
        self.assertEqual(sum(code == 200 for code, _ in results), 23)
        self.assertEqual(self.count(), 1)
        for _, receipt in results:
            self.assertEqual(self.store.receipt(receipt["receipt_id"]), receipt)

    def test_concurrent_process_delivery(self):
        payload = json.dumps(sample(), ensure_ascii=True)
        code = "from workbench.store import Store; import sys,json; s=Store(sys.argv[1]); print(json.dumps(s.publish(json.loads(sys.argv[2]))))"
        # Schema exists before starting independent processes; each has its own connection.
        processes = [subprocess.Popen([sys.executable, "-c", code, str(self.path), payload], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        results = []
        for process in processes:
            out, err = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, err)
            results.append(json.loads(out))
        self.assertEqual(sorted(r[0] for r in results), [200] * 5 + [201])
        self.assertEqual(self.count(), 1)

    def test_delivery_and_record_conflict_with_sha_change(self):
        self.store.publish(sample())
        changed = sample()
        changed["discovery"]["source"]["sha256"] = "b" * 64
        code, receipt = self.store.publish(changed)
        self.assertEqual((code, receipt["error"]["code"]), (409, "delivery_conflict"))
        changed["delivery_key"] = "new-delivery"
        self.assertEqual(self.store.publish(changed)[1]["error"]["code"], "record_conflict")
        changed["discovery"]["record_id"] = "test-002"
        self.assertEqual(self.store.publish(changed)[0], 201)
        self.assertEqual(self.count(), 2)

    def revision(self, record_id="test-002", target="test-001"):
        value = sample(record_id, "delivery-" + record_id)
        value["discovery"]["revision_of"] = target
        value["discovery"]["source"]["sha256"] = "b" * 64
        value["discovery"]["interpretation"] = "修订后的测试解释"
        return value

    def test_revision_history_and_conflicts(self):
        self.assertEqual(self.store.publish(self.revision())[1]["error"]["code"], "revision_not_found")
        self.store.publish(sample())
        incompatible = self.revision()
        incompatible["discovery"]["producer"]["main_session_id"] = "another-main"
        self.assertEqual(self.store.publish(incompatible)[1]["error"]["code"], "incompatible_revision")
        for field, val in (("attachment_key", "ANOTHER"), ("type", "local_pdf")):
            incompatible = self.revision()
            incompatible["discovery"]["source"][field] = val
            self.assertEqual(self.store.publish(incompatible)[0], 409)
        self.assertEqual(self.store.publish(self.revision())[0], 201)
        self.assertEqual(self.store.publish(self.revision())[0], 200)
        self.assertEqual(self.store.publish(self.revision("test-003"))[1]["error"]["code"], "revision_conflict")
        self.assertEqual(self.store.publish(self.revision("test-003", "test-002"))[0], 201)
        detail = self.store.detail("test-002")
        self.assertEqual(detail["root_id"], "test-001")
        self.assertEqual(detail["superseded_by"], "test-003")
        self.assertEqual(detail["revision_history"], ["test-001", "test-002", "test-003"])

    def test_concurrent_revision_branch(self):
        self.store.publish(sample())
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.store.publish, [self.revision("test-002"), self.revision("test-003")]))
        self.assertEqual(sorted(code for code, _ in results), [201, 409])
        self.assertEqual(self.count(), 2)

    def test_before_commit_failure_rolls_back_and_retries(self):
        def fail(stage):
            if stage == "before_commit":
                raise sqlite3.OperationalError("injected commit failure")
        broken = Store(self.path, fault=fail)
        code, receipt = broken.publish(sample())
        self.assertEqual((code, receipt["status"]), (503, "failed"))
        self.assertTrue(receipt["error"]["retryable"])
        self.assertEqual(self.store.receipt(receipt["receipt_id"]), receipt)
        self.assertEqual(self.count(), 0)
        self.assertIsNone(self.store.delivery("delivery-001"))
        self.assertEqual(self.store.publish(sample())[0], 201)

    def test_lost_response_after_commit(self):
        class LostResponse(Exception):
            pass
        def fail(stage):
            if stage == "after_commit":
                raise LostResponse()
        with self.assertRaises(LostResponse):
            Store(self.path, fault=fail).publish(sample())
        self.assertEqual(self.store.delivery("delivery-001")["status"], "accepted")
        self.assertEqual(self.store.publish(sample())[1]["status"], "duplicate")
        self.assertEqual(self.count(), 1)

    def test_hard_process_crash_at_commit_boundary(self):
        for stage in ("before_commit", "after_commit"):
            with self.subTest(stage=stage):
                value = sample(stage, stage)
                code = "from workbench.store import Store; import os,sys,json; s=Store(sys.argv[1],fault=lambda stage: os._exit(73) if stage==sys.argv[3] else None); s.publish(json.loads(sys.argv[2]))"
                result = subprocess.run([sys.executable, "-c", code, str(self.path), json.dumps(value), stage], capture_output=True)
                self.assertEqual(result.returncode, 73)
                reopened = Store(self.path)
                self.assertEqual(reopened.detail(stage) is not None, stage == "after_commit")
                self.assertEqual(reopened.delivery(stage) is not None, stage == "after_commit")
                status, receipt = reopened.publish(value)
                self.assertEqual(status, 201 if stage == "before_commit" else 200)
                self.assertTrue(receipt["persistence"]["discovery"])

    def test_storage_unavailable_no_fake_receipt(self):
        with closing(sqlite3.connect(self.path, isolation_level=None)) as conn:
            conn.execute("BEGIN EXCLUSIVE")
            # Exercise an unavailable store without two 5-second busy waits.
            class Unavailable(Store):
                def connect(self):
                    raise sqlite3.OperationalError("unavailable")
            unavailable = object.__new__(Unavailable)
            unavailable.path, unavailable.fault = self.path, None
            code, receipt = unavailable.publish(sample())
            self.assertEqual(code, 503)
            self.assertIsNone(receipt["receipt_id"])
            self.assertFalse(receipt["persistence"]["receipt"])
            self.assertEqual(self.count(), 0)
            conn.rollback()

    def test_no_producer_claim_authenticates_reviewer(self):
        for status in ("not_reviewed", "rejected", "confirmed"):
            value = sample(status, status)
            value["discovery"]["verification"]["semantic"].update(status=status, reviewed_by="claimed-human")
            self.store.publish(value)
            detail = self.store.detail(status)
            self.assertFalse(detail["backend_verification"]["verified"])
            self.assertFalse(detail["backend_verification"]["reviewer_authenticated"])
            self.assertEqual(detail["backend_verification"]["semantic"], "not_reviewed")
            self.assertEqual(detail["verification"]["semantic"]["status"], status)

    def test_validation_and_unknowns(self):
        mutations = [
            lambda d: d.update(is_test="false"),
            lambda d: d.update(generated_at="2026-10-30"),
            lambda d: d.update(record_id="../../escape"),
            lambda d: d.update(excerpt="x" * 16001),
            lambda d: d.update(title="\ud800"),
            lambda d: d["source"].update(sha256="abcd"),
            lambda d: d["source"].update(pdf_page=True),
            lambda d: d["source"].update(local_path="D:\\a\\..\\b.pdf"),
            lambda d: d["source"].update(local_path="\\\\server\\share\\paper.pdf"),
            lambda d: d["source"].update(local_path="D:\\paper.pdf:stream"),
            lambda d: d["source"].update(local_path="D:\\NUL.pdf"),
            lambda d: d["source"].update(local_path="D:\\bad\npath.pdf"),
            lambda d: d["producer"].update(main_session_id=None),
            lambda d: d["verification"].update(authenticated=True),
        ]
        for mutate in mutations:
            value = sample()
            mutate(value["discovery"])
            self.assertEqual(self.store.publish(value)[0], 422)
        value = sample()
        value["discovery"]["source"] = {"type": "unknown"}
        self.assertEqual(self.store.publish(value)[0], 201)
        self.assertEqual(self.store.detail("test-001")["source_locator"]["status"], "not_provided")

    def test_test_samples_excluded_and_cursor_stable(self):
        for index in range(6):
            self.store.publish(sample(f"record-{index}", f"delivery-{index}"))
        self.assertEqual(self.store.list()["items"], [])
        first = self.store.list(include_test=True, limit=2)
        self.store.publish(sample("newer", "newer"))
        second = self.store.list(include_test=True, limit=2, before=first["next_before"])
        third = self.store.list(include_test=True, limit=2, before=second["next_before"])
        ids = [d["record_id"] for page in (first, second, third) for d in page["items"]]
        self.assertEqual(ids, [f"record-{i}" for i in reversed(range(6))])
        self.assertIsNone(third["next_before"])

    def test_time_boundaries_and_same_timestamp_sort(self):
        for index, received in enumerate(("2026-10-29T15:59:59.999999+00:00", "2026-10-29T16:00:00.000000+00:00", "2026-10-30T15:59:59.999999+00:00", "2026-10-30T16:00:00.000000+00:00")):
            self.store.publish(sample(f"record-{index}", f"delivery-{index}"))
            with closing(sqlite3.connect(self.path)) as conn:
                conn.execute("UPDATE discoveries SET received_at=? WHERE record_id=?", (received, f"record-{index}"))
                conn.commit()
        home = self.store.home(include_test=True, at=datetime(2026, 10, 30, 4, tzinfo=timezone.utc))
        self.assertEqual(home["date"], "2026-10-30")
        self.assertEqual(home["important_changes"], [])
        self.assertEqual([d["record_id"] for d in home["today_discoveries"]["items"]], ["record-2", "record-1"])
        self.assertEqual(self.store.home(at=datetime(2026, 10, 30, 4, tzinfo=timezone.utc))["today_discoveries"]["items"], [])
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("UPDATE discoveries SET received_at='2026-10-30T00:00:00.000000+00:00'")
            conn.commit()
        self.assertEqual([d["record_id"] for d in self.store.list(include_test=True)["items"]], [f"record-{i}" for i in (3, 2, 1, 0)])
        for kwargs in ({"limit": 0}, {"before": -1}, {"since": "2026-10-31T00:00:00Z", "until": "2026-10-30T00:00:00Z"}):
            with self.assertRaises(Problem):
                self.store.list(**kwargs)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=TEMP_ROOT)
        self.store = Store(Path(self.tmp.name) / "http.sqlite3")
        self.token = "t" * 40
        self.server = Server(("127.0.0.1", 0), self.store, self.token, "http://127.0.0.1:5173")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        h = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
        h.update(headers or {})
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=15)
        try:
            conn.request(method, path, body=body, headers=h)
            response = conn.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            conn.close()

    def publish(self):
        return self.request("POST", "/v1/discoveries", json.dumps(sample()).encode())

    def test_http_end_to_end(self):
        code, receipt, _ = self.publish()
        self.assertEqual(code, 201)
        self.assertEqual(self.request("GET", "/v1/receipts/" + receipt["receipt_id"])[1], receipt)
        self.assertEqual(self.request("GET", "/v1/deliveries/delivery-001")[1], receipt)
        self.assertEqual(self.request("GET", "/v1/discoveries/test-001")[1]["record_id"], "test-001")
        self.assertEqual(self.request("GET", "/v1/discoveries")[1]["items"], [])
        self.assertEqual(len(self.request("GET", "/v1/discoveries?include_test=true&limit=1")[1]["items"]), 1)
        self.assertEqual(self.request("GET", "/v1/home")[1]["timezone"], "Asia/Shanghai")
        self.assertEqual(self.request("GET", "/v1/health")[0], 200)
        self.assertEqual(self.request("GET", "/v1/discoveries/absent")[0], 404)

    def test_http_protection_and_bad_requests(self):
        for method, route, body, headers, expected in (
            ("GET", "/v1/home", None, {"Authorization": ""}, 401),
            ("GET", "/v1/home", None, {"Origin": "https://evil.example"}, 403),
            ("GET", "/v1/home", None, {"Host": "evil.example"}, 403),
            ("GET", "/v1/discoveries?limit=0", None, {}, 400),
            ("GET", "/v1/discoveries?limit=2&limit=3", None, {}, 400),
            ("GET", "/v1/discoveries?include_test=yes", None, {}, 400),
            ("GET", "/v1/home?unknown=1", None, {}, 400),
            ("POST", "/v1/discoveries", b"{", {}, 400),
            ("POST", "/v1/discoveries", b'{"schema_version":1,"schema_version":1}', {}, 400),
            ("POST", "/v1/discoveries", b'{"x":NaN}', {}, 400),
            ("POST", "/v1/discoveries", b"x" * 131073, {}, 413),
            ("POST", "/v1/discoveries", b"{}", {"Content-Type": "text/plain"}, 415),
        ):
            with self.subTest(route=route, headers=headers, expected=expected):
                self.assertEqual(self.request(method, route, body, headers)[0], expected)
        code, _, headers = self.request("OPTIONS", "/v1/discoveries", headers={"Origin": "http://127.0.0.1:5173", "Authorization": ""})
        self.assertEqual(code, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173")
        code, _, headers = self.request("GET", "/v1/home", headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(code, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_http_response_loss_recovery(self):
        # Drop a real TCP response after server commit, then recover through HTTP.
        committed = threading.Event()
        def signal(stage):
            if stage == "after_commit":
                committed.set()
        self.store.fault = signal
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request("POST", "/v1/discoveries", json.dumps(sample()).encode(),
                     {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        self.assertTrue(committed.wait(5))
        conn.close()
        self.assertEqual(self.request("GET", "/v1/deliveries/delivery-001")[1]["status"], "accepted")
        self.assertEqual(self.publish()[1]["status"], "duplicate")
        self.assertEqual(len(self.store.list(include_test=True)["items"]), 1)

    def test_public_frontend_and_protected_data(self):
        for path, expected_type in (("/", "text/html"), ("/app.css", "text/css"), ("/app.js", "text/javascript"), ("/catalog.js", "text/javascript"), ("/experience.js", "text/javascript"), ("/icons/icons.js", "text/javascript"), ("/landscape.svg", "image/svg+xml"), ("/icons/sprite.svg", "image/svg+xml"), ("/?preview=1", "text/html")):
            conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
            try:
                conn.request("GET", path)
                response = conn.getresponse()
                body = response.read().decode("utf-8")
                self.assertEqual(response.status, 200)
                self.assertIn(expected_type, response.getheader("Content-Type"))
                self.assertIn("frame-ancestors 'none'", response.getheader("Content-Security-Policy"))
                self.assertNotIn(self.token, body)
            finally:
                conn.close()
        origin = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(self.request("GET", "/v1/home", headers={"Origin": origin})[0], 200)
        for path in ("/v1/home", "/api-token.txt", "/../store.sqlite3", "/web/index.html", "/app.js?other=1"):
            self.assertEqual(self.request("GET", path, headers={"Authorization": ""})[0], 401)


if __name__ == "__main__":
    unittest.main()
