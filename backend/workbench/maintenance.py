"""Offline commands and SQLite online backup; never copy a live DB main file alone."""
import argparse
import json
import os
import sqlite3
import sys
import uuid
from contextlib import closing
from pathlib import Path


SCHEMA_COLUMNS = {
    "discoveries": "seq record_id root_id revision_of content_sha256 received_at is_test payload",
    "receipts": "receipt_id status http_status body",
    "deliveries": "delivery_key content_sha256 record_id first_receipt_id",
    "changes": "change_id record_id root_id priority version latest_seq state state_version updated_at",
    "change_versions": "seq change_id version record_id priority received_at",
    "change_operations": "kind operation_key digest receipt_id",
    "workspaces": "seq workspace_id root_key version is_test status body created_at updated_at",
    "workspace_revisions": "workspace_id version body recorded_at",
    "project_items": "seq workspace_id item_id kind title archived version created_at updated_at",
    "project_item_revisions": "revision_seq workspace_id item_id version body recorded_at",
    "project_item_links": "workspace_id item_id version target_id target_version role",
    "project_change_links": "workspace_id item_id version change_id",
    "project_operations": "operation_key digest receipt_id",
}


def schema_errors(conn, version):
    if version not in (1, 2, 3):
        return [{"error": "unsupported_database_version", "version": version}]
    count = {1: 3, 2: 6, 3: 13}[version]
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    errors = []
    for name, columns in list(SCHEMA_COLUMNS.items())[:count]:
        if name not in tables:
            errors.append({"table": name, "error": "missing_table"})
            continue
        # Names come only from the static schema list, never from caller input.
        actual = {r[1] for r in conn.execute(f'PRAGMA table_info("{name}")')}
        missing = sorted(set(columns.split()) - actual)
        if missing:
            errors.append({"table": name, "error": "missing_columns", "columns": missing})
    return errors


def check(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri()+"?mode=ro", uri=True)) as conn:
        # One read snapshot for schema, integrity and foreign-key checks.
        conn.execute("BEGIN")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        errors = schema_errors(conn, version)
        integrity = [r[0] for r in conn.execute("PRAGMA integrity_check")]
        foreign_keys = [list(r) for r in conn.execute("PRAGMA foreign_key_check")] if not errors else None
        return {"integrity": integrity, "foreign_key_errors": foreign_keys,
                "database_version": version, "schema_errors": errors,
                "ok": integrity == ["ok"] and not errors and foreign_keys == []}


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError("Backup destination must be a new file")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name+"."+uuid.uuid4().hex+".tmp")
    try:
        with closing(sqlite3.connect(source.as_uri()+"?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(temporary)) as dst:
                src.backup(dst, pages=128, sleep=.05)
        result = check(temporary)
        if not result["ok"]:
            raise ValueError("Backup integrity check failed")
        # Windows rename fails if destination exists, avoiding accidental overwrite.
        if os.name == "nt":
            temporary.rename(destination)
        else:
            os.link(temporary, destination)
            temporary.unlink()
        return result
    finally:
        temporary.unlink(missing_ok=True)


def restore(source, data_dir):
    source, data_dir = Path(source).resolve(), Path(data_dir).resolve()
    result = check(source)
    if not result["ok"] or result["database_version"] not in (1, 2, 3):
        raise ValueError("Invalid or unsupported backup")
    # A fresh directory avoids overwriting a database, token or live WAL/SHM.
    data_dir.mkdir(parents=True, exist_ok=False)
    return backup(source, data_dir / "workbench.sqlite3")


def main():
    parser = argparse.ArgumentParser(description="Check, back up or restore the Workbench database without copying credentials")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("check")
    p.add_argument("database", type=Path)
    p = commands.add_parser("backup")
    p.add_argument("database", type=Path)
    p.add_argument("output", type=Path)
    p = commands.add_parser("restore")
    p.add_argument("backup", type=Path)
    p.add_argument("new_data_dir", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = check(args.database)
        elif args.command == "backup":
            result = backup(args.database, args.output)
        else:
            result = restore(args.backup, args.new_data_dir)
        print(json.dumps({"schema_version": 1, **result}))
        return 0 if result["ok"] else 1
    except (OSError, sqlite3.Error, ValueError):
        print(json.dumps({"schema_version": 1, "ok": False, "error": "maintenance_failed; verify paths, source integrity and a fresh destination"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
