"""Agent-facing client for existing project HTTP routes, with durable readback."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from time import sleep

from .contracts import MAX_BODY, Problem, canonical, identity
from .project_contracts import COLLECTIONS, envelope, integer
from .publish import DeliveryError, Publisher, confirmed_persistence
from .server import ROOT, parse_json


class ProjectPublisher(Publisher):
    @staticmethod
    def resources(receipt, collection, value, workspace_id):
        """Validate the receipt's target against the request before constructing URLs."""
        try:
            if type(receipt.get("schema_version")) is not int or receipt["schema_version"] != 1:
                raise DeliveryError("receipt_mismatch")
            if receipt.get("status") not in ("accepted", "duplicate"):
                raise DeliveryError("unconfirmed_receipt", True)
            identity(receipt["receipt_id"], "receipt_id")
            resource = receipt["resource"]
            if not isinstance(resource, dict):
                raise DeliveryError("invalid_response")
            if collection == "refresh":
                resources = resource["items"]
                if (resource["kind"] != "source_refresh" or not isinstance(resources, list)
                        or len(resources) != len(value["filenames"]) or not resources):
                    raise DeliveryError("resource_mismatch")
                expected_kind, expected_id = "source", None
            else:
                resources = [resource]
                expected_kind = "workspace" if collection == "workspaces" else COLLECTIONS[collection]
                expected_id = workspace_id if collection == "workspaces" else value["item"]["id"]
            ids = set()
            for target in resources:
                if not isinstance(target, dict):
                    raise DeliveryError("invalid_response")
                identity(target["id"], "resource.id")
                integer(target["version"], "resource.version", 1)
                if (target["kind"] != expected_kind or (expected_id is not None and target["id"] != expected_id)
                        or target["id"] in ids):
                    raise DeliveryError("resource_mismatch")
                ids.add(target["id"])
            return resources
        except (KeyError, TypeError, Problem):
            raise DeliveryError("invalid_response") from None

    def publish_project(self, collection, workspace_id, body):
        if not 0 < len(body) <= MAX_BODY:
            raise ValueError("Bounded input file required")
        value = parse_json(body)
        field = "workspace" if collection == "workspaces" else "filenames" if collection == "refresh" else "item"
        envelope(value, field)
        if collection == "workspaces":
            if not isinstance(value["workspace"], dict):
                raise ValueError("workspace object required")
            wid = identity(value["workspace"].get("id"), "workspace.id")
            path, operation = "/v1/workspaces", "workspace.save"
        else:
            wid = identity(workspace_id, "workspace_id")
            if collection not in COLLECTIONS or collection == "sources":
                if collection != "refresh":
                    raise ValueError("Unknown writable collection")
            path = f"/v1/workspaces/{wid}/{collection}"
            operation = "sources.refresh" if collection == "refresh" else "item.save"
        key = value["operation_key"]
        digest = hashlib.sha256(canonical({"kind": operation, "workspace_id": wid, "body": value}).encode()).hexdigest()
        error = None
        for attempt in range(self.attempts):
            try:
                try:
                    receipt = self.request("POST", path, body)
                except DeliveryError as exc:
                    if not exc.retryable:
                        raise
                    try:
                        receipt = self.request("GET", "/v1/project-operations/"+key)
                    except DeliveryError as lookup:
                        if lookup.code == "not_found" or lookup.retryable:
                            raise exc
                        raise
                if (receipt.get("delivery_key") != key or receipt.get("content_sha256") != digest
                        or receipt.get("workspace_id") != wid or receipt.get("operation") != operation
                        or not confirmed_persistence(receipt.get("persistence"), ("receipt", "project_state"))):
                    raise DeliveryError("receipt_mismatch")
                resources = self.resources(receipt, collection, value, wid)
                receipt_id = receipt["receipt_id"]
                if self.request("GET", "/v1/receipts/"+receipt_id) != receipt:
                    raise DeliveryError("receipt_mismatch")
                resource = receipt["resource"]
                filenames = set()
                for target in resources:
                    if target["kind"] == "workspace":
                        path = f"/v1/workspaces/{wid}?version={target['version']}"
                    else:
                        collection_name = next(name for name, kind in COLLECTIONS.items() if kind == target["kind"])
                        path = f"/v1/workspaces/{wid}/{collection_name}/{target['id']}?version={target['version']}"
                    readback = self.request("GET", path)
                    if (readback.get("id") != target["id"] or type(readback.get("version")) is not int
                            or readback["version"] != target["version"]
                            or (target["kind"] != "workspace" and (readback.get("kind") != target["kind"]
                                or readback.get("workspace_id") != wid))):
                        raise DeliveryError("resource_mismatch")
                    if collection == "refresh":
                        filename = readback.get("title")
                        if not isinstance(filename, str) or filename not in value["filenames"] or filename in filenames:
                            raise DeliveryError("resource_mismatch")
                        filenames.add(filename)
                return {"schema_version": 1, "status": receipt["status"], "receipt_id": receipt_id,
                        "operation_key": key, "workspace_id": wid, "resource": resource,
                        "persistence": receipt["persistence"], "readback_confirmed": True}
            except DeliveryError as exc:
                if not exc.retryable:
                    raise
                error = exc
                if attempt+1 < self.attempts:
                    sleep(min(.25*2**attempt, 1))
        raise error


def main():
    parser = argparse.ArgumentParser(description="Publish project metadata through local HTTP, preserving operation keys")
    parser.add_argument("collection", choices=["workspaces", "refresh"]+[k for k in COLLECTIONS if k != "sources"])
    parser.add_argument("payload", type=Path)
    parser.add_argument("--workspace")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()
    try:
        with args.payload.open("rb") as stream:
            body = stream.read(MAX_BODY+1)
        token = (args.data_dir / "api-token.txt").read_text(encoding="ascii").strip()
        result = ProjectPublisher(args.port, token, args.attempts).publish_project(args.collection, args.workspace, body)
        code = 0
    except DeliveryError as exc:
        code = 3 if exc.retryable else 2
        result = {"schema_version": 1, "status": "unconfirmed" if exc.retryable else "failed",
                  "error": {"code": exc.code, "retryable": exc.retryable}, "action": "Preserve the operation_key and payload; query or retry unchanged"}
    except (OSError, ValueError, Problem, RecursionError):
        code = 1
        result = {"schema_version": 1, "status": "local_error", "error": {"code": "invalid_payload_or_configuration", "retryable": False}}
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
