"""Typed project metadata. Text is inert; references are checked in a transaction."""
import math
from datetime import date

from .contracts import SHA, Problem, identity, local_path, obj, string
from .project_files import relative_path

KINDS = ("artifact", "version", "feedback", "plan", "task", "record", "canvas", "stage", "source")
COLLECTIONS = {"artifacts": "artifact", "versions": "version", "feedback": "feedback",
               "plans": "plan", "tasks": "task", "records": "record", "canvases": "canvas", "stages": "stage", "sources": "source"}


def exact(value, fields, label):
    return obj(value, fields, fields, label)


def choice(value, values, label):
    if not isinstance(value, str) or value not in values:
        raise Problem("invalid_input", label + ": invalid choice")
    return value


def boolean(value, label):
    if type(value) is not bool:
        raise Problem("invalid_input", label + " must be boolean")


def integer(value, label, minimum=0):
    if type(value) is not int or not minimum <= value <= 2147483647:
        raise Problem("invalid_input", label + ": invalid integer")


def array(value, label, limit=100):
    if not isinstance(value, list) or len(value) > limit:
        raise Problem("invalid_input", label + ": bounded array required")
    return value


def text(value, label, limit=4000, empty=True):
    if empty and value == "":
        return value
    return string(value, label, limit)


def business_date(value, label):
    if value is None:
        return
    string(value, label, 10)
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError:
        raise Problem("invalid_input", label + " must be YYYY-MM-DD or null") from None


def envelope(value, field):
    exact(value, ("schema_version", "operation_key", "expected_version", field), "request")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise Problem("unsupported_version", "schema_version must be 1")
    identity(value["operation_key"], "operation_key")
    integer(value["expected_version"], "expected_version")


def workspace(value):
    exact(value, ("id", "name", "root_path", "kind", "view", "status", "favorite", "description", "is_test"), "workspace")
    result = dict(value)
    identity(result["id"], "workspace.id")
    string(result["name"], "name", 200)
    result["root_path"] = local_path(result["root_path"], "root_path")
    if result["root_path"] is None:
        raise Problem("invalid_path", "root_path is required")
    choice(result["kind"], ("project", "area"), "kind")
    choice(result["view"], ("paper", "plan", "software", "general"), "view")
    choice(result["status"], ("active", "paused", "archived"), "status")
    boolean(result["favorite"], "favorite")
    boolean(result["is_test"], "is_test")
    text(result["description"], "description")
    return result


def refs(value):
    for ref in array(value, "refs"):
        obj(ref, ("id", "kind", "version", "role"), ("id", "kind", "role"), "reference")
        identity(ref["id"], "ref.id")
        choice(ref["kind"], KINDS, "ref.kind")
        if "version" in ref:
            integer(ref["version"], "ref.version", 1)
        choice(ref["role"], ("artifact", "previous", "version", "evidence", "plan", "depends_on", "source", "context", "stage"), "ref.role")


