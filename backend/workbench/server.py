"""Authenticated loopback-only HTTP transport, with no scheduler or file serving."""
import argparse
import hmac
import json
import math
import secrets
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .contracts import MAX_BODY, Problem, identity
from .store import Store
from . import project_http
from .auth import AuthStore, authorize
from . import auth_http

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = Path(__file__).resolve().parent / "web"
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/auth-ui.js": ("auth-ui.js", "text/javascript; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/app.css": ("app.css", "text/css; charset=utf-8"),
          "/motion.css": ("motion.css", "text/css; charset=utf-8"),
          "/motion.js": ("motion.js", "text/javascript; charset=utf-8"),
          "/catalog.js": ("catalog.js", "text/javascript; charset=utf-8"),
          "/experience.js": ("experience.js", "text/javascript; charset=utf-8"),
          "/stages.js": ("stages.js", "text/javascript; charset=utf-8"),
          "/projects.js": ("projects.js", "text/javascript; charset=utf-8"),
          "/icons/icons.js": ("icons/icons.js", "text/javascript; charset=utf-8"),
          "/icons/kit-icons.js": ("icons/kit-icons.js", "text/javascript; charset=utf-8"),
          "/stages.css": ("stages.css", "text/css; charset=utf-8"),
          "/icons/sprite.svg": ("icons/sprite.svg", "image/svg+xml"),
          "/landscape.svg": ("landscape.svg", "image/svg+xml")}


