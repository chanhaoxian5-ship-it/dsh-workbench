import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

import test_backend as backend
from workbench.contracts import Problem
from workbench.maintenance import backup, check, restore
from workbench.project_files import inspect_file, relative_path
from workbench.store import Store


def workspace(root, wid="project-1", key="register-1", is_test=True):
    return {"schema_version": 1, "operation_key": key, "expected_version": 0, "workspace": {
        "id": wid, "name": "隔离测试项目", "root_path": str(root), "kind": "project", "view": "paper",
        "status": "active", "favorite": False, "description": "合成测试，不代表真实项目", "is_test": is_test}}


def ref(item_id, kind, role, version=None):
    result = {"id": item_id, "kind": kind, "role": role}
    if version is not None:
        result["version"] = version
    return result


def item(item_id, kind, data, key=None, version=0):
    return {"schema_version": 1, "operation_key": key or "save-"+item_id, "expected_version": version,
            "item": {"id": item_id, "kind": kind, "title": "合成记录 "+item_id, "archived": False, "data": data}}


def artifact(item_id="artifact-1", relative="PLAN.md"):
    return item(item_id, "artifact", {"relative_path": relative, "category": "document", "description": "来源引用", "expected_sha256": None})


def manuscript(item_id="version-1", artifact_id="artifact-1", previous=None):
    links = [ref(artifact_id, "artifact", "artifact")]
    if previous:
        links.append(ref(previous, "version", "previous"))
    return item(item_id, "version", {"label": item_id, "status": "draft", "summary": "合成整稿版本", "refs": links})


def plan(item_id="plan-1"):
    return item(item_id, "plan", {"summary": "来源仍为已有计划文件", "stage": "准备", "next_step": "检查依据", "refs": [ref("artifact-1", "artifact", "source")], "change_ids": []})


def task(item_id="task-1", dependencies=()):
    return item(item_id, "task", {"summary": "合成任务", "status": "todo", "due_date": "2026-11-01",
        "refs": [ref("plan-1", "plan", "plan")]+[ref(i, "task", "depends_on") for i in dependencies]})


class ProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "project"
        self.root.mkdir()
        (self.root / "PLAN.md").write_text("# 合成计划\n这不是用户真实计划。", encoding="utf-8")
        self.store = Store(Path(self.tmp.name) / "data/workbench.sqlite3")
        self.p = self.store.projects
        self.p.save_workspace(workspace(self.root))

    def tearDown(self):
        self.tmp.cleanup()

    def seed(self):
        self.p.save_item("project-1", artifact())
        self.p.save_item("project-1", manuscript())
        self.p.save_item("project-1", plan())

    def test_registry_restart_updates_history_and_immutable_root(self):
        self.assertEqual(self.p.list_workspaces()["items"], [])
        self.assertEqual(len(self.p.list_workspaces(include_test=True)["items"]), 1)
        changed = workspace(self.root, key="pause")
        changed["expected_version"] = 1
        changed["workspace"].update(status="paused", favorite=True)
        self.p.save_workspace(changed)
        reopened = Store(self.store.path).projects
        self.assertEqual(reopened.workspace("project-1")["status"], "paused")
        self.assertEqual(reopened.workspace("project-1", 1)["status"], "active")
        self.assertEqual(len(reopened.workspace("project-1")["history"]), 2)
        changed["operation_key"] = "move"
        changed["expected_version"] = 2
        changed["workspace"]["root_path"] = str(self.root.parent)
        with self.assertRaises(Problem) as error:
            self.p.save_workspace(changed)
        self.assertEqual(error.exception.code, "immutable_identity")

    def test_duplicate_root_and_cross_route_operation_conflict(self):
        with self.assertRaises(Problem) as error:
            self.p.save_workspace(workspace(self.root, "project-2", "register-2"))
        self.assertEqual(error.exception.code, "workspace_conflict")
        value = artifact()
        value["operation_key"] = "register-1"
        with self.assertRaises(Problem) as error:
            self.p.save_item("project-1", value)
        self.assertEqual(error.exception.code, "operation_conflict")

    def test_all_item_kinds_roundtrip_and_pinned_references(self):
        self.seed()
        feedback = item("feedback-1", "feedback", {"quote": "合成反馈", "response": "已按意见处理", "status": "addressed", "location": "第2节",
            "refs": [ref("version-1", "version", "version"), ref("artifact-1", "artifact", "evidence")]})
        self.p.save_item("project-1", feedback)
        self.p.save_item("project-1", task())
        self.p.save_item("project-1", item("record-1", "record", {"summary": "合成交付", "stage": "修订", "next_step": "用户验收", "blockers": ["尚未验收"], "refs": [ref("plan-1", "plan", "context")], "session": None}))
        self.p.save_item("project-1", item("canvas-1", "canvas", {"zoom": 1, "layer": "formal", "nodes": [{"id": "node-1", "x": 2, "y": 4, "label": "证据", "ref": ref("artifact-1", "artifact", "context")}], "edges": []}))
        self.assertEqual(len(self.p.list_items("project-1", include_test=True)["items"]), 7)
        changed = artifact()
        changed.update(operation_key="artifact-updated", expected_version=1)
        changed["item"]["data"]["relative_path"] = "NEW.md"
        self.p.save_item("project-1", changed)
        version = self.p.item("project-1", "version-1")
        self.assertEqual(version["data"]["refs"][0]["version"], 1)
        self.assertEqual(self.p.item("project-1", "artifact-1", 1)["data"]["relative_path"], "PLAN.md")
        self.assertEqual(self.p.item("project-1", "feedback-1")["adoption_verification"], "producer_declared_not_authenticated")

    def test_optimistic_concurrent_edits_and_exact_replay(self):
        original = artifact()
        first = self.p.save_item("project-1", original)[1]
        self.assertEqual(self.p.save_item("project-1", original)[1], first)
        def write(index):
            changed = artifact()
            changed.update(operation_key=f"concurrent-{index}", expected_version=1)
            changed["item"]["title"] += str(index)
            try:
                return self.p.save_item("project-1", changed)[0]
            except Problem as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(write, range(8)))
        self.assertEqual(results.count(200), 1)
        self.assertEqual(results.count("version_conflict"), 7)
        self.assertEqual(self.p.save_item("project-1", original)[1], first)
        self.assertEqual(self.p.item("project-1", "artifact-1")["version"], 2)

    def test_concurrent_same_operation_writes_one_revision(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.p.save_item("project-1", artifact()), range(16)))
        self.assertEqual(sum(code == 201 for code, _ in results), 1)
        self.assertEqual(len({r["receipt_id"] for _, r in results}), 1)
        self.assertEqual(len(self.p.item("project-1", "artifact-1")["history"]), 1)

    def test_cross_workspace_wrong_kind_missing_and_future_revision_refs_rejected(self):
        self.seed()
        other = self.root.parent / "other"
        other.mkdir()
        self.p.save_workspace(workspace(other, "project-2", "register-2"))
        for wid, link in (("project-2", ref("artifact-1", "artifact", "artifact")),
                          ("project-1", ref("plan-1", "artifact", "artifact")),
                          ("project-1", ref("artifact-1", "artifact", "artifact", 99))):
            value = manuscript("bad")
            value["item"]["data"]["refs"] = [link]
            with self.assertRaises(Problem):
                self.p.save_item(wid, value)

    def test_feedback_cannot_claim_addressed_without_location_and_evidence(self):
        self.seed()
        data = {"quote": "问题", "response": "已修改", "status": "addressed", "location": "第3节", "refs": [ref("version-1", "version", "version")]}
        with self.assertRaises(Problem) as error:
            self.p.save_item("project-1", item("bad", "feedback", data))
        self.assertEqual(error.exception.code, "evidence_required")
        data["location"] = ""
        data["refs"].append(ref("artifact-1", "artifact", "evidence"))
        with self.assertRaises(Problem):
            self.p.save_item("project-1", item("bad", "feedback", data))

    def test_task_cycles_and_unfinished_dependencies_are_explicit(self):
        self.seed()
        self.p.save_item("project-1", task())
        self.p.save_item("project-1", task("task-2", ["task-1"]))
        self.assertEqual(self.p.item("project-1", "task-2")["dependencies_not_done"], ["task-1"])
        circular = task("task-1", ["task-2"])
        circular.update(operation_key="cycle", expected_version=1)
        with self.assertRaises(Problem) as error:
            self.p.save_item("project-1", circular)
        self.assertEqual(error.exception.code, "dependency_cycle")
        self.assertEqual(self.p.item("project-1", "task-1")["version"], 1)

    def test_canvas_invalid_edges_coordinates_and_references_rejected(self):
        base = {"zoom": 1, "layer": "explore", "nodes": [{"id": "n", "x": 0, "y": 0, "label": "草稿", "ref": None}], "edges": []}
        for key, value in (("zoom", float("inf")), ("edges", [{"id": "e", "from": "n", "to": "missing", "label": ""}]), ("nodes", [{"id": "n", "x": True, "y": 0, "label": "", "ref": None}])):
            data = copy.deepcopy(base)
            data[key] = value
            with self.assertRaises((Problem, ValueError)):
                self.p.save_item("project-1", item("bad-canvas", "canvas", data))

    def test_source_refresh_reads_only_selected_files_and_keeps_hash_provenance(self):
        value = {"schema_version": 1, "operation_key": "refresh-1", "expected_version": 1, "filenames": ["PLAN.md", "README.md"]}
        first = self.p.refresh("project-1", value)[1]
        snapshots = self.p.list_items("project-1", "source", include_test=True)["items"]
        self.assertEqual(len(snapshots), 2)
        states = {s["title"]: s["data"]["status"] for s in snapshots}
        self.assertEqual(states, {"PLAN.md": "exists", "README.md": "missing"})
        saved = next(s for s in snapshots if s["title"] == "PLAN.md")
        expected_hash = hashlib.sha256((self.root / "PLAN.md").read_bytes()).hexdigest()
        self.assertEqual(saved["data"]["sha256"], expected_hash)
        self.assertEqual(saved["data"]["interpretation"], "not_performed")
        (self.root / "PLAN.md").write_text("后来改过了", encoding="utf-8")
        self.assertEqual(self.p.refresh("project-1", value)[1], first)
        self.assertEqual(len(self.p.list_items("project-1", "source", include_test=True)["items"]), 2)

    def test_bounded_source_and_file_fingerprint_status(self):
        (self.root / "README.md").write_text("长"*15000, encoding="utf-8")
        result = inspect_file(str(self.root), "README.md", source=True)
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["text"]), 12000)
        self.assertEqual(inspect_file(str(self.root), "PLAN.md", "a"*64)["status"], "hash_mismatch")
        for path in ("../outside.md", "C:\\outside.md", "\\\\server\\file", "data:stream", "CON.md"):
            with self.subTest(path=path), self.assertRaises(Problem):
                relative_path(path)

    def test_restricted_source_names_and_no_direct_source_mutation(self):
        value = {"schema_version": 1, "operation_key": "bad-read", "expected_version": 1, "filenames": ["../api-token.txt"]}
        with self.assertRaises(Problem):
            self.p.refresh("project-1", value)
        with self.assertRaises(Problem):
            self.p.save_item("project-1", item("source", "source", {}))

    def test_archiving_search_pagination_and_overview(self):
        self.seed()
        first = self.p.list_items("project-1", include_test=True, limit=2)
        second = self.p.list_items("project-1", include_test=True, limit=2, before=first["next_before"])
        self.assertEqual(len(first["items"])+len(second["items"]), 3)
        self.assertEqual(self.p.list_items(q="%", include_test=True)["items"], [])
        self.assertEqual(len(self.p.list_items(q="合成", include_test=True)["items"]), 3)
        archived = artifact()
        archived.update(expected_version=1, operation_key="archive")
        archived["item"]["archived"] = True
        self.p.save_item("project-1", archived)
        self.assertEqual(len(self.p.list_items("project-1", include_test=True)["items"]), 2)
        self.assertEqual(self.p.item("project-1", "artifact-1", 1)["archived"], False)
        self.assertFalse(self.p.overview("project-1")["automatically_inferred_status"])

    def test_version_comparison_and_immutable_predecessor(self):
        self.seed()
        updated = artifact()
        updated.update(expected_version=1, operation_key="new-file")
        updated["item"]["data"]["expected_sha256"] = "b"*64
        self.p.save_item("project-1", updated)
        self.p.save_item("project-1", manuscript("version-2", previous="version-1"))
        diff = self.p.compare_versions("project-1", "version-1", "version-2")
        self.assertEqual(diff["changed_references"], ["artifact-1"])
        self.assertEqual(diff["document_text_diff"], "not_performed")
        rewrite = manuscript("version-2")
        rewrite.update(expected_version=1, operation_key="rewrite-lineage")
        with self.assertRaises(Problem) as error:
            self.p.save_item("project-1", rewrite)
        self.assertEqual(error.exception.code, "immutable_lineage")

    def test_docx_preview_and_hash_verified_text_diff(self):
        for name, text in (("before.docx", "Before the revision."), ("after.docx", "After the revision.")):
            with zipfile.ZipFile(self.root / name, "w") as document:
                document.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>')
        first = artifact(relative="before.docx")
        first["item"]["data"]["expected_sha256"] = hashlib.sha256((self.root / "before.docx").read_bytes()).hexdigest()
        self.p.save_item("project-1", first)
        self.p.save_item("project-1", manuscript())
        second = artifact(relative="after.docx")
        second.update(expected_version=1, operation_key="new-manuscript")
        second["item"]["data"]["expected_sha256"] = hashlib.sha256((self.root / "after.docx").read_bytes()).hexdigest()
        self.p.save_item("project-1", second)
        self.p.save_item("project-1", manuscript("version-2", previous="version-1"))
        preview = self.p.preview_artifact("project-1", "artifact-1", 1)
        self.assertEqual(preview["text"], "Before the revision.")
        diff = self.p.compare_versions("project-1", "version-1", "version-2", "artifact-1", "artifact-1")
        self.assertEqual(diff["document_text_diff"], "ready")
        self.assertIn("-Before the revision.", diff["diff_lines"])
        (self.root / "before.docx").write_bytes(b"changed after registration")
        self.assertEqual(self.p.compare_versions("project-1", "version-1", "version-2", "artifact-1", "artifact-1")["document_text_diff"], "historical_content_unverifiable")

    def test_bad_docx_and_non_preview_formats_fall_back_honestly(self):
        (self.root / "bad.docx").write_bytes(b"not a zip")
        self.p.save_item("project-1", artifact(relative="bad.docx"))
        self.assertEqual(self.p.preview_artifact("project-1", "artifact-1")["preview_status"], "unreadable_or_unsupported_document")
        (self.root / "paper.pdf").write_bytes(b"synthetic non-pdf")
        self.p.save_item("project-1", artifact("pdf", "paper.pdf"))
        self.assertEqual(self.p.preview_artifact("project-1", "pdf")["preview_status"], "external_viewer_required")

    def test_plan_links_real_change_and_rejects_cross_test_contamination(self):
        self.seed()
        finding = backend.sample()
        self.store.publish(finding)
        self.store.changes.publish({"schema_version": 1, "delivery_key": "change", "change_id": "change", "record_id": "test-001", "expected_version": 0, "priority": "normal"})
        value = plan()
        value.update(expected_version=1, operation_key="impact")
        value["item"]["data"]["change_ids"] = ["change"]
        self.p.save_item("project-1", value)
        finding["delivery_key"] = "real-classification-only"
        finding["discovery"].update(record_id="other", is_test=False)
        self.store.publish(finding)
        self.store.changes.publish({"schema_version": 1, "delivery_key": "other-change", "change_id": "other-change", "record_id": "other", "expected_version": 0, "priority": "normal"})
        value.update(expected_version=2, operation_key="bad-impact")
        value["item"]["data"]["change_ids"] = ["other-change"]
        with self.assertRaises(Problem):
            self.p.save_item("project-1", value)

    def test_transaction_rollback_and_commit_response_loss(self):
        def before(stage):
            if stage == "before_project_commit":
                raise sqlite3.OperationalError("injected")
        self.store.fault = before
        with self.assertRaises(sqlite3.Error):
            self.p.save_item("project-1", artifact())
        self.assertEqual(self.p.list_items("project-1", include_test=True)["items"], [])
        self.assertIsNone(self.p.operation("save-artifact-1"))
        def after(stage):
            if stage == "after_project_commit":
                raise sqlite3.OperationalError("lost response")
        self.store.fault = after
        with self.assertRaises(sqlite3.Error):
            self.p.save_item("project-1", artifact())
        self.store.fault = None
        saved = self.p.operation("save-artifact-1")
        self.assertEqual(self.p.save_item("project-1", artifact())[1], saved)
        self.assertEqual(len(self.p.item("project-1", "artifact-1")["history"]), 1)

    def test_backup_restore_integrity_and_no_overwrite(self):
        self.seed()
        destination = Path(self.tmp.name) / "backups/project.sqlite3"
        self.assertTrue(backup(self.store.path, destination)["ok"])
        restored = Path(self.tmp.name) / "restored"
        self.assertTrue(restore(destination, restored)["ok"])
        self.assertEqual(Store(restored / "workbench.sqlite3").projects.item("project-1", "version-1")["version"], 1)
        self.assertFalse((restored / "api-token.txt").exists())
        with self.assertRaises(ValueError):
            backup(self.store.path, destination)
        with self.assertRaises(FileExistsError):
            restore(destination, restored)
        self.assertTrue(check(self.store.path)["ok"])

    def test_upgrade_v2_preserves_previous_module_data(self):
        _, receipt = self.store.publish(backend.sample())
        with closing(self.store.connect()) as conn:
            conn.executescript("""
                DROP TABLE project_change_links;
                DROP TABLE project_item_links;
                DROP TABLE project_item_revisions;
                DROP TABLE project_items;
                DROP TABLE workspace_revisions;
                DROP TABLE project_operations;
                DROP TABLE workspaces;
                PRAGMA user_version=2;
            """)
        migrated = Store(self.store.path)
        self.assertEqual(migrated.detail("test-001")["record_id"], "test-001")
        self.assertEqual(migrated.receipt(receipt["receipt_id"]), receipt)
        self.assertEqual(migrated.projects.list_workspaces(include_test=True)["items"], [])
        self.assertEqual(migrated.projects.save_workspace(workspace(self.root))[0], 201)
        self.assertTrue(check(self.store.path)["ok"])


