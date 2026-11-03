"""Attention state references committed discoveries; it never changes project facts."""
import hashlib
import json
from contextlib import closing

from .contracts import Problem, canonical, identity, obj


SCHEMA = """
CREATE TABLE IF NOT EXISTS changes (
    change_id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES discoveries(record_id),
    root_id TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('normal','high')),
    version INTEGER NOT NULL,
    latest_seq INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('open','known','later')),
    state_version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_versions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id TEXT NOT NULL REFERENCES changes(change_id),
    version INTEGER NOT NULL,
    record_id TEXT NOT NULL REFERENCES discoveries(record_id),
    priority TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE(change_id, version)
);
CREATE TABLE IF NOT EXISTS change_operations (
    kind TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    digest TEXT NOT NULL,
    receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id),
    PRIMARY KEY(kind, operation_key)
);
CREATE INDEX IF NOT EXISTS changes_state_sequence ON changes(state, latest_seq);
CREATE INDEX IF NOT EXISTS changes_sequence ON changes(latest_seq);
"""


def validate(value, action=False):
    fields = (("schema_version", "action_key", "expected_version", "expected_state_version", "state") if action
              else ("schema_version", "delivery_key", "change_id", "record_id", "expected_version", "priority"))
    obj(value, fields, fields, "change state" if action else "change")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise Problem("unsupported_version", "schema_version must be 1")
    for name in (("action_key",) if action else ("delivery_key", "change_id", "record_id")):
        identity(value[name], name)
    for name in (("expected_version", "expected_state_version") if action else ("expected_version",)):
        if type(value[name]) is not int or not 0 <= value[name] <= 2147483647:
            raise Problem("invalid_input", name + " must be a nonnegative integer")
    if action:
        if value["state"] not in ("open", "known", "later"):
            raise Problem("invalid_input", "state must be open/known/later")
    elif value["priority"] not in ("normal", "high"):
        raise Problem("invalid_input", "priority must be normal/high")


