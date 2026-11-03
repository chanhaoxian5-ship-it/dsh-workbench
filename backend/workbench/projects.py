"""Workspace registry and versioned project metadata, without owning source files."""
import hashlib
import difflib
import json
import ntpath
import sqlite3
import uuid
from contextlib import closing

from . import project_contracts as contract
from .contracts import Problem, canonical, identity
from .project_files import SOURCE_NAMES, inspect_file, preview_file

SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL UNIQUE,
    root_key TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL,
    is_test INTEGER NOT NULL CHECK(is_test IN (0,1)),
    status TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_revisions (
    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id, version)
);
CREATE TABLE IF NOT EXISTS project_items (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL CHECK(archived IN (0,1)),
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id,item_id)
);
CREATE TABLE IF NOT EXISTS project_item_revisions (
    revision_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(workspace_id,item_id,version),
    FOREIGN KEY(workspace_id,item_id) REFERENCES project_items(workspace_id,item_id)
);
CREATE TABLE IF NOT EXISTS project_item_links (
    workspace_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    target_id TEXT NOT NULL,
    target_version INTEGER NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY(workspace_id,item_id,version,target_id,target_version,role),
    FOREIGN KEY(workspace_id,item_id,version) REFERENCES project_item_revisions(workspace_id,item_id,version),
    FOREIGN KEY(workspace_id,target_id,target_version) REFERENCES project_item_revisions(workspace_id,item_id,version)
);
CREATE TABLE IF NOT EXISTS project_change_links (
    workspace_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    change_id TEXT NOT NULL REFERENCES changes(change_id),
    PRIMARY KEY(workspace_id,item_id,version,change_id),
    FOREIGN KEY(workspace_id,item_id,version) REFERENCES project_item_revisions(workspace_id,item_id,version)
);
CREATE TABLE IF NOT EXISTS project_operations (
    operation_key TEXT PRIMARY KEY,
    digest TEXT NOT NULL,
    receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id)
);
CREATE INDEX IF NOT EXISTS project_items_workspace_kind ON project_items(workspace_id,kind,seq);
CREATE INDEX IF NOT EXISTS project_links_target ON project_item_links(workspace_id,target_id,target_version);
"""


def paging(limit, before):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise Problem("invalid_query", "limit must be 1..100", 400)
    if before is not None and (type(before) is not int or before < 1):
        raise Problem("invalid_query", "before must be positive", 400)


class Projects:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def _workspace(conn, workspace_id):
        identity(workspace_id, "workspace_id")
        row = conn.execute("SELECT * FROM workspaces WHERE workspace_id=?", (workspace_id,)).fetchone()
        if row is None:
            raise Problem("workspace_not_found", "Unknown workspace", 404)
        return row

    @staticmethod
    def _workspace_view(row):
        result = json.loads(row["body"])
        result.update(schema_version=1, version=row["version"], sequence=row["seq"],
                      created_at=row["created_at"], updated_at=row["updated_at"])
        return result

    def _operation(self, kind, workspace_id, value, callback):
        from .store import now
        key = value["operation_key"]
        digest = hashlib.sha256(canonical({"kind": kind, "workspace_id": workspace_id, "body": value}).encode()).hexdigest()
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute("SELECT r.body,o.digest FROM project_operations o JOIN receipts r USING(receipt_id) WHERE operation_key=?", (key,)).fetchone()
            if prior:
                if prior["digest"] != digest:
                    raise Problem("operation_conflict", "Operation key has different content or target", 409)
                return 200, json.loads(prior["body"])
            resource, duplicate = callback(conn, now())
            receipt = self.store._receipt("duplicate" if duplicate else "accepted", key=key, digest=digest)
            receipt.update(workspace_id=workspace_id, operation=kind, resource=resource)
            receipt["persistence"] = {"receipt": True, "project_state": True}
            status = 200 if duplicate or value["expected_version"] else 201
            self.store._save_receipt(conn, receipt, status)
            conn.execute("INSERT INTO project_operations VALUES(?,?,?)", (key, digest, receipt["receipt_id"]))
            if self.store.fault:
                self.store.fault("before_project_commit")
            conn.commit()
            if self.store.fault:
                self.store.fault("after_project_commit")
            return status, receipt

    def operation(self, key):
        identity(key, "operation_key")
        with closing(self.store.connect()) as conn:
            row = conn.execute("SELECT r.body FROM project_operations o JOIN receipts r USING(receipt_id) WHERE operation_key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def save_workspace(self, value, target_id=None):
        contract.envelope(value, "workspace")
        data = contract.workspace(value["workspace"])
        workspace_id = data["id"]
        if target_id is not None and target_id != workspace_id:
            raise Problem("invalid_input", "Workspace ID and route differ")
        def save(conn, at):
            old = conn.execute("SELECT * FROM workspaces WHERE workspace_id=?", (workspace_id,)).fetchone()
            if value["expected_version"] != (old["version"] if old else 0):
                raise Problem("version_conflict", "Workspace changed; reload before saving", 409)
            if old:
                previous = json.loads(old["body"])
                if (previous["root_path"], previous["is_test"]) != (data["root_path"], data["is_test"]):
                    raise Problem("immutable_identity", "Workspace root and test classification cannot change", 409)
                if old["body"] == canonical(data):
                    return {"id": workspace_id, "kind": "workspace", "version": old["version"]}, True
            version = old["version"] + 1 if old else 1
            if old:
                conn.execute("UPDATE workspaces SET version=?,status=?,body=?,updated_at=? WHERE workspace_id=?",
                             (version, data["status"], canonical(data), at, workspace_id))
            else:
                try:
                    conn.execute("INSERT INTO workspaces(workspace_id,root_key,version,is_test,status,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                                 (workspace_id, ntpath.normcase(data["root_path"]), version, int(data["is_test"]), data["status"], canonical(data), at, at))
                except sqlite3.IntegrityError:
                    raise Problem("workspace_conflict", "This directory is already registered", 409) from None
            conn.execute("INSERT INTO workspace_revisions VALUES(?,?,?,?)", (workspace_id, version, canonical(data), at))
            return {"id": workspace_id, "kind": "workspace", "version": version}, False
        return self._operation("workspace.save", workspace_id, value, save)

    def list_workspaces(self, limit=30, before=None, include_test=False, status="all", workspace_id=None):
        paging(limit, before)
        contract.choice(status, ("all", "active", "paused", "archived"), "status")
        clauses, args = [], []
        if workspace_id is not None:
            identity(workspace_id, "workspace_id")
            clauses.append("workspace_id=?")
            args.append(workspace_id)
        if not include_test:
            clauses.append("is_test=0")
        if before is not None:
            clauses.append("seq < ?")
            args.append(before)
        if status != "all":
            clauses.append("status=?")
            args.append(status)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(self.store.connect()) as conn:
            rows = conn.execute("SELECT * FROM workspaces" + where + " ORDER BY seq DESC LIMIT ?", (*args, limit+1)).fetchall()
            return {"schema_version": 1, "items": [self._workspace_view(r) for r in rows[:limit]],
                    "next_before": rows[limit-1]["seq"] if len(rows) > limit else None}

    def workspace(self, workspace_id, version=None):
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            row = self._workspace(conn, workspace_id)
            result = self._workspace_view(row)
            result["current_version"] = row["version"]
            if version is not None:
                contract.integer(version, "version", 1)
                revision = conn.execute("SELECT body,recorded_at FROM workspace_revisions WHERE workspace_id=? AND version=?", (workspace_id, version)).fetchone()
                if revision is None:
                    raise Problem("workspace_revision_not_found", "Unknown workspace revision", 404)
                result.update(json.loads(revision["body"]))
                result.update(version=version, updated_at=revision["recorded_at"])
            result["history"] = [dict(r) for r in conn.execute("SELECT version,recorded_at FROM workspace_revisions WHERE workspace_id=? ORDER BY version", (workspace_id,))]
            return result

    def _resolve_refs(self, conn, workspace_id, data):
        refs = data.get("refs", [])
        if "nodes" in data:
            refs = [n["ref"] for n in data["nodes"] if n["ref"] is not None]
        seen = set()
        for ref in refs:
            target = conn.execute("SELECT * FROM project_items WHERE workspace_id=? AND item_id=?", (workspace_id, ref["id"])).fetchone()
            if not target or target["kind"] != ref["kind"]:
                raise Problem("reference_not_found", "Reference has missing, wrong-kind or cross-workspace target", 409)
            ref.setdefault("version", target["version"])
            revision = conn.execute("SELECT body FROM project_item_revisions WHERE workspace_id=? AND item_id=? AND version=?", (workspace_id, ref["id"], ref["version"])).fetchone()
            if not revision or json.loads(revision[0])["archived"]:
                raise Problem("reference_not_found", "Referenced revision does not exist or is archived", 409)
            marker = (ref["role"], ref["id"], ref["version"])
            if marker in seen:
                # Multiple canvas nodes may intentionally show the same fact.
                continue
            seen.add(marker)
        return refs

    @staticmethod
    def _check_roles(kind, refs, data):
        rules = {
            "version": {"artifact": ("artifact",), "previous": ("version",), "stage": ("stage",)},
            "stage": {"source": ("artifact", "source"), "context": ("record",)},
            "feedback": {"version": ("version",), "evidence": ("artifact", "source"), "context": ("record", "task")},
            "plan": {"source": ("artifact", "source"), "context": ("record",)},
            "task": {"plan": ("plan",), "depends_on": ("task",), "source": ("artifact", "source")},
            "record": {"source": ("artifact", "source"), "context": contract.KINDS, "evidence": ("artifact", "source")},
            "canvas": {role: contract.KINDS for role in ("artifact", "previous", "version", "evidence", "plan", "depends_on", "source", "context", "stage")},
        }
        for ref in refs:
            if ref["kind"] not in rules.get(kind, {}).get(ref["role"], ()):
                raise Problem("invalid_reference", "Reference role does not fit this item kind")
        count = lambda role: sum(r["role"] == role for r in refs)
        if kind == "feedback" and (count("version") != 1 or (data["status"] == "addressed" and count("evidence") < 1)):
            raise Problem("evidence_required", "Feedback requires one target version; addressed feedback requires evidence")
        if kind == "task" and count("plan") != 1:
            raise Problem("invalid_reference", "A task requires exactly one plan")
        if kind == "plan" and count("source") < 1:
            raise Problem("evidence_required", "A plan requires an existing source reference")
        if kind == "version" and count("previous") > 1:
            raise Problem("invalid_reference", "A manuscript version has at most one predecessor")
        if kind == "stage" and count("source") + count("context") < 1:
            raise Problem("evidence_required", "A stage requires a source or work record")
        if kind == "version":
            if count("stage") > 1 or (data.get("stage_version") and count("stage") != 1):
                raise Problem("invalid_reference", "A milestone has at most one stage; a stage output requires one")
            Projects._artifact_references(refs)
            artifacts = {(r["id"], r["version"]) for r in refs if r["role"] == "artifact"}
            for change in data.get("changes", []):
                if (change["artifact_id"], change["artifact_version"]) not in artifacts:
                    raise Problem("invalid_reference", "Each change must name an exact artifact revision in this milestone")

    @staticmethod
    def _artifact_references(refs):
        artifacts = {}
        for ref in refs:
            if ref["role"] == "artifact":
                if ref["id"] in artifacts:
                    raise Problem("ambiguous_artifact_reference", "A manuscript version must reference each artifact ID at most once", 409)
                artifacts[ref["id"]] = ref["version"]
        return artifacts

    @staticmethod
    def _stage_output(conn, workspace_id, item):
        # BEGIN IMMEDIATE in _operation serializes competing output designations.
        if item["archived"] or not item["data"].get("stage_version"):
            return
        stage_id = next(r["id"] for r in item["data"]["refs"] if r["role"] == "stage")
        rows = conn.execute("SELECT r.body FROM project_items p JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version WHERE p.workspace_id=? AND p.kind='version' AND p.archived=0 AND p.item_id<>?", (workspace_id, item["id"])).fetchall()
        for row in rows:
            data = json.loads(row[0])["data"]
            if data.get("stage_version") and any(r["id"] == stage_id and r["role"] == "stage" for r in data["refs"]):
                raise Problem("stage_output_conflict", "Stage already has an active output; clear its designation before replacing it", 409)

    @staticmethod
    def _task_cycles(conn, workspace_id, item_id, refs):
        rows = conn.execute("SELECT p.item_id,r.body FROM project_items p JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version WHERE p.workspace_id=? AND p.kind='task'", (workspace_id,)).fetchall()
        graph = {r["item_id"]: [v["id"] for v in json.loads(r["body"])["data"]["refs"] if v["role"] == "depends_on"] for r in rows}
        graph[item_id] = [r["id"] for r in refs if r["role"] == "depends_on"]
        pending, seen = list(graph[item_id]), set()
        while pending:
            current = pending.pop()
            if current == item_id:
                raise Problem("dependency_cycle", "Task dependencies must not form a cycle", 409)
            if current not in seen:
                seen.add(current)
                pending.extend(graph.get(current, []))

    def _insert_item(self, conn, workspace_id, item, expected_version, at):
        item = json.loads(canonical(item))
        item_id, kind = item["id"], item["kind"]
        old = conn.execute("SELECT * FROM project_items WHERE workspace_id=? AND item_id=?", (workspace_id, item_id)).fetchone()
        if expected_version != (old["version"] if old else 0):
            raise Problem("version_conflict", "Item changed; reload before saving", 409)
        if old and old["kind"] != kind:
            raise Problem("immutable_identity", "Item kind cannot change", 409)
        refs = self._resolve_refs(conn, workspace_id, item["data"])
        self._check_roles(kind, refs, item["data"])
        if any(r["id"] == item_id for r in refs):
            raise Problem("invalid_reference", "An item cannot reference itself", 409)
        if kind == "task":
            self._task_cycles(conn, workspace_id, item_id, refs)
        if kind == "version":
            self._stage_output(conn, workspace_id, item)
        if kind == "version" and old:
            old_data = json.loads(conn.execute("SELECT body FROM project_item_revisions WHERE workspace_id=? AND item_id=? AND version=?", (workspace_id, item_id, old["version"])).fetchone()[0])["data"]
            previous = lambda d: [r for r in d["refs"] if r["role"] == "previous"]
            if previous(old_data) != previous(item["data"]):
                raise Problem("immutable_lineage", "A manuscript version predecessor cannot be rewritten", 409)
        change_ids = item["data"].get("change_ids", [])
        workspace = self._workspace(conn, workspace_id)
        for change_id in change_ids:
            evidence = conn.execute("SELECT d.is_test FROM changes c JOIN discoveries d USING(record_id) WHERE c.change_id=?", (change_id,)).fetchone()
            if not evidence or evidence[0] != workspace["is_test"]:
                raise Problem("invalid_reference", "Change must exist and have matching test classification", 409)
        body = canonical(item)
        if old:
            previous = conn.execute("SELECT body FROM project_item_revisions WHERE workspace_id=? AND item_id=? AND version=?", (workspace_id, item_id, old["version"])).fetchone()[0]
            if previous == body:
                return {"id": item_id, "kind": kind, "version": old["version"]}, True
        version = old["version"]+1 if old else 1
        if old:
            conn.execute("UPDATE project_items SET title=?,archived=?,version=?,updated_at=? WHERE workspace_id=? AND item_id=?", (item["title"], int(item["archived"]), version, at, workspace_id, item_id))
        else:
            conn.execute("INSERT INTO project_items(workspace_id,item_id,kind,title,archived,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", (workspace_id, item_id, kind, item["title"], int(item["archived"]), version, at, at))
        conn.execute("INSERT INTO project_item_revisions(workspace_id,item_id,version,body,recorded_at) VALUES(?,?,?,?,?)", (workspace_id, item_id, version, body, at))
        for role, target_id, target_version in {(r["role"], r["id"], r["version"]) for r in refs}:
            conn.execute("INSERT INTO project_item_links VALUES(?,?,?,?,?,?)", (workspace_id, item_id, version, target_id, target_version, role))
        for change_id in change_ids:
            conn.execute("INSERT INTO project_change_links VALUES(?,?,?,?)", (workspace_id, item_id, version, change_id))
        return {"id": item_id, "kind": kind, "version": version}, False

    def save_item(self, workspace_id, value, expected_kind=None):
        identity(workspace_id, "workspace_id")
        contract.envelope(value, "item")
        data = json.loads(canonical(value["item"]))
        contract.item(data)
        if expected_kind is not None and data["kind"] != expected_kind:
            raise Problem("invalid_input", "Item kind and collection differ")
        def save(conn, at):
            self._workspace(conn, workspace_id)
            return self._insert_item(conn, workspace_id, data, value["expected_version"], at)
        return self._operation("item.save", workspace_id, value, save)

    @staticmethod
    def _item_view(row):
        result = json.loads(row["body"])
        result.update(schema_version=1, workspace_id=row["workspace_id"], version=row["version"],
                      sequence=row["seq"], recorded_at=row["recorded_at"])
        if result["kind"] == "feedback":
            result["adoption_verification"] = "producer_declared_not_authenticated"
        return result

    def list_items(self, workspace_id=None, kind=None, limit=30, before=None, include_archived=False, include_test=False, q=None):
        paging(limit, before)
        if kind is not None:
            contract.choice(kind, contract.KINDS, "kind")
        clauses, args = [], []
        if workspace_id is not None:
            identity(workspace_id, "workspace_id")
            clauses.append("p.workspace_id=?")
            args.append(workspace_id)
        if kind is not None:
            clauses.append("p.kind=?")
            args.append(kind)
        if not include_archived:
            clauses.append("p.archived=0")
        if not include_test:
            clauses.append("w.is_test=0")
        if before is not None:
            clauses.append("p.seq < ?")
            args.append(before)
        if q is not None:
            contract.text(q, "q", 200, empty=False)
            clauses.append("(p.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\')")
            term = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            args.extend((term, term))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            if workspace_id is not None:
                self._workspace(conn, workspace_id)
            rows = conn.execute("SELECT p.seq,p.workspace_id,p.version,r.body,r.recorded_at FROM project_items p JOIN workspaces w ON w.workspace_id=p.workspace_id JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version" + where + " ORDER BY p.seq DESC LIMIT ?", (*args, limit+1)).fetchall()
            return {"schema_version": 1, "items": [self._item_view(r) for r in rows[:limit]],
                    "next_before": rows[limit-1]["seq"] if len(rows) > limit else None,
                    "search_scope": "registered_metadata_and_bounded_source_snapshots" if q else None}

    def item(self, workspace_id, item_id, version=None, expected_kind=None):
        identity(item_id, "item_id")
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            self._workspace(conn, workspace_id)
            current = conn.execute("SELECT * FROM project_items WHERE workspace_id=? AND item_id=?", (workspace_id, item_id)).fetchone()
            if current is None or (expected_kind is not None and current["kind"] != expected_kind):
                raise Problem("item_not_found", "Unknown item in this collection", 404)
            if version is not None:
                contract.integer(version, "version", 1)
            row = conn.execute("SELECT p.seq,r.workspace_id,r.version,r.body,r.recorded_at FROM project_item_revisions r JOIN project_items p USING(workspace_id,item_id) WHERE r.workspace_id=? AND r.item_id=? AND r.version=?", (workspace_id, item_id, version or current["version"])).fetchone()
            if row is None:
                raise Problem("item_not_found", "Unknown item revision", 404)
            result = self._item_view(row)
            result["current_version"] = current["version"]
            result["history"] = [dict(r) for r in conn.execute("SELECT version,recorded_at FROM project_item_revisions WHERE workspace_id=? AND item_id=? ORDER BY version", (workspace_id, item_id))]
            if result["kind"] == "task":
                unresolved = []
                for ref in result["data"]["refs"]:
                    if ref["role"] == "depends_on":
                        dependency = conn.execute("SELECT r.body FROM project_items p JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version WHERE p.workspace_id=? AND p.item_id=?", (workspace_id, ref["id"])).fetchone()
                        if json.loads(dependency[0])["data"]["status"] != "done":
                            unresolved.append(ref["id"])
                result["dependencies_not_done"] = unresolved
            return result

    def refresh(self, workspace_id, value):
        contract.envelope(value, "filenames")
        filenames = contract.array(value["filenames"], "filenames", 4)
        if not filenames or any(not isinstance(name, str) or name not in SOURCE_NAMES for name in filenames) or len(set(filenames)) != len(filenames):
            raise Problem("invalid_input", "Select unique README.md/PLAN.md/HISTORY.md/AGENTS.md filenames")
        def read(conn, at):
            workspace = self._workspace(conn, workspace_id)
            if value["expected_version"] != workspace["version"]:
                raise Problem("version_conflict", "Workspace changed; reload first", 409)
            root = json.loads(workspace["body"])["root_path"]
            resources = []
            for filename in filenames:
                data = inspect_file(root, filename, source=True)
                data["read_at"] = at
                data["interpretation"] = "not_performed"
                item = {"id": "source-"+uuid.uuid4().hex, "kind": "source", "title": filename, "archived": False, "data": data}
                resources.append(self._insert_item(conn, workspace_id, item, 0, at)[0])
            return {"kind": "source_refresh", "items": resources}, False
        return self._operation("sources.refresh", workspace_id, value, read)

    def inspect_artifact(self, workspace_id, item_id, version=None):
        from .store import now
        artifact = self.item(workspace_id, item_id, version, "artifact")
        workspace = self.workspace(workspace_id)
        data = artifact["data"]
        result = inspect_file(workspace["root_path"], data["relative_path"], data["expected_sha256"])
        result.update(schema_version=1, workspace_id=workspace_id, item_id=item_id, version=artifact["version"], checked_at=now())
        return result

    def preview_artifact(self, workspace_id, item_id, version=None):
        from .store import now
        artifact = self.item(workspace_id, item_id, version, "artifact")
        workspace = self.workspace(workspace_id)
        result = preview_file(workspace["root_path"], artifact["data"]["relative_path"], artifact["data"]["expected_sha256"])
        result.update(schema_version=1, checked_at=now(), workspace_id=workspace_id, item_id=item_id, version=artifact["version"])
        return result

    def overview(self, workspace_id):
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            workspace = self._workspace_view(self._workspace(conn, workspace_id))
            counts = {r[0]: r[1] for r in conn.execute("SELECT kind,count(*) FROM project_items WHERE workspace_id=? AND archived=0 GROUP BY kind", (workspace_id,))}
            rows = conn.execute("SELECT p.seq,p.workspace_id,p.version,r.body,r.recorded_at FROM project_items p JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version WHERE p.workspace_id=? AND p.archived=0 ORDER BY r.revision_seq DESC LIMIT 10", (workspace_id,)).fetchall()
            return {"schema_version": 1, "workspace": workspace, "counts": counts,
                    "recent_items": [self._item_view(r) for r in rows],
                    "facts": "source_files_remain_authoritative", "automatically_inferred_status": False}

    def board(self, workspace_id, limit=30, before=None):
        """One SQLite read snapshot, exact revisions, no filesystem reads or sample fallback."""
        paging(limit, before)
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            workspace = self._workspace_view(self._workspace(conn, workspace_id))
            select = "SELECT p.seq,p.workspace_id,p.version,r.body,r.recorded_at FROM project_items p JOIN project_item_revisions r ON r.workspace_id=p.workspace_id AND r.item_id=p.item_id AND r.version=p.version WHERE p.workspace_id=? AND p.archived=0"
            stage_rows = conn.execute(select + " AND p.kind='stage' ORDER BY p.seq LIMIT 101", (workspace_id,)).fetchall()
            stage_views = [self._item_view(r) for r in stage_rows[:100]]
            stage_views.sort(key=lambda s: (s["data"]["date"] is None, s["data"]["date"] or "", s["id"]))
            cursor = " AND p.seq<?" if before is not None else ""
            args = (workspace_id, before, limit+1) if before is not None else (workspace_id, limit+1)
            rows = conn.execute(select + " AND p.kind='version'" + cursor + " ORDER BY p.seq DESC LIMIT ?", args).fetchall()

            def pinned(ref):
                row = conn.execute("SELECT p.seq,r.workspace_id,r.version,r.body,r.recorded_at,p.version AS current_version,p.archived AS current_archived FROM project_item_revisions r JOIN project_items p USING(workspace_id,item_id) WHERE r.workspace_id=? AND r.item_id=? AND r.version=?", (workspace_id, ref["id"], ref["version"])).fetchone()
                result = self._item_view(row)
                result.update(current_version=row["current_version"], current_archived=bool(row["current_archived"]))
                return result

            milestones = []
            for row in rows[:limit]:
                version = self._item_view(row)
                data = version["data"]
                stage_ref = next((r for r in data["refs"] if r["role"] == "stage"), None)
                files = [pinned(r) for r in data["refs"] if r["role"] == "artifact"]
                milestones.append({"version": version, "stage": pinned(stage_ref) if stage_ref else None,
                                   "occurred_on": data.get("occurred_on"),
                                   "date_status": "known" if data.get("occurred_on") else "unknown",
                                   "milestone_status": data.get("milestone_status", "recorded"),
                                   "stage_version": data.get("stage_version", False),
                                   "files": files, "storage": "reference_only",
                                   "file_verification": "not_performed",
                                   "changes": data.get("changes", []),
                                   "changes_status": "producer_declared_not_authenticated" if data.get("changes") else "not_recorded"})
            return {"schema_version": 1, "workspace": workspace, "stages": stage_views,
                    "stages_truncated": len(stage_rows) > 100,
                    "milestones": milestones,
                    "next_before": rows[limit-1]["seq"] if len(rows) > limit else None,
                    "ordering": "milestone_registration_sequence_desc",
                    "automatically_inferred_status": False}

    def compare_versions(self, workspace_id, left_id, right_id, left_artifact=None, right_artifact=None):
        # Compare the exact pinned artifact revisions, not generated manuscript prose.
        left = self.item(workspace_id, left_id, expected_kind="version")
        right = self.item(workspace_id, right_id, expected_kind="version")
        # Old accepted bodies can also contain ambiguous references; fail explicitly.
        extract = lambda item: self._artifact_references(item["data"]["refs"])
        a, b = extract(left), extract(right)
        result = {"schema_version": 1, "left": left, "right": right,
                "added": sorted(b.keys()-a.keys()), "removed": sorted(a.keys()-b.keys()),
                "changed_references": sorted(k for k in a.keys() & b.keys() if a[k] != b[k]),
                "comparison_scope": "registered_artifact_references_only", "document_text_diff": "not_performed"}
        if left_artifact is not None or right_artifact is not None:
            if left_artifact not in a or right_artifact not in b:
                raise Problem("invalid_reference", "Choose an artifact pinned by each selected manuscript version")
            first = self.preview_artifact(workspace_id, left_artifact, a[left_artifact])
            second = self.preview_artifact(workspace_id, right_artifact, b[right_artifact])
            if any(p["preview_status"] != "ready" or p["hash_match"] is not True for p in (first, second)):
                result["document_text_diff"] = "historical_content_unverifiable"
                result["preview_states"] = [first["preview_status"], second["preview_status"]]
            else:
                lines = list(difflib.unified_diff(first["text"].splitlines(), second["text"].splitlines(), fromfile=left_id, tofile=right_id, lineterm=""))
                result.update(document_text_diff="ready", diff_lines=lines[:300],
                              diff_truncated=len(lines)>300 or first["truncated"] or second["truncated"],
                              comparison_scope="bounded_plain_text_of_hash_matched_files")
        return result
