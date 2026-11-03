"""One Agent API shared by DSH tools, command-line calls and stdio MCP."""
import json
import re
from pathlib import Path
from urllib.parse import quote, urlsplit

from .contracts import MAX_BODY, Problem
from .project_contracts import COLLECTIONS
from .project_publish import ProjectPublisher
from .publish import DeliveryError, Publisher
from .auth import seal

ID = r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}"
COLLECTION = "(?:" + "|".join(COLLECTIONS) + ")"
READ_PATHS = [
    r"/v1/(?:health|home|capabilities|workspaces|project-items|search|discoveries|changes)",
    rf"/v1/(?:receipts|deliveries|change-deliveries|project-operations|discoveries|changes)/{ID}",
    rf"/v1/workspaces/{ID}(?:/(?:overview|board|compare|{COLLECTION}))?",
    rf"/v1/workspaces/{ID}/{COLLECTION}/{ID}",
    rf"/v1/workspaces/{ID}/artifacts/{ID}/(?:inspect|preview)",
]


class AgentService:
    def __init__(self, data_dir, project_dir=None):
        self.data = Path(data_dir).resolve()
        self.project = Path(project_dir).resolve() if project_dir else None

    def client(self):
        if self.project is None:
            raise DeliveryError("project_configuration_required", False)
        try:
            config_path = self.project / ".workbench" / "project.json"
            if config_path.stat().st_size > 8192:
                raise ValueError()
            config = json.loads(config_path.read_text(encoding="utf-8"))
            key = config["credential_id"]
            if (config.get("schema_version") != 1 or not re.fullmatch(r"[a-f0-9]{32}", key)
                    or not re.fullmatch(r"[a-f0-9]{32}", config["service_id"])):
                raise ValueError()
            data = Path(config["data_dir"])
            if not data.is_absolute():
                raise ValueError()
            data = data.resolve()
            raw = (data / "endpoint.json").read_bytes()
            if len(raw) > 4096:
                raise ValueError()
            endpoint = json.loads(raw)
            base = endpoint["api_base"]
            if not isinstance(base, str) or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", base):
                raise ValueError()
            if not re.fullmatch(r"[a-f0-9]{32}", endpoint["instance_id"]):
                raise ValueError()
            port = urlsplit(base).port
            secret = data / "credentials" / (key + ".secret")
            if secret.stat().st_size > 8192:
                raise ValueError()
            token = seal(secret.read_bytes(), decrypt=True).decode("ascii")
            client = ProjectPublisher(port, token, attempts=3, timeout=5)
            runtime = client.request("GET", "/v1/runtime")
            if runtime.get("instance_id") != endpoint["instance_id"] or runtime.get("api_base") != base:
                raise ValueError()
            if runtime.get("service_id") != config["service_id"] or runtime.get("workspace_id") != config["workspace_id"]:
                raise ValueError()
            workspace = client.request("GET", "/v1/workspaces/" + quote(config["workspace_id"], safe=""))
            if Path(workspace["root_path"]).resolve() != self.project:
                raise ValueError()
            return client, runtime
        except (OSError, ValueError, KeyError, TypeError):
            raise DeliveryError("service_unavailable", True) from None

    def call(self, name, arguments):
        if not isinstance(arguments, dict):
            raise ValueError("arguments must be an object")
        arguments = dict(arguments)
        project = arguments.pop("project_dir", None)
        if project is not None:
            if not isinstance(project, str) or not Path(project).is_absolute():
                raise ValueError("absolute project_dir required")
            if self.project is not None and Path(project).resolve() != self.project:
                raise DeliveryError("forbidden", False)
            return AgentService(self.data, project).call(name, arguments)
        fields = {
            "workbench_service_status": (),
            "workbench_read": ("path",),
            "workbench_publish_project": ("collection", "workspace_id", "payload"),
            "workbench_publish_discovery": ("payload",),
        }
        if name not in fields or set(arguments)-set(fields[name]):
            raise ValueError("unknown tool or arguments")
        if name == "workbench_service_status":
            try:
                _, runtime = self.client()
                return runtime
            except DeliveryError as error:
                return {"status": "project_configuration_required" if error.code == "project_configuration_required" else "stopped_or_unavailable",
                        "action": "Generate project access in Workbench, configure project_dir, and start the backend from DSH Settings."}
        # Validate a read target before reading credentials or making a request.
        if name == "workbench_read":
            path = arguments.get("path")
            if not isinstance(path, str) or len(path) > 4096 or any(ord(c)<32 for c in path):
                raise ValueError("bounded path required")
            target = urlsplit(path)
            if (target.scheme or target.netloc or target.fragment
                    or not any(re.fullmatch(pattern, target.path) for pattern in READ_PATHS)):
                raise ValueError("only documented Workbench read paths are allowed")
        client, _ = self.client()
        if name == "workbench_read":
            encoded = target.path + ("?" + quote(target.query, safe="=&%:/?+,-._~") if target.query else "")
            return client.request("GET", encoded)
        payload = arguments.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("payload object required")
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > MAX_BODY:
            raise ValueError("payload exceeds 128 KiB")
        if name == "workbench_publish_project":
            return client.publish_project(arguments.get("collection"), arguments.get("workspace_id"), body)
        return client.publish(body)


def safe_call(service, name, arguments):
    try:
        return {"ok": True, "result": service.call(name, arguments)}
    except DeliveryError as error:
        return {"ok": False, "error": {"code": error.code, "retryable": error.retryable,
                "action": "Preserve the original operation key and payload; do not infer that nothing was saved."}}
    except (OSError, ValueError, KeyError, TypeError, Problem):
        return {"ok": False, "error": {"code": "invalid_input_or_configuration", "retryable": False}}


TOOLS = [
    {"name": "workbench_service_status", "description": "Read actual backend health and instance identity. Does not start or stop the service.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "workbench_read", "description": "GET a documented local /v1 read route, including workspace/board/history/search/receipts. No arbitrary URLs or lifecycle operations.",
     "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "maxLength": 4096}}, "required": ["path"], "additionalProperties": False}},
    {"name": "workbench_publish_project", "description": "Reliably register/update workspace, artifact, stage, version, feedback, plan, task, record or canvas; verify receipt and exact revision. Pass the unchanged v1 envelope. refresh snapshots selected source files. This is one operation, not an atomic batch.",
     "inputSchema": {"type": "object", "properties": {"collection": {"type": "string", "enum": ["workspaces", "refresh"] + [k for k in COLLECTIONS if k != "sources"]},
                       "workspace_id": {"type": "string"}, "payload": {"type": "object"}}, "required": ["collection", "payload"], "additionalProperties": False}},
    {"name": "workbench_publish_discovery", "description": "Reliably publish a source-grounded discovery with producer/session identity, unchanged delivery key and verification declarations. Verify durable receipt and discovery readback.",
     "inputSchema": {"type": "object", "properties": {"payload": {"type": "object"}}, "required": ["payload"], "additionalProperties": False}},
]
for tool in TOOLS:
    tool["inputSchema"]["properties"]["project_dir"] = {"type": "string", "description": "Absolute registered project directory containing .workbench/project.json. Required unless MCP was started with --project-dir."}
    tool["description"] += " Uses only this project's credential; never falls back to management access."
TOOLS[-1]["description"] = "Legacy global discovery publishing. Unavailable to project credentials (403); use project records/artifacts instead."
