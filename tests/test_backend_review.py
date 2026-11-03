"""Regression cases reproduced during the 2026-11-03 backend review."""
import copy
import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import test_backend as backend
import test_projects as project_tests
from test_projects import artifact, item, manuscript, ref, workspace
from workbench.contracts import Problem, canonical
from workbench.maintenance import backup, check, restore
from workbench.project_publish import ProjectPublisher
from workbench.publish import DeliveryError, Publisher
from workbench.server import parse_json


class ReviewStoreTests(unittest.TestCase):
    setUp = project_tests.ProjectStoreTests.setUp
    tearDown = project_tests.ProjectStoreTests.tearDown

    def test_version_rejects_repeated_file_identity_even_with_different_revisions(self):
        self.p.save_item("project-1", artifact())
        updated = artifact()
        updated.update(operation_key="file-update", expected_version=1)
        updated["item"]["title"] = "New registration"
        self.p.save_item("project-1", updated)
        for revisions in ((1, 1), (1, 2)):
            value = manuscript()
            value["operation_key"] = f"ambiguous-{revisions[0]}-{revisions[1]}"
            value["item"]["data"]["refs"] = [ref("artifact-1", "artifact", "artifact", rev) for rev in revisions]
            with self.subTest(revisions=revisions):
                with self.assertRaises(Problem) as error:
                    self.p.save_item("project-1", value)
                self.assertEqual(error.exception.code, "ambiguous_artifact_reference")
                self.assertIsNone(self.p.operation(value["operation_key"]))

    def test_legacy_ambiguous_version_comparison_does_not_silently_discard_reference(self):
        self.p.save_item("project-1", artifact())
        self.p.save_item("project-1", manuscript())
        updated = artifact()
        updated.update(operation_key="file-update", expected_version=1)
        updated["item"]["title"] = "New registration"
        self.p.save_item("project-1", updated)
        self.p.save_item("project-1", manuscript("version-2"))
        # Reproduce the historical shape that the old API accepted, links intact.
        with closing(self.store.connect()) as conn:
            body = json.loads(conn.execute("SELECT body FROM project_item_revisions WHERE item_id='version-1'").fetchone()[0])
            body["data"]["refs"].append(ref("artifact-1", "artifact", "artifact", 2))
            conn.execute("UPDATE project_item_revisions SET body=? WHERE item_id='version-1'", (canonical(body),))
            conn.execute("INSERT INTO project_item_links VALUES(?,?,?,?,?,?)", ("project-1", "version-1", 1, "artifact-1", 2, "artifact"))
        with self.assertRaises(Problem) as error:
            self.p.compare_versions("project-1", "version-1", "version-2")
        self.assertEqual(error.exception.code, "ambiguous_artifact_reference")
        self.assertEqual(len(self.p.item("project-1", "version-1")["data"]["refs"]), 2)

    def test_canvas_may_repeat_same_reference_in_distinct_nodes(self):
        self.p.save_item("project-1", artifact())
        self.p.save_item("project-1", item("canvas-repeat", "canvas", {
            "zoom": 1, "layer": "formal", "edges": [], "nodes": [
                {"id": f"node-{n}", "x": n*10, "y": 0, "label": "same evidence", "ref": ref("artifact-1", "artifact", "context")}
                for n in range(2)]}))
        self.assertEqual(len(self.p.item("project-1", "canvas-repeat")["data"]["nodes"]), 2)

    def test_unrelated_sqlite_is_not_a_workbench_backup(self):
        unrelated = Path(self.tmp.name) / "unrelated.sqlite3"
        with closing(sqlite3.connect(unrelated)) as conn:
            conn.execute("CREATE TABLE another_app (id INTEGER)")
            conn.execute("PRAGMA user_version=3")
            conn.commit()
        self.assertFalse(check(unrelated)["ok"])
        restored = Path(self.tmp.name) / "wrong-restore"
        with self.assertRaises(ValueError):
            restore(unrelated, restored)
        self.assertFalse(restored.exists())
        destination = Path(self.tmp.name) / "wrong-backup.sqlite3"
        with self.assertRaises(ValueError):
            backup(unrelated, destination)
        self.assertFalse(destination.exists())

    def test_missing_required_column_is_not_reported_healthy(self):
        with closing(self.store.connect()) as conn:
            conn.execute("ALTER TABLE project_operations RENAME COLUMN digest TO wrong_digest")
        result = check(self.store.path)
        self.assertFalse(result["ok"])
        self.assertTrue(result["schema_errors"])

    def test_supported_old_schema_still_checks_and_restores(self):
        for version in (1, 2):
            with self.subTest(version=version):
                path = Path(self.tmp.name) / f"legacy-{version}.sqlite3"
                # A real historical schema subset; no invented placeholder tables.
                with closing(self.store.connect()) as source, closing(sqlite3.connect(path)) as target:
                    names = ["discoveries", "receipts", "deliveries"]
                    if version == 2:
                        names += ["changes", "change_versions", "change_operations"]
                    for name in names:
                        sql = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()[0]
                        target.execute(sql)
                    target.execute(f"PRAGMA user_version={version}")
                    target.commit()
                self.assertTrue(check(path)["ok"])
                self.assertTrue(restore(path, Path(self.tmp.name) / f"restore-{version}")["ok"])

    def test_discovery_publisher_does_not_coerce_boolean_schema_or_integer_persistence(self):
        _, receipt = self.store.publish(backend.sample())
        for mutation in ({"schema_version": True}, {"persistence": {"receipt": 1, "discovery": 1}}):
            changed = dict(receipt, **mutation)
            with self.subTest(mutation=mutation), self.assertRaises(DeliveryError):
                Publisher.check_receipt(changed, receipt["delivery_key"], receipt["record_id"], receipt["content_sha256"])


