"""Browser-only auth management routes; no credentials in responses or URLs."""
from http.cookies import SimpleCookie
from .contracts import MAX_BODY, Problem


def cookie_token(handler):
    jar = SimpleCookie()
    try:
        jar.load(handler.headers.get("Cookie", ""))
        item = jar.get(handler.server.auth.cookie_name)
        return item.value if item else ""
    except Exception:
        return ""


def session_cookie(handler, token, max_age=90 * 86400):
    handler.auth_cookie = f"{handler.server.auth.cookie_name}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"


def body(handler):
    from .server import parse_json
    lengths = handler.headers.get_all("Content-Length", [])
    if (len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit()
            or len(lengths[0]) > 7 or handler.headers.get("Transfer-Encoding")):
        raise Problem("invalid_body", "One bounded Content-Length required", 400)
    size = int(lengths[0])
    if not 0 < size <= MAX_BODY or handler.headers.get_content_type() != "application/json":
        raise Problem("invalid_body", "Bounded JSON required", 400)
    raw = handler.rfile.read(size)
    if len(raw) != size:
        raise Problem("invalid_body", "Incomplete body", 400)
    try:
        value = parse_json(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise Problem("invalid_json", "Expected strict JSON", 400) from None
    if not isinstance(value, dict):
        raise Problem("invalid_body", "JSON object required", 400)
    return value


def dispatch(handler, url):
    if not url.path.startswith("/v1/auth/") or handler.command == "OPTIONS":
        return False
    if url.query:
        raise Problem("invalid_query", "Auth routes take no query", 400)
    handler.guard()
    principal = handler.principal
    auth = handler.server.auth
    method, path = handler.command, url.path
    if principal["kind"] == "project":
        raise Problem("forbidden", "Project credentials cannot manage access", 403)
    value = body(handler) if method == "POST" else None
    result = {"schema_version": 1}
    if path == "/v1/auth/session" and method == "POST":
        if principal["kind"] != "master" or value != {}:
            raise Problem("forbidden", "Use a DSH launch link or management credential to sign in", 403)
        token, _ = auth.issue("session")
        session_cookie(handler, token)
        result.update(connected=True)
    elif path == "/v1/auth/session" and method == "GET":
        result.update(connected=True, kind=principal["kind"], idle_days=30, lifetime_days=90)
    elif path == "/v1/auth/activity" and method == "POST" and value == {}:
        if principal["kind"] == "session":
            auth.authenticate(cookie_token(handler), "session", touch=True)
        result.update(connected=True)
    elif path == "/v1/auth/logout" and method == "POST" and value == {}:
        if principal["kind"] == "session":
            auth.revoke(principal["id"])
        session_cookie(handler, "", 0)
        result.update(connected=False)
    elif path == "/v1/auth/projects" and method == "GET":
        result["items"] = auth.list()
    elif path == "/v1/auth/projects" and method == "POST":
        if set(value) - {"workspace_id", "label", "permissions", "idle_days", "lifetime_days"}:
            raise Problem("invalid_body", "Unknown credential options", 400)
        workspace = handler.server.store.projects.workspace(value.get("workspace_id"))
        result.update(auth.provision(workspace, value.get("label", workspace["name"]),
                                    value.get("permissions", "read"), value.get("idle_days", 90), value.get("lifetime_days", 365)))
    elif path == "/v1/auth/revoke" and method == "POST" and set(value) == {"credential_id"}:
        key = value["credential_id"]
        if not isinstance(key, str) or len(key) != 32 or any(c not in "0123456789abcdef" for c in key):
            raise Problem("invalid_credential", "Invalid credential ID", 400)
        auth.revoke(key)
        result["revoked"] = True
    else:
        raise Problem("not_found", "Unknown auth operation", 404)
    handler.send_json(200, result)
    return True
