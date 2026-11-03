"""Isolated evidence for the stage/milestone contract, not real project acceptance."""
import json
import os
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

import test_backend as backend
import test_projects as project_tests
from test_projects import artifact, item, manuscript, ref, workspace
from workbench.contracts import Problem
from workbench.maintenance import backup, check, restore
from workbench.project_publish import ProjectPublisher
from workbench.store import Store


def stage(sid="stage-1", day="2026-10-20", status="completed"):
    return item(sid, "stage", {"status": status, "date": day, "summary": "合成阶段依据",
                               "refs": [ref("artifact-1", "artifact", "source")]})


def milestone(vid="version-1", sid="stage-1", output=False, day="2026-10-21"):
    value = manuscript(vid)
    value["item"]["data"].update(occurred_on=day, milestone_status="recorded", stage_version=output,
        changes=[{"artifact_id": "artifact-1", "artifact_version": 1, "file": "PLAN.md",
                  "title": "补充说明", "summary": "第1节补充来源边界", "kind": "semantic",
                  "source": "user", "note": "  保留我的原话\n不作润色。  "}])
    if sid:
        value["item"]["data"]["refs"].append(ref(sid, "stage", "stage"))
    return value


class BoardStoreTests(unittest.TestCase):
    setUp = project_tests.ProjectStoreTests.setUp
    tearDown = project_tests.ProjectStoreTests.tearDown

    def seed(self):
        self.p.save_item("project-1", artifact())
        self.p.save_item("project-1", stage())

    def test_multiple_milestones_future_unknown_dates_and_restart(self):
        self.seed()
        self.p.save_item("project-1", stage("future", "2027-01-01", "planned"))
        self.p.save_item("project-1", stage("unknown", None, "unknown"))
        self.p.save_item("project-1", milestone(output=True))
        self.p.save_item("project-1", milestone("version-2", day=None))
        future = milestone("future-version", "future", day="2027-01-01")
        future["item"]["data"]["milestone_status"] = "planned"
        self.p.save_item("project-1", future)
        board = self.p.board("project-1")
        self.assertEqual([s["id"] for s in board["stages"]], ["stage-1", "future", "unknown"])
        self.assertEqual([v["stage"]["id"] for v in board["milestones"]], ["future", "stage-1", "stage-1"])
        self.assertEqual(board["milestones"][1]["date_status"], "unknown")
        self.assertIsNone(board["milestones"][1]["occurred_on"])
        self.assertEqual(board["milestones"][0]["milestone_status"], "planned")
        self.assertEqual(Store(self.store.path).projects.board("project-1"), board)
        self.assertTrue(check(self.store.path)["ok"])

    def test_exact_file_and_stage_revisions_survive_updates_and_archival(self):
        self.seed()
        self.p.save_item("project-1", milestone())
        changed = artifact()
        changed.update(operation_key="change-file", expected_version=1)
        changed["item"]["data"]["relative_path"] = "missing.docx"
        self.p.save_item("project-1", changed)
        changed = stage()
        changed.update(operation_key="archive-stage", expected_version=1)
        changed["item"]["archived"] = True
        self.p.save_item("project-1", changed)
        board = self.p.board("project-1")
        self.assertEqual(board["stages"], [])
        v = board["milestones"][0]
        self.assertEqual(v["files"][0]["data"]["relative_path"], "PLAN.md")
        self.assertEqual(v["files"][0]["version"], 1)
        self.assertEqual(v["files"][0]["current_version"], 2)
        self.assertEqual(v["stage"]["version"], 1)
        self.assertTrue(v["stage"]["current_archived"])
        self.assertEqual(v["storage"], "reference_only")

    def test_missing_file_is_not_claimed_verified_and_notes_preserved(self):
        self.seed()
        self.p.save_item("project-1", milestone())
        (self.root / "PLAN.md").unlink()
        v = self.p.board("project-1")["milestones"][0]
        self.assertEqual(v["file_verification"], "not_performed")
        self.assertEqual(v["changes_status"], "producer_declared_not_authenticated")
        self.assertEqual(v["changes"][0]["note"], "  保留我的原话\n不作润色。  ")
        self.assertEqual(self.p.inspect_artifact("project-1", "artifact-1")["status"], "missing")

    def test_legacy_records_have_explicit_missing_metadata(self):
        self.p.save_item("project-1", artifact())
        old = manuscript()
        self.p.save_item("project-1", old)
        v = self.p.board("project-1")["milestones"][0]
        self.assertIsNone(v["stage"])
        self.assertIsNone(v["occurred_on"])
        self.assertEqual(v["changes_status"], "not_recorded")
        self.assertFalse(v["stage_version"])
        self.assertEqual(self.p.item("project-1", "version-1")["data"],
                         dict(old["item"]["data"], refs=[ref("artifact-1", "artifact", "artifact", 1)]))

    def test_pagination_includes_stages_and_never_loses_milestones(self):
        self.seed()
        for index in range(5):
            self.p.save_item("project-1", milestone(f"v-{index}"))
        ids, before = [], None
        while True:
            page = self.p.board("project-1", limit=2, before=before)
            self.assertEqual(len(page["stages"]), 1)
            ids.extend(v["version"]["id"] for v in page["milestones"])
            before = page["next_before"]
            if before is None:
                break
        self.assertEqual(ids, [f"v-{i}" for i in reversed(range(5))])
        self.assertEqual(self.p.list_items(include_test=False)["items"], [])

    def test_concurrent_stage_output_uniqueness_and_replay(self):
        self.seed()
        def write(index):
            try:
                return self.p.save_item("project-1", milestone(f"v-{index}", output=True))[0]
            except Problem as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(write, range(8)))
        self.assertEqual(results.count(201), 1)
        self.assertEqual(results.count("stage_output_conflict"), 7)
        saved = self.p.board("project-1")["milestones"][0]["version"]["id"]
        original = milestone(saved, output=True)
        receipt = self.p.save_item("project-1", original)[1]
        self.assertEqual(self.p.save_item("project-1", original)[1], receipt)
        self.assertEqual(len(self.p.item("project-1", saved)["history"]), 1)

    def test_replace_output_explicitly_preserves_old_revision(self):
        self.seed()
        old = milestone(output=True)
        self.p.save_item("project-1", old)
        old.update(operation_key="clear-output", expected_version=1)
        old["item"]["data"]["stage_version"] = False
        self.p.save_item("project-1", old)
        self.p.save_item("project-1", milestone("new-output", output=True))
        self.assertTrue(self.p.item("project-1", "version-1", 1)["data"]["stage_version"])
        self.assertFalse(self.p.item("project-1", "version-1")["data"]["stage_version"])

    def test_invalid_dates_enums_types_and_unknown_fields_rejected(self):
        self.seed()
        for field, bad in (("occurred_on", "2026-02-30"), ("occurred_on", "20261101"),
                           ("occurred_on", 20261101), ("stage_version", 1),
                           ("milestone_status", "submitted"), ("extra", True), ("changes", {})):
            with self.subTest(field=field, bad=bad):
                value = milestone()
                value["item"]["data"][field] = bad
                with self.assertRaises(Problem):
                    self.p.save_item("project-1", value)
        for day in ("2026-02-29", "2026-W44-1", "2026-11-01T00:00:00Z"):
            with self.assertRaises(Problem):
                self.p.save_item("project-1", stage("bad", day))

    def test_bad_stage_and_change_links_roll_back_operation_and_receipt(self):
        self.seed()
        bad_values = [milestone(sid="absent"), milestone(sid=None, output=True)]
        wrong_change = milestone()
        wrong_change["item"]["data"]["changes"][0]["artifact_version"] = 2
        bad_values.append(wrong_change)
        two_stages = milestone()
        two_stages["item"]["data"]["refs"].append(ref("stage-1", "stage", "stage", 1))
        bad_values.append(two_stages)
        planned = milestone(output=True)
        planned["item"]["data"]["milestone_status"] = "planned"
        bad_values.append(planned)
        for value in bad_values:
            with self.assertRaises(Problem):
                self.p.save_item("project-1", value)
            self.assertIsNone(self.p.operation(value["operation_key"]))
        self.assertEqual(self.p.board("project-1")["milestones"], [])
        with closing(self.store.connect()) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM project_operations").fetchone()[0], 3)
            self.assertEqual(conn.execute("SELECT count(*) FROM receipts").fetchone()[0], 3)

    def test_stage_evidence_cross_workspace_and_collection_validation(self):
        self.seed()
        other = self.root.parent / "other"
        other.mkdir()
        self.p.save_workspace(workspace(other, "other", "register-other"))
        with self.assertRaises(Problem):
            self.p.save_item("other", stage())
        missing = stage("no-evidence")
        missing["item"]["data"]["refs"] = []
        with self.assertRaises(Problem):
            self.p.save_item("project-1", missing)
        wrong = milestone()
        wrong["item"]["data"]["refs"][-1] = ref("artifact-1", "artifact", "stage")
        with self.assertRaises(Problem):
            self.p.save_item("project-1", wrong)

    def test_bounded_stages_explicitly_signal_overflow(self):
        self.p.save_item("project-1", artifact())
        for index in range(101):
            self.p.save_item("project-1", stage(f"s-{index}"))
        board = self.p.board("project-1")
        self.assertEqual(len(board["stages"]), 100)
        self.assertTrue(board["stages_truncated"])
        self.assertEqual(len(self.p.list_items("project-1", kind="stage", limit=100, include_test=True)["items"]), 100)

    def test_new_process_and_backup_restore_keep_board_and_receipt(self):
        self.seed()
        _, receipt = self.p.save_item("project-1", milestone(output=True))
        expected = self.p.board("project-1")
        source_root = str(Path(__file__).resolve().parents[1] / "backend")
        script = "import json,sys; from workbench.store import Store; print(json.dumps(Store(sys.argv[1]).projects.board('project-1')))"
        process = subprocess.run([sys.executable, "-c", script, str(self.store.path)],
                                 env=dict(os.environ, PYTHONPATH=source_root),
                                 capture_output=True, text=True, encoding="utf-8", timeout=30, check=True)
        self.assertEqual(json.loads(process.stdout), expected)
        destination = Path(self.tmp.name) / "board-backup.sqlite3"
        backup(self.store.path, destination)
        restored = Path(self.tmp.name) / "board-restored"
        restore(destination, restored)
        reopened = Store(restored / "workbench.sqlite3")
        self.assertEqual(reopened.projects.board("project-1"), expected)
        self.assertEqual(reopened.receipt(receipt["receipt_id"]), receipt)
        self.assertTrue(check(reopened.path)["ok"])