def parse_json(body):
    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("nonfinite number")
        return number

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(body.decode("utf-8"), object_pairs_hook=pairs, parse_float=finite_float,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite number")))


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, token, allowed_origin=None):
        if address[0] != "127.0.0.1":
            raise ValueError("Only 127.0.0.1 binding is supported")
        if not isinstance(token, str) or len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
            raise ValueError("Token must be at least 32 non-whitespace ASCII characters")
        if allowed_origin:
            parts = urlsplit(allowed_origin)
            if (parts.scheme != "http" or parts.hostname not in ("localhost", "127.0.0.1")
                    or parts.username or parts.password or parts.path or parts.query or parts.fragment):
                raise ValueError("allowed-origin must be an exact local http origin, without a trailing slash")
            _ = parts.port  # Reject malformed port numbers.
        self.store, self.token, self.allowed_origin = store, token, allowed_origin
        self.auth = AuthStore(store.path.parent)
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "Workbench/0.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format, *args):
        pass  # Do not persist payloads, locators, query strings or credentials.

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        if getattr(self, "auth_cookie", None):
            self.send_header("Set-Cookie", self.auth_cookie)
        if self.headers.get("Origin") == self.server.allowed_origin and self.server.allowed_origin:
            self.send_header("Access-Control-Allow-Origin", self.server.allowed_origin)
            self.send_header("Vary", "Origin")
        if self.command == "OPTIONS" and status == 200:
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)
        # A bounded drain lets clients receive 413 on Windows instead of a TCP
        # reset caused by closing a socket with an unread, already-sent body.
        discard = getattr(self, "discard_after_response", 0)
        if discard:
            self.connection.settimeout(0.2)
            try:
                self.rfile.read(discard)
            except OSError:
                pass

    def guard(self, preflight=False):
        if self.headers.get("Host") not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
            raise Problem("invalid_host", "Use the local service host and port", 403)
        origin = self.headers.get("Origin")
        own_origin = "http://" + self.headers.get("Host", "")
        if origin and origin not in (own_origin, self.server.allowed_origin):
            raise Problem("origin_denied", "Origin is not allowed", 403)
        if not preflight:
            authorization = self.headers.get("Authorization", "")
            if hmac.compare_digest(authorization.encode("utf-8"), ("Bearer " + self.server.token).encode("ascii")):
                self.principal = {"kind": "master"}
            elif authorization:
                if not authorization.startswith("Bearer ") or len(authorization) > 512:
                    raise Problem("unauthorized", "Invalid bearer credential", 401)
                self.principal = self.server.auth.authenticate(authorization[7:], "project")
            else:
                # Custom header blocks cross-origin simple requests and form posts.
                if self.headers.get("X-Workbench-Request") != "1":
                    raise Problem("unauthorized", "Workbench connection required", 401)
                self.principal = self.server.auth.authenticate(auth_http.cookie_token(self), "session", touch=False)
            url = urlsplit(self.path)
            authorize(self.principal, self.command, url.path, parse_qs(url.query, keep_blank_values=True), self.server.store.projects)

    def do_OPTIONS(self):
        self.handle_request()

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        try:
            url = urlsplit(self.path)
            if auth_http.dispatch(self, url):
                return
            if self.command == "GET" and url.path in ASSETS and (not url.query or (url.path == "/" and url.query == "preview=1")):
                self.guard(preflight=True)  # Public shell only; every data request still requires a token.
                filename, content_type = ASSETS[url.path]
                body = (WEB_ROOT / filename).read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                self.wfile.write(body)
                return
            self.guard(preflight=self.command == "OPTIONS")
            if self.command == "OPTIONS":
                if not self.headers.get("Origin") or not self.server.allowed_origin:
                    raise Problem("origin_denied", "No browser origin configured", 403)
                self.send_json(200, {"schema_version": 1})
                return
            if self.command == "POST":
                parts = url.path.strip("/").split("/")
                project_route = project_http.owns(url.path)
                state_route = len(parts) == 4 and parts[:2] == ["v1", "changes"] and parts[3] == "state"
                if (url.path not in ("/v1/discoveries", "/v1/changes") and not state_route and not project_route) or url.query:
                    raise Problem("not_found", "Unknown publish route", 404)
                if self.headers.get("Transfer-Encoding"):
                    raise Problem("invalid_body", "Transfer-Encoding is unsupported", 400)
                lengths = self.headers.get_all("Content-Length", [])
                if len(lengths) != 1 or not lengths[0].isdigit():
                    raise Problem("invalid_body", "One Content-Length required", 411)
                length = int(lengths[0])
                if not 0 < length <= MAX_BODY:
                    self.discard_after_response = min(length, MAX_BODY + 1)
                    raise Problem("body_too_large", f"Body must be 1..{MAX_BODY} bytes", 413)
                if self.headers.get_content_type() != "application/json":
                    raise Problem("invalid_content_type", "application/json required", 415)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise Problem("invalid_body", "Incomplete body", 400)
                try:
                    value = parse_json(body)
                except (ValueError, UnicodeError, RecursionError):
                    if url.path != "/v1/discoveries":
                        raise Problem("invalid_json", "Expected strict UTF-8 JSON", 400)
                    status, result = self.server.store.reject(Problem("invalid_json", "Expected UTF-8 JSON without duplicate keys or nonfinite numbers", 400))
                else:
                    authorize(self.principal, "POST", url.path, {}, self.server.store.projects, value)
                    if project_route:
                        status, result = project_http.dispatch(self.server.store, "POST", url.path, {}, value)
                    elif state_route:
                        identity(parts[2], "change_id")
                        status, result = self.server.store.changes.set_state(parts[2], value)
                    elif url.path == "/v1/changes":
                        status, result = self.server.store.changes.publish(value)
                    else:
                        status, result = self.server.store.publish(value)
                self.send_json(status, result)
                return
            query = parse_qs(url.query, keep_blank_values=True)
            if any(len(v) != 1 for v in query.values()):
                raise Problem("invalid_query", "Repeated parameters are unsupported", 400)
            authorize(self.principal, "GET", url.path, query, self.server.store.projects)
            if project_http.owns(url.path):
                status, result = project_http.dispatch(self.server.store, "GET", url.path, query)
                if url.path == "/v1/capabilities":
                    result["authorization"] = ({"scope": "project", "workspace_id": self.principal["workspace_id"],
                                                "permissions": self.principal["permissions"], "global_discoveries": False}
                                               if self.principal["kind"] == "project" else {"scope": "management"})
                self.send_json(status, result)
                return
            if url.path in ("/v1/discoveries", "/v1/home", "/v1/changes"):
                allowed = ({"limit", "include_test"} if url.path == "/v1/home" else
                           {"limit", "include_test", "before", "state"} if url.path == "/v1/changes" else
                           {"limit", "include_test", "before", "since", "until"})
                if set(query) - allowed:
                    raise Problem("invalid_query", "Unknown query parameters", 400)
                params = {}
                for key, values in query.items():
                    value = values[0]
                    if key in ("limit", "before"):
                        if not value.isascii() or not value.isdigit() or len(value) > 18:
                            raise Problem("invalid_query", f"Invalid {key}", 400)
                        params[key] = int(value)
                    elif key == "include_test":
                        if value not in ("true", "false"):
                            raise Problem("invalid_query", "include_test requires true or false", 400)
                        params[key] = value == "true"
                    else:
                        params[key] = value
                method = {"/v1/home": self.server.store.home, "/v1/changes": self.server.store.changes.list,
                          "/v1/discoveries": self.server.store.list}[url.path]
                result = method(**params)
            else:
                if query:
                    raise Problem("invalid_query", "Route takes no query parameters", 400)
                if url.path == "/v1/health":
                    # Verify a real database read, not merely a listening process.
                    self.server.store.list(limit=1)
                    result = {"schema_version": 1, "status": "ok"}
                else:
                    parts = url.path.strip("/").split("/")
                    if len(parts) != 3 or parts[:2] not in (["v1", "receipts"], ["v1", "deliveries"], ["v1", "discoveries"], ["v1", "changes"], ["v1", "change-deliveries"]):
                        raise Problem("not_found", "Unknown route", 404)
                    identity(parts[2], "identifier")
                    method = {"receipts": self.server.store.receipt, "deliveries": self.server.store.delivery,
                              "discoveries": self.server.store.detail, "changes": self.server.store.changes.detail,
                              "change-deliveries": self.server.store.changes.delivery}[parts[1]]
                    result = method(parts[2])
                    if result is None:
                        raise Problem("not_found", "Record not found", 404)
            self.send_json(200, result)
        except Problem as exc:
            self.send_json(exc.status, {"schema_version": 1, "error": {"code": exc.code, "message": exc.message, "retryable": exc.retryable}})
        except sqlite3.Error:
            self.send_json(503, {"schema_version": 1, "error": {"code": "storage_unavailable", "message": "Retry later; preserve delivery key", "retryable": True}})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            self.close_connection = True
        except (ValueError, RecursionError):
            self.send_json(400, {"schema_version": 1, "error": {"code": "invalid_request", "message": "Malformed request", "retryable": False}})
        except OSError:
            self.send_json(503, {"schema_version": 1, "error": {"code": "credential_storage_unavailable", "message": "Check project and service storage permissions", "retryable": True}})


def main():
    parser = argparse.ArgumentParser(description="Workbench V0 loopback backend")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allowed-origin", help="Explicit local frontend origin, e.g. http://127.0.0.1:5173")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    data = args.data_dir.resolve()
    data.mkdir(parents=True, exist_ok=True)
    token_path = data / "api-token.txt"
    try:
        with token_path.open("x", encoding="ascii") as stream:
            stream.write(secrets.token_urlsafe(32))
    except FileExistsError:
        pass
    token = token_path.read_text(encoding="ascii").strip()
    server = Server(("127.0.0.1", args.port), Store(data / "workbench.sqlite3"), token, args.allowed_origin)
    print(f"Workbench listening on http://127.0.0.1:{server.server_port}; data={data}; token file={token_path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
