"""Bounded newline-delimited MCP stdio. stdout contains protocol messages only."""
import argparse
import json
import sys
from pathlib import Path

from .agent import AgentService, TOOLS, safe_call
from .server import parse_json

SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")
LIMIT = 262144


def serve(data_dir, source, sink, project_dir=None):
    service = AgentService(data_dir, project_dir)
    initialized = False
    while True:
        line = source.readline(LIMIT + 1)
        if not line:
            return
        request_id = None
        if len(line) > LIMIT:
            while line and not line.endswith(b"\n"):
                line = source.readline(LIMIT + 1)
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Message too large"}}
        else:
            decoded = False
            try:
                request = parse_json(line)
                decoded = True
                if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
                    raise ValueError()
                request_id = request.get("id")
                if request_id is not None and (type(request_id) not in (str, int)):
                    raise ValueError()
                if "id" not in request:
                    continue  # Initialized/cancel notifications have no response.
                method = request.get("method")
                params = request.get("params", {})
                if not isinstance(params, dict):
                    raise ValueError()
                if method == "initialize":
                    version = params.get("protocolVersion")
                    result = {"protocolVersion": version if version in SUPPORTED else SUPPORTED[0],
                              "capabilities": {"tools": {}},
                              "serverInfo": {"name": "dsh-workbench", "version": "0.3.0"},
                              "instructions": "Use source-grounded v1 payloads, preserve keys on retries, read back receipts. Service lifecycle is controlled in DSH Settings."}
                    initialized = True
                elif method == "ping":
                    result = {}
                elif not initialized:
                    response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32002, "message": "Initialize first"}}
                    sink.write((json.dumps(response) + "\n").encode()); sink.flush()
                    continue
                elif method == "tools/list":
                    result = {"tools": TOOLS}
                elif method == "tools/call":
                    name = params.get("name")
                    if name not in {t["name"] for t in TOOLS}:
                        raise LookupError()
                    output = safe_call(service, name, params.get("arguments", {}))
                    result = {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}], "isError": not output["ok"]}
                else:
                    raise LookupError()
                response = {"jsonrpc": "2.0", "id": request_id, "result": result}
            except LookupError:
                response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method or tool not found"}}
            except (ValueError, TypeError, KeyError, RecursionError):
                response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32600 if decoded else -32700, "message": "Invalid JSON-RPC request" if decoded else "Parse error"}}
        # Escaping also makes hostile unpaired-surrogate request IDs safe to return.
        sink.write((json.dumps(response, ensure_ascii=True) + "\n").encode("utf-8")); sink.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--project-dir", type=Path, help="Registered project directory with .workbench/project.json; no management-token fallback")
    parser.add_argument("--call", help="Run one shared Agent tool, reading its arguments from stdin")
    args = parser.parse_args()
    if args.call:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        try:
            arguments = parse_json(raw) if len(raw) <= LIMIT else None
        except (ValueError, UnicodeError):
            arguments = None
        output = safe_call(AgentService(args.data_dir, args.project_dir), args.call, arguments)
        sys.stdout.write(json.dumps(output, ensure_ascii=False) + "\n")
    else:
        serve(args.data_dir, sys.stdin.buffer, sys.stdout.buffer, args.project_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