class BoardHttpTests(unittest.TestCase):
    setUp = backend.HttpTests.setUp
    tearDown = backend.HttpTests.tearDown
    request = backend.HttpTests.request

    def test_http_routes_publisher_readback_auth_and_error_semantics(self):
        self.store.projects.save_workspace(workspace(Path(self.tmp.name)))
        self.store.projects.save_item("project-1", artifact())
        publisher = ProjectPublisher(self.server.server_port, self.token, attempts=1)
        result = publisher.publish_project("stages", "project-1", json.dumps(stage()).encode())
        self.assertTrue(result["readback_confirmed"])
        self.assertEqual(publisher.publish_project("stages", "project-1", json.dumps(stage()).encode())["receipt_id"], result["receipt_id"])
        code, _, _ = self.request("POST", "/v1/workspaces/project-1/versions", json.dumps(milestone()).encode())
        self.assertEqual(code, 201)
        self.assertEqual(len(self.request("GET", "/v1/workspaces/project-1/board")[1]["milestones"]), 1)
        self.assertEqual(len(self.request("GET", "/v1/workspaces/project-1/stages?include_test=true")[1]["items"]), 1)
        self.assertEqual(self.request("GET", "/v1/workspaces/project-1/stages/stage-1?version=1")[1]["id"], "stage-1")
        for path, expected in (("/v1/workspaces/project-1/board?limit=0", 400),
                               ("/v1/workspaces/project-1/board?limit=101", 400),
                               ("/v1/workspaces/project-1/board?before=0", 400),
                               ("/v1/workspaces/project-1/board?sample=true", 400),
                               ("/v1/workspaces/absent/board", 404)):
            self.assertEqual(self.request("GET", path)[0], expected)
        self.assertEqual(self.request("GET", "/v1/workspaces/project-1/board", headers={"Authorization": ""})[0], 401)
        value = milestone("other-output", output=True)
        path = "/v1/workspaces/project-1/versions"
        self.assertEqual(self.request("POST", path, json.dumps(value).encode())[0], 201)
        conflict = milestone("conflicting-output", output=True)
        self.assertEqual(self.request("POST", path, json.dumps(conflict).encode())[0], 409)


if __name__ == "__main__":
    unittest.main()