class Changes:
    def __init__(self, store):
        self.store = store

    def _write(self, value, change_id=None):
        from .store import now
        action = change_id is not None
        validate(value, action)
        if action:
            identity(change_id, "change_id")
        else:
            change_id = value["change_id"]
        kind = "state" if action else "publish"
        key = value["action_key" if action else "delivery_key"]
        digest = hashlib.sha256(canonical({"change_id": change_id, "body": value}).encode()).hexdigest()
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute("SELECT * FROM change_operations WHERE kind=? AND operation_key=?", (kind, key)).fetchone()
            if prior:
                if prior["digest"] != digest:
                    raise Problem("operation_conflict", "Operation key already used for different content", 409)
                receipt = json.loads(conn.execute("SELECT body FROM receipts WHERE receipt_id=?", (prior["receipt_id"],)).fetchone()[0])
                return 200, receipt  # Return the original durable result, without replaying a state change.
            event = conn.execute("SELECT * FROM changes WHERE change_id=?", (change_id,)).fetchone()
            if action and not event:
                raise Problem("change_not_found", "Unknown change", 404)
            current = event["version"] if event else 0
            if value["expected_version"] != current:
                raise Problem("change_conflict", "Change version changed; reload before acting", 409)
            at = now()
            if action:
                if value["expected_state_version"] != event["state_version"]:
                    raise Problem("state_conflict", "Attention state changed; reload before acting", 409)
                duplicate = event["state"] == value["state"]
                if not duplicate:
                    conn.execute("UPDATE changes SET state=?,state_version=state_version+1,updated_at=? WHERE change_id=?",
                                 (value["state"], at, change_id))
            else:
                record = conn.execute("SELECT * FROM discoveries WHERE record_id=?", (value["record_id"],)).fetchone()
                if not record:
                    raise Problem("evidence_not_found", "Publish the discovery before referencing it", 409)
                if event and event["root_id"] != record["root_id"]:
                    raise Problem("incompatible_change", "Updates must reference the same discovery revision chain", 409)
                if event:
                    previous = conn.execute("SELECT seq FROM discoveries WHERE record_id=?", (event["record_id"],)).fetchone()[0]
                    if record["seq"] < previous:
                        raise Problem("stale_evidence", "Cannot move an event back to older evidence", 409)
                duplicate = bool(event and event["record_id"] == value["record_id"] and event["priority"] == value["priority"])
                if not duplicate:
                    version = current + 1
                    if not event:
                        conn.execute("INSERT INTO changes VALUES(?,?,?,?,?,0,'open',1,?)",
                                     (change_id, value["record_id"], record["root_id"], value["priority"], version, at))
                    seq = conn.execute("INSERT INTO change_versions(change_id,version,record_id,priority,received_at) VALUES(?,?,?,?,?)",
                                       (change_id, version, value["record_id"], value["priority"], at)).lastrowid
                    if event:
                        conn.execute("UPDATE changes SET record_id=?,priority=?,version=?,latest_seq=?,state='open',state_version=state_version+1,updated_at=? WHERE change_id=?",
                                     (value["record_id"], value["priority"], version, seq, at, change_id))
                    else:
                        conn.execute("UPDATE changes SET latest_seq=? WHERE change_id=?", (seq, change_id))
            event = conn.execute("SELECT * FROM changes WHERE change_id=?", (change_id,)).fetchone()
            receipt = self.store._receipt("duplicate" if duplicate else "accepted", event["record_id"], key, digest)
            receipt.update({"change_id": change_id, "version": event["version"], "state": event["state"],
                            "state_version": event["state_version"], "operation": kind})
            # Explicitly describe this transaction; discovery was committed earlier.
            receipt["persistence"] = {"receipt": True, "change": True}
            status = 200 if action or duplicate else 201
            self.store._save_receipt(conn, receipt, status)
            conn.execute("INSERT INTO change_operations VALUES(?,?,?,?)", (kind, key, digest, receipt["receipt_id"]))
            if self.store.fault:
                self.store.fault("before_change_commit")
            conn.commit()
            if self.store.fault:
                self.store.fault("after_change_commit")
            return status, receipt

    def publish(self, value):
        return self._write(value)

    def set_state(self, change_id, value):
        return self._write(value, change_id)

    def delivery(self, key):
        with closing(self.store.connect()) as conn:
            row = conn.execute("SELECT r.body FROM change_operations o JOIN receipts r USING(receipt_id) WHERE o.kind='publish' AND o.operation_key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def _view(self, conn, event):
        row = conn.execute("SELECT * FROM discoveries WHERE record_id=?", (event["record_id"],)).fetchone()
        result = dict(event)
        result["discovery"] = self.store.view(row)
        result["schema_version"] = 1
        return result

    def detail(self, change_id):
        with closing(self.store.connect()) as conn:
            # A read transaction keeps event, evidence and history from mixed revisions.
            conn.execute("BEGIN")
            event = conn.execute("SELECT * FROM changes WHERE change_id=?", (change_id,)).fetchone()
            if event is None:
                return None
            result = self._view(conn, event)
            result["history"] = [dict(r) for r in conn.execute("SELECT version,record_id,priority,received_at FROM change_versions WHERE change_id=? ORDER BY version", (change_id,))]
            return result

    def list(self, limit=30, before=None, include_test=False, state="open"):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise Problem("invalid_query", "limit must be 1..100", 400)
        if before is not None and (type(before) is not int or before < 1):
            raise Problem("invalid_query", "before must be positive", 400)
        if state not in ("open", "known", "later", "all"):
            raise Problem("invalid_query", "Invalid attention state", 400)
        clauses, args = [], []
        if state != "all":
            clauses.append("c.state=?")
            args.append(state)
        if not include_test:
            clauses.append("d.is_test=0")
        if before is not None:
            clauses.append("c.latest_seq < ?")
            args.append(before)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(self.store.connect()) as conn:
            conn.execute("BEGIN")
            rows = conn.execute("SELECT c.* FROM changes c JOIN discoveries d USING(record_id)" + where + " ORDER BY c.latest_seq DESC LIMIT ?", (*args, limit + 1)).fetchall()
            return {"schema_version": 1, "items": [self._view(conn, r) for r in rows[:limit]],
                    "next_before": rows[limit-1]["latest_seq"] if len(rows) > limit else None,
                    "order": "latest_change_sequence_desc", "state": state}