class ProjectHttpTests(unittest.TestCase):
    setUp = backend.HttpTests.setUp
    tearDown = backend.HttpTests.tearDown
    request = backend.HttpTests.request

    def test_full_http_project_workflow_and_query_boundaries(self):
        root = Path(self.tmp.name) / "project"
        root.mkdir()
        (root / "PLAN.md").write_text("# 测试计划", encoding="utf-8")
        def post(path, value):
            return self.request("POST", path, json.dumps(value).encode())
        self.assertEqual(post("/v1/workspaces", workspace(root))[0], 201)
        self.assertEqual(self.request("GET", "/v1/workspaces")[1]["items"], [])
        self.assertEqual(len(self.request("GET", "/v1/workspaces?include_test=true")[1]["items"]), 1)
        code, receipt, _ = post("/v1/workspaces/project-1/artifacts", artifact())
        self.assertEqual(code, 201)
        self.assertEqual(self.request("GET", "/v1/project-operations/save-artifact-1")[1], receipt)
        self.assertEqual(self.request("GET", "/v1/receipts/"+receipt["receipt_id"])[1], receipt)
        self.assertEqual(self.request("GET", "/v1/workspaces/project-1/artifacts/artifact-1/inspect")[1]["status"], "exists")
        self.assertEqual(post("/v1/workspaces/project-1/versions", manuscript())[0], 201)
        self.assertEqual(post("/v1/workspaces/project-1/plans", plan())[0], 201)
        self.assertEqual(post("/v1/workspaces/project-1/tasks", task())[0], 201)
        self.assertEqual(self.request("GET", "/v1/workspaces/project-1/overview")[1]["counts"]["task"], 1)
        self.assertEqual(len(self.request("GET", "/v1/search?q=%E5%90%88%E6%88%90&include_test=true")[1]["items"]), 4)
        refresh = {"schema_version": 1, "operation_key": "http-refresh", "expected_version": 1, "filenames": ["PLAN.md"]}
        self.assertEqual(post("/v1/workspaces/project-1/refresh", refresh)[0], 200)
        self.assertEqual(len(self.request("GET", "/v1/workspaces/project-1/sources?include_test=true")[1]["items"]), 1)
        self.assertEqual(self.request("GET", "/v1/capabilities")[1]["database_version"], 3)
        for path, expected in (("/v1/search", 400), ("/v1/workspaces?limit=0", 400), ("/v1/workspaces?unknown=1", 400),
                               ("/v1/workspaces?include_test=yes", 400), ("/v1/workspaces/project-1/artifacts?limit=101", 400),
                               ("/v1/workspaces/project-1/artifacts/artifact-1?version=0", 422),
                               ("/v1/workspaces/project-1/tasks/artifact-1", 404),
                               ("/v1/workspaces/project-1/compare?left=version-1", 400)):
            self.assertEqual(self.request("GET", path)[0], expected, path)

    def test_new_routes_preserve_auth_and_reject_wrong_collection(self):
        root = Path(self.tmp.name)
        self.store.projects.save_workspace(workspace(root))
        for method, path, body, headers, expected in (
            ("GET", "/v1/workspaces", None, {"Authorization": ""}, 401),
            ("POST", "/v1/workspaces", b"{}", {"Origin": "https://evil.example"}, 403),
            ("POST", "/v1/workspaces/project-1/sources", b"{}", {}, 404),
            ("POST", "/v1/workspaces/project-1/tasks", json.dumps(artifact()).encode(), {}, 422),
            ("POST", "/v1/workspaces", b'{"schema_version":1,"schema_version":1}', {}, 400),
            ("POST", "/v1/workspaces", b'x'*131073, {}, 413),
            ("GET", "/v1/workspaces?limit=1&limit=2", None, {}, 400),
        ):
            self.assertEqual(self.request(method, path, body, headers)[0], expected, path)


if __name__ == "__main__":
    unittest.main()
