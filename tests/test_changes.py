import json
import sqlite3
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor

import test_backend as backend
from test_backend import sample
from workbench.contracts import Problem
from workbench.store import Store


def change(key="change-delivery-1", record="test-001", version=0):
    return {"schema_version": 1, "delivery_key": key, "change_id": "change-1",
            "record_id": record, "expected_version": version, "priority": "high"}


def action(key="action-1", version=1, state_version=1, state="known"):
    return {"schema_version": 1, "action_key": key, "expected_version": version,
            "expected_state_version": state_version, "state": state}


class ChangeTests(unittest.TestCase):
    setUp = backend.HttpTests.setUp
    tearDown = backend.HttpTests.tearDown
    request = backend.HttpTests.request

    def seed(self):
        self.store.publish(sample())
        return self.store.changes.publish(change())

    def post(self, path, body, headers=None):
        return self.request("POST", path, json.dumps(body).encode(), headers)

    def test_http_create_read_receipt_home_and_default_test_exclusion(self):
        self.store.publish(sample())
        code, receipt, _ = self.post("/v1/changes", change())
        self.assertEqual(code, 201)
        self.assertEqual(receipt["persistence"], {"receipt": True, "change": True})
        self.assertEqual(self.request("GET", "/v1/receipts/" + receipt["receipt_id"])[1], receipt)
        self.assertEqual(self.request("GET", "/v1/change-deliveries/change-delivery-1")[1], receipt)
        event = self.request("GET", "/v1/changes/change-1")[1]
        self.assertEqual(len(event["history"]), 1)
        self.assertFalse(event["discovery"]["backend_verification"]["verified"])
        self.assertEqual(self.request("GET", "/v1/changes")[1]["items"], [])
        self.assertEqual(self.request("GET", "/v1/home")[1]["important_changes"], [])
        home = self.request("GET", "/v1/home?include_test=true")[1]
        self.assertEqual(home["important_changes_state"], "ready")
        self.assertEqual(len(home["important_changes"]), 1)

    def test_idempotent_delivery_returns_original_receipt_without_reopening(self):
        _, first = self.seed()
        self.store.changes.set_state("change-1", action())
        code, again = self.store.changes.publish(change())
        self.assertEqual(code, 200)
        self.assertEqual(first, again)
        self.assertEqual(self.store.changes.detail("change-1")["state"], "known")
        changed = change()
        changed["priority"] = "normal"
        with self.assertRaises(Problem) as ctx:
            self.store.changes.publish(changed)
        self.assertEqual(ctx.exception.code, "operation_conflict")

    def test_later_reopen_and_action_replay_preserve_project_facts(self):
        self.seed()
        original = self.store.detail("test-001")
        _, receipt, _ = self.post("/v1/changes/change-1/state", action(state="later"))
        self.assertEqual(receipt["state"], "later")
        self.assertEqual(self.store.changes.list(include_test=True)["items"], [])
        self.assertEqual(len(self.store.changes.list(include_test=True, state="later")["items"]), 1)
        self.store.changes.set_state("change-1", action("action-2", state_version=2, state="open"))
        self.assertEqual(self.store.changes.set_state("change-1", action(state="later"))[1], receipt)
        self.assertEqual(self.store.changes.detail("change-1")["state"], "open")
        current = self.store.detail("test-001")
        original.pop("source_locator")
        current.pop("source_locator")
        self.assertEqual(original, current)

    def test_update_reopens_once_and_stale_actions_cannot_hide_it(self):
        self.seed()
        self.store.changes.set_state("change-1", action())
        revised = sample("test-002", "delivery-002")
        revised["discovery"]["revision_of"] = "test-001"
        self.store.publish(revised)
        self.store.changes.publish(change("change-delivery-2", "test-002", 1))
        event = self.store.changes.detail("change-1")
        self.assertEqual((event["version"], event["state_version"], event["state"]), (2, 3, "open"))
        self.assertEqual([h["record_id"] for h in event["history"]], ["test-001", "test-002"])
        with self.assertRaises(Problem):
            self.store.changes.set_state("change-1", action("stale", state_version=2))
        self.store.changes.set_state("change-1", action("new", 2, 3))
        self.store.changes.publish(change("same-content", "test-002", 2))
        self.assertEqual(self.store.changes.detail("change-1")["state"], "known")
        with self.assertRaises(Problem) as ctx:
            self.store.changes.publish(change("older", "test-001", 2))
        self.assertEqual(ctx.exception.code, "stale_evidence")

    def test_state_concurrency_conflict_and_key_conflict(self):
        self.seed()
        def run(state):
            try:
                return self.store.changes.set_state("change-1", action(state, state=state))[0]
            except Problem as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, ["known", "later"]))
        self.assertEqual(results.count(200), 1)
        self.assertEqual(results.count("state_conflict"), 1)
        event = self.store.changes.detail("change-1")
        with self.assertRaises(Problem) as ctx:
            self.store.changes.set_state("change-1", action(event["state"], state="open"))
        self.assertEqual(ctx.exception.code, "operation_conflict")

    def test_concurrent_publish_only_one_version_and_receipt(self):
        self.store.publish(sample())
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.store.changes.publish(change()), range(16)))
        self.assertEqual(sum(code == 201 for code, _ in results), 1)
        self.assertEqual(len({r["receipt_id"] for _, r in results}), 1)
        self.assertEqual(len(self.store.changes.detail("change-1")["history"]), 1)

    def test_evidence_required_and_revision_chain_restricted(self):
        with self.assertRaises(Problem) as ctx:
            self.store.changes.publish(change())
        self.assertEqual(ctx.exception.code, "evidence_not_found")
        self.seed()
        self.store.publish(sample("other", "other"))
        with self.assertRaises(Problem) as ctx:
            self.store.changes.publish(change("other-update", "other", 1))
        self.assertEqual(ctx.exception.code, "incompatible_change")

    def test_rollback_and_lost_response_replay(self):
        self.store.publish(sample())
        def fault(stage):
            if stage == "before_change_commit":
                raise sqlite3.OperationalError("injected")
        self.store.fault = fault
        self.assertEqual(self.post("/v1/changes", change())[0], 503)
        self.assertIsNone(self.store.changes.detail("change-1"))
        self.assertIsNone(self.store.changes.delivery("change-delivery-1"))
        self.store.fault = None
        # Lose the application response after commit, then recover from durable state.
        def lost(stage):
            if stage == "after_change_commit":
                raise sqlite3.OperationalError("response lost")
        self.store.fault = lost
        self.assertEqual(self.post("/v1/changes", change())[0], 503)
        self.store.fault = None
        recovered = self.store.changes.delivery("change-delivery-1")
        self.assertEqual(recovered["version"], 1)
        self.assertEqual(self.store.changes.publish(change())[1], recovered)

    def test_upgrade_v1_preserves_discovery_and_restart_preserves_state(self):
        self.store.publish(sample())
        with closing(self.store.connect()) as conn:
            conn.executescript("DROP TABLE change_operations; DROP TABLE change_versions; DROP TABLE changes; PRAGMA user_version=1;")
        reopened = Store(self.store.path)
        self.assertEqual(reopened.detail("test-001")["record_id"], "test-001")
        reopened.changes.publish(change())
        reopened.changes.set_state("change-1", action())
        restarted = Store(self.store.path)
        self.assertEqual(restarted.changes.detail("change-1")["state"], "known")
        self.assertEqual(restarted.changes.list(include_test=True)["items"], [])
        with closing(restarted.connect()) as conn:
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 3)
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_pagination_and_history_do_not_duplicate_events(self):
        self.store.publish(sample())
        for index in range(3):
            value = change(str(index))
            value["change_id"] = "change-" + str(index)
            self.store.changes.publish(value)
        first = self.store.changes.list(include_test=True, limit=2)
        second = self.store.changes.list(include_test=True, limit=2, before=first["next_before"])
        self.assertEqual(len(first["items"]) + len(second["items"]), 3)
        self.assertFalse({e["change_id"] for e in first["items"]} & {e["change_id"] for e in second["items"]})

    def test_http_validation_and_authentication(self):
        for method, path, body, headers, code in (
            ("POST", "/v1/changes", b"{}", {"Authorization": ""}, 401),
            ("POST", "/v1/changes", b"{}", {"Origin": "https://evil.example"}, 403),
            ("POST", "/v1/changes", b"{}", {}, 422),
            ("POST", "/v1/changes", b"{", {}, 400),
            ("GET", "/v1/changes?state=invalid", None, {}, 400),
            ("GET", "/v1/changes?include_test=true&include_test=false", None, {}, 400),
            ("GET", "/v1/changes?limit=101", None, {}, 400),
            ("GET", "/v1/changes?since=now", None, {}, 400),
            ("GET", "/v1/changes/missing", None, {}, 404),
            ("POST", "/v1/changes/missing/state", json.dumps(action()).encode(), {}, 404),
        ):
            with self.subTest(path=path, code=code):
                self.assertEqual(self.request(method, path, body, headers)[0], code)


if __name__ == "__main__":
    unittest.main()
