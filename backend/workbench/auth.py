"""Persistent browser sessions and least-privilege project credentials.

Auth state is separate from project backups. Only hashes reach SQLite; local
Agent secrets live outside projects, protected by DPAPI on Windows.
"""
import ctypes
import hashlib
import json
import os
import secrets
import sqlite3
import time
import threading
import uuid
from contextlib import closing
from pathlib import Path

from .contracts import Problem, identity

DAY = 86400


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def seal(data, decrypt=False):
    if os.name != "nt":
        return data  # private_write uses owner-only mode on POSIX.
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError("User credential protection failed")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


class AuthStore:
    def __init__(self, data_dir, clock=time.time):
        self.data = Path(data_dir).resolve()
        self.data.mkdir(parents=True, exist_ok=True)
        self.path = self.data / "auth.sqlite3"
        self.clock = clock
        self.provision_lock = threading.Lock()
        with closing(self.connect()) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS credentials(
                    id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
                    workspace_id TEXT, permissions TEXT NOT NULL, label TEXT NOT NULL,
                    created REAL NOT NULL, last_used REAL NOT NULL, idle REAL NOT NULL,
                    expires REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
            """)
            db.execute("INSERT OR IGNORE INTO metadata VALUES('service_id',?)", (uuid.uuid4().hex,))
            db.commit()
            self.service_id = db.execute("SELECT value FROM metadata WHERE key='service_id'").fetchone()[0]
        self.cookie_name = "wb_" + self.service_id

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def issue(self, kind, workspace_id=None, permissions="read", label="Browser", idle_days=30, lifetime_days=90):
        if kind not in ("session", "project") or permissions not in ("read", "write"):
            raise Problem("invalid_credential", "Unsupported credential type or permissions", 400)
        if kind == "project":
            identity(workspace_id, "workspace_id")
        for number in (idle_days, lifetime_days):
            if type(number) is not int or not 1 <= number <= 365:
                raise Problem("invalid_expiry", "Expiry must be 1..365 days", 400)
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 100:
            raise Problem("invalid_label", "Label must be 1..100 characters", 400)
        token, key, at = secrets.token_urlsafe(32), uuid.uuid4().hex, self.clock()
        with closing(self.connect()) as db:
            db.execute("INSERT INTO credentials VALUES(?,?,?,?,?,?,?,?,?,?,0)",
                       (key, self.digest(token), kind, workspace_id, permissions, label.strip(), at, at,
                        idle_days * DAY, at + lifetime_days * DAY))
            db.commit()
        return token, key

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def authenticate(self, token, kind, touch=True):
        at = self.clock()
        with closing(self.connect()) as db:
            # Serialize the expiry check and renewal; expired tokens never revive.
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM credentials WHERE digest=? AND kind=?", (self.digest(token), kind)).fetchone()
            if row is None or row["revoked"] or at >= min(row["expires"], row["last_used"] + row["idle"]):
                raise Problem("unauthorized", "Credential expired, revoked or unknown", 401)
            if touch:
                db.execute("UPDATE credentials SET last_used=? WHERE id=?", (at, row["id"]))
            db.commit()
            return dict(row)

    def list(self, kind="project"):
        with closing(self.connect()) as db:
            rows = db.execute("SELECT id,kind,workspace_id,permissions,label,created,last_used,idle,expires,revoked FROM credentials WHERE kind=? ORDER BY created DESC", (kind,)).fetchall()
        at = self.clock()
        return [dict(row, active=not row["revoked"] and at < min(row["expires"], row["last_used"] + row["idle"])) for row in rows]

    def revoke(self, key):
        with closing(self.connect()) as db:
            db.execute("UPDATE credentials SET revoked=1 WHERE id=?", (key,))
            db.commit()
        (self.data / "credentials" / (key + ".secret")).unlink(missing_ok=True)

    def provision(self, workspace, label, permissions, idle_days=90, lifetime_days=365):
        with self.provision_lock:
            return self._provision(workspace, label, permissions, idle_days, lifetime_days)

    def _provision(self, workspace, label, permissions, idle_days, lifetime_days):
        root = Path(workspace["root_path"]).resolve(strict=True)
        if not root.is_dir():
            raise Problem("invalid_project_root", "Registered project directory is unavailable", 409)
        folder = root / ".workbench"
        folder.mkdir(exist_ok=True)
        if folder.is_symlink() or folder.resolve() != folder or (hasattr(folder, "is_junction") and folder.is_junction()):
            raise Problem("unsafe_config_path", "Project config directory must not redirect elsewhere", 409)
        path = folder / "project.json"
        if path.exists():
            if path.is_symlink() or path.stat().st_size > 8192:
                raise Problem("unsafe_config_path", "Existing project config must be a bounded regular file", 409)
            old = json.loads(path.read_text(encoding="utf-8"))
            if old.get("service_id") != self.service_id or old.get("workspace_id") != workspace["id"]:
                raise Problem("config_conflict", "Existing config belongs to another service or project", 409)
        token, key = self.issue("project", workspace["id"], permissions, label, idle_days, lifetime_days)
        temporary = folder / (uuid.uuid4().hex + ".tmp")
        try:
            private_write(self.data / "credentials" / (key + ".secret"), seal(token.encode("ascii")))
            config = {"schema_version": 1, "service_id": self.service_id, "workspace_id": workspace["id"],
                      "credential_id": key, "data_dir": str(self.data)}
            private_write(temporary, (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
            os.replace(temporary, path)
            # Replacing the project's entry also revokes the previous credential.
            if 'old' in locals():
                old_key = old.get("credential_id", "")
                if isinstance(old_key, str) and len(old_key) == 32 and all(c in "0123456789abcdef" for c in old_key):
                    self.revoke(old_key)
            return {"credential_id": key, "config_path": str(path), "workspace_id": workspace["id"]}
        except Exception:
            self.revoke(key)
            raise
        finally:
            temporary.unlink(missing_ok=True)


def authorize(principal, method, path, query, projects, value=None):
    """Default deny. All project route entry points share this check."""
    if principal["kind"] != "project":
        return
    wid = principal["workspace_id"]
    parts = path.strip("/").split("/")
    if method == "GET" and path in ("/v1/health", "/v1/capabilities", "/v1/runtime"):
        return
    if method == "GET" and path in ("/v1/search", "/v1/project-items", "/v1/workspaces"):
        if "workspace_id" in query and query["workspace_id"] != [wid]:
            raise Problem("forbidden", "Credential is limited to its project", 403)
        query["workspace_id"] = [wid]
        return
    if method == "GET" and parts[:2] == ["v1", "project-operations"] and len(parts) == 3:
        receipt = projects.operation(parts[2])
        if receipt is None or receipt.get("workspace_id") != wid:
            raise Problem("not_found", "Operation not found in this project", 404)
        return
    if method == "GET" and parts[:2] == ["v1", "receipts"] and len(parts) == 3:
        receipt = projects.store.receipt(parts[2])
        if receipt is None or receipt.get("workspace_id") != wid:
            raise Problem("not_found", "Receipt not found in this project", 404)
        return
    if parts[:2] == ["v1", "workspaces"] and len(parts) >= 3 and parts[2] == wid:
        if method == "GET":
            return
        # Project credentials cannot register/edit roots or link global attention.
        from .project_contracts import COLLECTIONS
        if method == "POST" and len(parts) == 4 and parts[3] in (*COLLECTIONS, "refresh") and principal["permissions"] == "write":
            item = value.get("item") if isinstance(value, dict) else None
            data = item.get("data") if isinstance(item, dict) else None
            if isinstance(data, dict) and data.get("change_ids"):
                raise Problem("forbidden", "Global attention links require management access", 403)
            return
    raise Problem("forbidden", "Credential does not grant this operation", 403)