def item(value, allow_source=False):
    exact(value, ("id", "kind", "title", "archived", "data"), "item")
    identity(value["id"], "item.id")
    choice(value["kind"], KINDS if allow_source else KINDS[:-1], "item.kind")
    string(value["title"], "item.title", 300)
    boolean(value["archived"], "item.archived")
    kind, data = value["kind"], value["data"]
    fields = {
        "artifact": ("relative_path", "category", "description", "expected_sha256"),
        "version": ("label", "status", "summary", "refs"),
        "feedback": ("quote", "response", "status", "location", "refs"),
        "plan": ("summary", "stage", "next_step", "refs", "change_ids"),
        "task": ("summary", "status", "due_date", "refs"),
        "record": ("summary", "stage", "next_step", "blockers", "refs", "session"),
        "canvas": ("zoom", "layer", "nodes", "edges"),
        "stage": ("status", "date", "summary", "refs"),
    }
    if kind == "source" and allow_source:
        return
    extras = ("occurred_on", "milestone_status", "stage_version", "changes") if kind == "version" else ()
    obj(data, fields[kind] + extras, fields[kind], "item.data")
    for field in ("description", "summary", "stage", "next_step", "response", "location"):
        if field in data:
            text(data[field], field, 12000 if field == "summary" else 4000)
    if "refs" in data:
        refs(data["refs"])
    if kind == "artifact":
        data["relative_path"] = relative_path(data["relative_path"])
        choice(data["category"], ("document", "figure", "table", "code", "other"), "category")
        sha = data["expected_sha256"]
        if sha is not None and (not isinstance(sha, str) or not SHA.fullmatch(sha)):
            raise Problem("invalid_input", "expected_sha256 must be a full SHA-256 or null")
        if sha:
            data["expected_sha256"] = sha.lower()
    elif kind == "version":
        string(data["label"], "label", 100)
        choice(data["status"], ("draft", "in_review", "submitted", "archived"), "version status")
        business_date(data.get("occurred_on"), "occurred_on")
        choice(data.get("milestone_status", "recorded"), ("recorded", "planned"), "milestone_status")
        boolean(data.get("stage_version", False), "stage_version")
        if data.get("stage_version") and data.get("milestone_status") == "planned":
            raise Problem("invalid_input", "A planned milestone cannot be a stage output")
        for change in array(data.get("changes", []), "changes"):
            exact(change, ("artifact_id", "artifact_version", "file", "title", "summary", "kind", "source", "note"), "change")
            identity(change["artifact_id"], "change.artifact_id")
            integer(change["artifact_version"], "change.artifact_version", 1)
            string(change["file"], "change.file", 2048)
            string(change["title"], "change.title", 300)
            string(change["summary"], "change.summary", 12000)
            choice(change["kind"], ("semantic", "format", "mixed"), "change.kind")
            choice(change["source"], ("agent", "user"), "change.source")
            if change["note"] is not None:
                string(change["note"], "change.note", 12000)
    elif kind == "stage":
        choice(data["status"], ("completed", "current", "planned", "unknown"), "stage status")
        business_date(data["date"], "stage date")
    elif kind == "feedback":
        string(data["quote"], "quote", 12000)
        choice(data["status"], ("pending", "in_progress", "addressed", "rejected"), "feedback status")
        if data["status"] == "addressed" and (not data["response"].strip() or not data["location"].strip()):
            raise Problem("evidence_required", "Addressed feedback requires a response and location")
    elif kind == "plan":
        ids = array(data["change_ids"], "change_ids")
        for change_id in ids:
            identity(change_id, "change_id")
        if len(set(ids)) != len(ids):
            raise Problem("invalid_input", "Repeated change IDs")
    elif kind == "task":
        choice(data["status"], ("todo", "doing", "blocked", "done", "cancelled"), "task status")
        if data["due_date"] is not None:
            string(data["due_date"], "due_date", 10)
            try:
                parsed = date.fromisoformat(data["due_date"])
                if parsed.isoformat() != data["due_date"]:
                    raise ValueError()
            except ValueError:
                raise Problem("invalid_input", "due_date must be YYYY-MM-DD or null") from None
    elif kind == "record":
        for blocker in array(data["blockers"], "blockers", 30):
            string(blocker, "blocker", 1000)
        session = data["session"]
        if session is not None:
            exact(session, ("harness", "profile", "working_directory", "main_session_id"), "session")
            for field in ("harness", "profile", "main_session_id"):
                identity(session[field], field)
            session["working_directory"] = local_path(session["working_directory"], "working_directory")
            if session["working_directory"] is None:
                raise Problem("invalid_path", "session working_directory required")
    elif kind == "canvas":
        number(data["zoom"], "zoom", .1, 4)
        choice(data["layer"], ("formal", "explore"), "layer")
        nodes = array(data["nodes"], "nodes", 200)
        ids = set()
        for node in nodes:
            exact(node, ("id", "x", "y", "label", "ref"), "node")
            identity(node["id"], "node.id")
            if node["id"] in ids:
                raise Problem("invalid_input", "Duplicate node ID")
            ids.add(node["id"])
            number(node["x"], "x", -100000, 100000)
            number(node["y"], "y", -100000, 100000)
            string(node["label"], "label", 300)
            if node["ref"] is not None:
                refs([node["ref"]])
        edge_ids = set()
        for edge in array(data["edges"], "edges", 400):
            exact(edge, ("id", "from", "to", "label"), "edge")
            identity(edge["id"], "edge.id")
            identity(edge["from"], "edge.from")
            identity(edge["to"], "edge.to")
            text(edge["label"], "edge.label", 300)
            if edge["id"] in edge_ids or edge["from"] not in ids or edge["to"] not in ids:
                raise Problem("invalid_input", "Invalid edge endpoints or duplicate ID")
            edge_ids.add(edge["id"])


def number(value, label, low, high):
    # Check the range before converting huge JSON integers to a C double.
    if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
        raise Problem("invalid_input", label + ": finite bounded number required")
