"""SQLite is the single commit boundary for discoveries, deliveries and receipts."""
import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .contracts import Problem, canonical, timestamp, validate
from .changes import Changes, SCHEMA as CHANGE_SCHEMA
from .projects import Projects, SCHEMA as PROJECT_SCHEMA

SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class Store:
    def __init__(self, path, fault=None):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fault = fault
        with closing(self.connect()) as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2, 3):
                raise RuntimeError("Unsupported database version")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS discoveries (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_id TEXT NOT NULL UNIQUE,
                    root_id TEXT NOT NULL,
                    revision_of TEXT UNIQUE REFERENCES discoveries(record_id),
                    content_sha256 TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    is_test INTEGER NOT NULL CHECK(is_test IN (0,1)),
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS receipts (
                    receipt_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    http_status INTEGER NOT NULL,
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS deliveries (
                    delivery_key TEXT PRIMARY KEY,
                    content_sha256 TEXT NOT NULL,
                    record_id TEXT NOT NULL REFERENCES discoveries(record_id),
                    first_receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id)
                );
                CREATE INDEX IF NOT EXISTS discoveries_received ON discoveries(received_at, seq);
            """)
            conn.executescript("BEGIN IMMEDIATE;" + CHANGE_SCHEMA + PROJECT_SCHEMA + "PRAGMA user_version=3; COMMIT;")
        self.changes = Changes(self)
        self.projects = Projects(self)

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=FULL")
        return conn

    def _receipt(self, status, record_id=None, key=None, digest=None, error=None, persisted=True):
        return {
            "schema_version": 1, "receipt_id": str(uuid.uuid4()) if persisted else None,
            "status": status, "record_id": record_id, "delivery_key": key,
            "content_sha256": digest, "recorded_at": now(),
            "persistence": {"receipt": persisted, "discovery": None if status == "failed" else status in ("accepted", "duplicate")},
            "error": error,
        }

    def _save_receipt(self, conn, receipt, status):
        conn.execute("INSERT INTO receipts VALUES(?,?,?,?)", (receipt["receipt_id"], receipt["status"], status, canonical(receipt)))

    def reject(self, problem, key=None, record_id=None, digest=None):
        status = "failed" if problem.retryable else "rejected"
        err = {"code": problem.code, "message": problem.message, "retryable": problem.retryable}
        receipt = self._receipt(status, record_id, key, digest, err)
        try:
            with closing(self.connect()) as conn:
                conn.execute("BEGIN IMMEDIATE")
                self._save_receipt(conn, receipt, problem.status)
                conn.commit()
        except sqlite3.Error:
            return 503, self._receipt("failed", error={"code": "storage_unavailable", "message": "No durable receipt; retry the same delivery key", "retryable": True}, persisted=False)
        return problem.status, receipt

    def publish(self, value):
        key = d = digest = None
        try:
            key, d, digest = validate(value)
            with closing(self.connect()) as conn:
                conn.execute("BEGIN IMMEDIATE")
                delivery = conn.execute("SELECT * FROM deliveries WHERE delivery_key=?", (key,)).fetchone()
                existing = conn.execute("SELECT * FROM discoveries WHERE record_id=?", (d["record_id"],)).fetchone()
                if delivery and delivery["content_sha256"] != digest:
                    raise Problem("delivery_conflict", "delivery_key already committed with different content", 409)
                if existing and existing["content_sha256"] != digest:
                    raise Problem("record_conflict", "record_id is immutable; submit a new record_id and revision_of", 409)
                duplicate = existing is not None
                root_id = d["record_id"]
                if not duplicate:
                    target = d["revision_of"]
                    if target is not None:
                        prior = conn.execute("SELECT * FROM discoveries WHERE record_id=?", (target,)).fetchone()
                        if prior is None:
                            raise Problem("revision_not_found", "revision_of must reference an existing record", 409)
                        if conn.execute("SELECT 1 FROM discoveries WHERE revision_of=?", (target,)).fetchone():
                            raise Problem("revision_conflict", "revision_of is no longer the current revision", 409)
                        old = json.loads(prior["payload"])
                        if not self.compatible(old, d):
                            raise Problem("incompatible_revision", "source identity, main session, harness, profile, directory and test classification must match", 409)
                        root_id = prior["root_id"]
                    conn.execute("INSERT INTO discoveries(record_id,root_id,revision_of,content_sha256,received_at,is_test,payload) VALUES(?,?,?,?,?,?,?)",
                                 (d["record_id"], root_id, target, digest, now(), int(d["is_test"]), canonical(d)))
                receipt = self._receipt("duplicate" if duplicate else "accepted", d["record_id"], key, digest)
                http_status = 200 if duplicate else 201
                self._save_receipt(conn, receipt, http_status)
                if not delivery:
                    conn.execute("INSERT INTO deliveries VALUES(?,?,?,?)", (key, digest, d["record_id"], receipt["receipt_id"]))
                if self.fault:
                    self.fault("before_commit")
                conn.commit()
                # A response lost after this point is recovered with the delivery key.
                if self.fault:
                    self.fault("after_commit")
                return http_status, receipt
        except Problem as problem:
            return self.reject(problem, key, d["record_id"] if d else None, digest)
        except sqlite3.Error:
            return self.reject(Problem("storage_error", "Transaction did not confirm; retry the same delivery key", 503, True), key, d["record_id"] if d else None, digest)

    @staticmethod
    def compatible(old, new):
        return (old["is_test"] == new["is_test"]
                and all(old["source"][k] == new["source"][k] for k in ("type", "parent_key", "attachment_key", "local_path"))
                and all(old["producer"][k] == new["producer"][k] for k in ("harness", "profile", "working_directory", "main_session_id")))

    def receipt(self, receipt_id):
        with closing(self.connect()) as conn:
            row = conn.execute("SELECT body FROM receipts WHERE receipt_id=?", (receipt_id,)).fetchone()
            return json.loads(row[0]) if row else None

    def delivery(self, delivery_key):
        with closing(self.connect()) as conn:
            row = conn.execute("SELECT r.body FROM deliveries d JOIN receipts r ON r.receipt_id=d.first_receipt_id WHERE d.delivery_key=?", (delivery_key,)).fetchone()
            return json.loads(row[0]) if row else None

    @staticmethod
    def view(row):
        d = json.loads(row["payload"])
        d.update({"schema_version": 1, "root_id": row["root_id"], "sequence": row["seq"],
                  "received_at": row["received_at"], "content_sha256": row["content_sha256"]})
        d["backend_verification"] = {
            "schema": "pass", "scope": "input types, required anchors, revision and transaction constraints only",
            "source_hash": "not_checked", "excerpt_page_match": "not_checked",
            "semantic": "not_reviewed", "reviewer_authenticated": False, "verified": False,
        }
        d["session_locator"] = {"status": "manual", "harness": d["producer"]["harness"],
                                "profile": d["producer"]["profile"], "main_session_id": d["producer"]["main_session_id"],
                                "working_directory": d["producer"]["working_directory"], "url": None}
        return d

    def detail(self, record_id):
        with closing(self.connect()) as conn:
            row = conn.execute("SELECT * FROM discoveries WHERE record_id=?", (record_id,)).fetchone()
            if not row:
                return None
            d = self.view(row)
            next_row = conn.execute("SELECT record_id FROM discoveries WHERE revision_of=?", (record_id,)).fetchone()
            d["superseded_by"] = next_row[0] if next_row else None
            d["revision_history"] = [r[0] for r in conn.execute("SELECT record_id FROM discoveries WHERE root_id=? ORDER BY seq", (row["root_id"],))]
        path = d["source"]["local_path"]
        state = "not_provided"
        if path:
            if os.name != "nt":
                state = "not_checked_on_this_platform"
            else:
                try:
                    state = "exists_unverified" if Path(path).is_file() else "missing"
                except OSError:
                    state = "inaccessible"
        d["source_locator"] = {"status": state, "checked_at": now(), "file_served": False, "page_jump": "manual"}
        return d

    def list(self, limit=30, before=None, since=None, until=None, include_test=False):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise Problem("invalid_query", "limit must be between 1 and 100", 400)
        if before is not None and (type(before) is not int or before < 1):
            raise Problem("invalid_query", "before must be a positive sequence", 400)
        clauses, args = [], []
        if not include_test:
            clauses.append("is_test=0")
        for value, clause, field in ((before, "seq < ?", None), (since, "received_at >= ?", "since"), (until, "received_at < ?", "until")):
            if value is not None:
                clauses.append(clause)
                args.append(timestamp(value, field) if field else value)
        if since and until and timestamp(since, "since") >= timestamp(until, "until"):
            raise Problem("invalid_query", "since must precede until", 400)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(self.connect()) as conn:
            rows = conn.execute("SELECT * FROM discoveries" + where + " ORDER BY seq DESC LIMIT ?", (*args, limit + 1)).fetchall()
        return {"schema_version": 1, "items": [self.view(r) for r in rows[:limit]],
                "next_before": rows[limit - 1]["seq"] if len(rows) > limit else None,
                "order": "receive_sequence_desc", "time_basis": "received_at", "includes_revisions": True,
                "window": {"since": timestamp(since, "since") if since else None,
                           "until": timestamp(until, "until") if until else None}}

    def home(self, limit=30, include_test=False, at=None):
        local = (at or datetime.now(timezone.utc)).astimezone(SHANGHAI)
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        discoveries = self.list(limit=limit, since=start.isoformat(), until=(start + timedelta(days=1)).isoformat(), include_test=include_test)
        changes = self.changes.list(limit=limit, include_test=include_test)
        return {"schema_version": 1, "timezone": "Asia/Shanghai", "date": local.date().isoformat(),
                "important_changes": changes["items"], "important_changes_state": "ready",
                "important_changes_page": {"next_before": changes["next_before"], "order": changes["order"]},
                "today_discoveries": discoveries}