class ReviewHttpTests(unittest.TestCase):
    setUp = backend.HttpTests.setUp
    tearDown = backend.HttpTests.tearDown
    request = backend.HttpTests.request

    def test_huge_canvas_numbers_return_structured_validation_error(self):
        self.store.projects.save_workspace(workspace(Path(self.tmp.name)))
        for field in ("zoom", "x", "y"):
            data = {"zoom": 1, "layer": "formal", "nodes": [{"id": "n", "x": 0, "y": 0, "label": "test", "ref": None}], "edges": []}
            if field == "zoom":
                data[field] = 10**1000
            else:
                data["nodes"][0][field] = 10**1000
            with self.subTest(field=field):
                value = item("huge-canvas", "canvas", data)
                code, result, _ = self.request("POST", "/v1/workspaces/project-1/canvases", json.dumps(value).encode())
                self.assertEqual(code, 422)
                self.assertEqual(result["error"]["code"], "invalid_input")
                self.assertIsNone(self.store.projects.operation(value["operation_key"]))
        self.assertEqual(self.request("GET", "/v1/health")[0], 200)

    def test_json_overflow_exponents_are_rejected_by_transport_parser(self):
        for token in (b"1e999", b"-1e999", b"NaN", b"Infinity", b"-Infinity"):
            with self.subTest(token=token), self.assertRaises(ValueError):
                parse_json(b'{"x":'+token+b'}')
        self.assertEqual(parse_json(b'{"x":1e3}'), {"x": 1000.0})

    def test_project_publisher_rejects_invalid_receipt_status_and_resource(self):
        self.store.projects.save_workspace(workspace(Path(self.tmp.name)))
        self.store.projects.save_item("project-1", artifact("other-file"))
        client = ProjectPublisher(self.server.server_port, self.token, attempts=1)
        value = artifact()
        client.publish_project("artifacts", "project-1", json.dumps(value).encode())
        request = client.request
        variants = [
            {"status": "failed"}, {"schema_version": True}, {"resource": None},
            {"persistence": {"receipt": 1, "project_state": 1}},
            {"resource": {"id": "artifact-1", "kind": "unknown", "version": 1}},
            {"resource": {"id": "artifact-1", "kind": "artifact", "version": True}},
            {"resource": {"id": "other-file", "kind": "artifact", "version": 1}},
        ]
        for change in variants:
            def altered(method, path, body=None):
                response = request(method, path, body)
                if method == "POST" or path.startswith("/v1/receipts/"):
                    response.update(copy.deepcopy(change))
                return response
            with self.subTest(change=change), patch.object(client, "request", altered):
                with self.assertRaises(DeliveryError):
                    client.publish_project("artifacts", "project-1", json.dumps(value).encode())

    def test_refresh_publisher_does_not_accept_empty_readback_set(self):
        self.store.projects.save_workspace(workspace(Path(self.tmp.name)))
        client = ProjectPublisher(self.server.server_port, self.token, attempts=1)
        value = {"schema_version": 1, "operation_key": "refresh-example", "expected_version": 1, "filenames": ["PLAN.md"]}
        request = client.request
        def altered(method, path, body=None):
            response = request(method, path, body)
            if method == "POST" or path.startswith("/v1/receipts/"):
                response["resource"]["items"] = []
            return response
        with patch.object(client, "request", altered), self.assertRaises(DeliveryError):
            client.publish_project("refresh", "project-1", json.dumps(value).encode())


if __name__ == "__main__":
    unittest.main()
