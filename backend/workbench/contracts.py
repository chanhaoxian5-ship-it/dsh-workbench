"""Strict, versioned input validation. All producer verification is a claim."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import PureWindowsPath

MAX_BODY = 131072
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
SHA = re.compile(r"[a-fA-F0-9]{64}\Z")


class Problem(Exception):
    def __init__(self, code, message, status=422, retryable=False):
        super().__init__(message)
        self.code, self.message, self.status, self.retryable = code, message, status, retryable


def obj(value, keys, required, field):
    if not isinstance(value, dict):
        raise Problem("invalid_input", f"{field} must be an object")
    if set(value) - set(keys) or set(required) - set(value):
        raise Problem("invalid_input", f"{field}: unknown or missing fields")
    return value


def string(value, field, limit=512, nullable=False):
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any((ord(c) < 32 and c not in "\n\t\r") or 0xD800 <= ord(c) <= 0xDFFF for c in value):
        raise Problem("invalid_input", f"{field}: expected nonempty string, max {limit}")
    return value


def identity(value, field):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Problem("invalid_input", f"{field}: invalid identifier")
    return value


def timestamp(value, field):
    string(value, field, 64)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None:
            raise ValueError()
        return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")
    except (ValueError, OverflowError):
        raise Problem("invalid_input", f"{field}: ISO 8601 timestamp with timezone required") from None


def local_path(value, field):
    if value is None:
        return None
    string(value, field, 2048)
    path = PureWindowsPath(value)
    if (not path.is_absolute() or not re.fullmatch(r"[A-Za-z]:", path.drive)
            or ".." in path.parts or any(c in value[2:] for c in ':*?<>|"\n\r\t')
            or any(PureWindowsPath(part).is_reserved() for part in path.parts[1:])
            or any(part.endswith((".", " ")) for part in path.parts[1:])):
        raise Problem("invalid_path", f"{field}: absolute local drive path required; no UNC/device/traversal/ADS")
    return str(path)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def validate(value):
    obj(value, ("schema_version", "delivery_key", "discovery"), ("schema_version", "delivery_key", "discovery"), "request")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise Problem("unsupported_version", "schema_version must be 1")
    key = identity(value["delivery_key"], "delivery_key")
    raw = value["discovery"]
    fields = ("record_id", "revision_of", "title", "excerpt", "interpretation", "generated_at", "is_test", "source", "producer", "verification")
    obj(raw, fields, set(fields) - {"revision_of"}, "discovery")
    d = dict(raw)
    identity(d["record_id"], "record_id")
    d["revision_of"] = raw.get("revision_of")
    if d["revision_of"] is not None:
        identity(d["revision_of"], "revision_of")
    for field, limit in (("title", 300), ("excerpt", 16000), ("interpretation", 16000)):
        string(d[field], field, limit)
    d["generated_at"] = timestamp(d["generated_at"], "generated_at")
    if type(d["is_test"]) is not bool:
        raise Problem("invalid_input", "is_test must be boolean")
    s = dict(obj(d["source"], ("type", "parent_key", "attachment_key", "sha256", "pdf_page", "printed_page", "local_path"), ("type",), "source"))
    if s["type"] not in ("zotero_pdf", "local_pdf", "unknown"):
        raise Problem("invalid_input", "unsupported source.type")
    for field in ("parent_key", "attachment_key", "sha256", "pdf_page", "printed_page", "local_path"):
        s.setdefault(field, None)
    for field in ("parent_key", "attachment_key"):
        if s[field] is not None:
            identity(s[field], field)
    if s["sha256"] is not None:
        if not isinstance(s["sha256"], str) or not SHA.fullmatch(s["sha256"]):
            raise Problem("invalid_input", "sha256 must contain all 64 hex characters")
        s["sha256"] = s["sha256"].lower()
    if s["pdf_page"] is not None and (type(s["pdf_page"]) is not int or not 1 <= s["pdf_page"] <= 1000000):
        raise Problem("invalid_input", "pdf_page must be a positive 1-based PDF page index")
    string(s["printed_page"], "printed_page", 64, nullable=True)
    s["local_path"] = local_path(s["local_path"], "source.local_path")
    d["source"] = s
    pfields = ("harness", "profile", "working_directory", "run_id", "production_session_id", "main_session_id", "main_session_title")
    p = dict(obj(d["producer"], pfields, set(pfields) - {"main_session_title"}, "producer"))
    for field in ("harness", "profile", "run_id", "production_session_id", "main_session_id"):
        identity(p[field], "producer." + field)
    p["working_directory"] = local_path(p["working_directory"], "producer.working_directory")
    if p["working_directory"] is None:
        raise Problem("invalid_input", "producer.working_directory required")
    p.setdefault("main_session_title", None)
    string(p["main_session_title"], "main_session_title", 300, nullable=True)
    d["producer"] = p
    v = dict(obj(d["verification"], ("mechanical", "semantic"), ("mechanical", "semantic"), "verification"))
    m = dict(obj(v["mechanical"], ("status", "scope", "evidence"), ("status", "scope", "evidence"), "mechanical"))
    if m["status"] not in ("pass", "fail", "not_checked"):
        raise Problem("invalid_input", "invalid mechanical.status")
    for field in ("scope", "evidence"):
        string(m[field], "mechanical." + field, 4000, nullable=True)
    sem = dict(obj(v["semantic"], ("status", "reviewed_by", "evidence"), ("status", "reviewed_by", "evidence"), "semantic"))
    if sem["status"] not in ("confirmed", "rejected", "not_reviewed"):
        raise Problem("invalid_input", "invalid semantic.status")
    string(sem["reviewed_by"], "reviewed_by", 300, nullable=True)
    string(sem["evidence"], "semantic.evidence", 4000, nullable=True)
    d["verification"] = {"mechanical": m, "semantic": sem}
    digest = hashlib.sha256(canonical({"schema_version": 1, "discovery": d}).encode("utf-8")).hexdigest()
    return key, d, digest
