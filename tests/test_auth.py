"""Security regression tests: real HTTP, two distinct project roots and durable auth."""
import http.client
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from workbench.auth import AuthStore, DAY, seal
from workbench.contracts import Problem
from workbench.server import Server
from workbench.store import Store
from test_projects import workspace, artifact


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = Store(self.root / "data/workbench.sqlite3")
        for wid in ("alpha", "beta"):
            folder = self.root / wid
            folder.mkdir()
            (folder / "PLAN.md").write_text(wid, encoding="utf-8")
            self.store.projects.save_workspace(workspace(folder, wid, "register-"+wid))
            self.store.projects.save_item(wid, artifact("file-"+wid))
        self.master = "m" * 48
        self.server = Server(("127.0.0.1", 0), self.store, self.master)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.tmp.cleanup()

    def request(self, path, token=None, body=None, cookie=None, extra=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if cookie:
            headers.update(Cookie=cookie, **{"X-Workbench-Request": "1"})
        if body is not None:
            headers["Content-Type"] = "application/json"
        headers.update(extra or {})
        client.request("POST" if body is not None else "GET", path,
                       json.dumps(body).encode() if body is not None else None, headers)
        response = client.getresponse()
        result = response.status, json.loads(response.read()), response.getheader("Set-Cookie")
        client.close()
        return result

    def project_token(self, permissions="read"):
        return self.server.auth.issue("project", "alpha", permissions, "Test Agent")[0]

    def test_browser_cookie_persists_and_logout_revokes_server_side(self):
        status, value, cookie = self.request("/v1/auth/session", self.master, {})
        self.assertEqual(status, 200)
        self.assertNotIn(self.master, json.dumps(value))
        self.assertIn("HttpOnly", cookie); self.assertIn("SameSite=Strict", cookie)
        pair = cookie.split(";", 1)[0]
        self.assertEqual(self.request("/v1/home", cookie=pair)[0], 200)
        self.server.auth = AuthStore(self.root / "data")
        self.assertEqual(self.request("/v1/auth/session", cookie=pair)[0], 200)
        self.assertEqual(self.request("/v1/auth/logout", cookie=pair, body={})[0], 200)
        self.assertEqual(self.request("/v1/home", cookie=pair)[0], 401)

    def test_cookie_requires_custom_header_and_rejects_foreign_origin(self):
        _, _, cookie = self.request("/v1/auth/session", self.master, {})
        pair = cookie.split(";", 1)[0]
        self.assertEqual(self.request("/v1/home", extra={"Cookie":pair})[0], 401)
        self.assertEqual(self.request("/v1/auth/logout", cookie=pair, body={}, extra={"Origin":"http://evil.invalid"})[0], 403)
        self.assertEqual(self.request("/v1/auth/session", cookie=pair, body={})[0], 403)

    def test_project_lists_and_search_are_server_filtered(self):
        token = self.project_token()
        for path in ("/v1/workspaces", "/v1/project-items", "/v1/search?q=file"):
            separator = "&" if "?" in path else "?"
            status, result, _ = self.request(path + separator + "include_test=true", token)
            self.assertEqual(status, 200)
            self.assertNotIn("beta", json.dumps(result))
        for path in ("/v1/workspaces/beta", "/v1/workspaces/beta/artifacts/file-beta",
                     "/v1/search?q=x&workspace_id=beta", "/v1/project-items?workspace_id=beta",
                     "/v1/home", "/v1/discoveries", "/v1/changes", "/v1/auth/projects"):
            self.assertEqual(self.request(path, token)[0], 403, path)

    def test_read_only_and_management_routes_are_denied(self):
        token = self.project_token()
        self.assertEqual(self.request("/v1/workspaces/alpha/artifacts", token, artifact("new"))[0], 403)
        writer = self.project_token("write")
        for path in ("/v1/workspaces", "/v1/workspaces/alpha", "/v1/auth/projects", "/v1/runtime/stop", "/v1/discoveries"):
            self.assertEqual(self.request(path, writer, {})[0], 403, path)
        self.assertEqual(self.request("/v1/workspaces/alpha/artifacts", writer, {"item":[]} )[0], 422)

    def test_write_receipts_and_retries_stay_in_the_project(self):
        token = self.project_token("write")
        payload = artifact("new-alpha")
        status, receipt, _ = self.request("/v1/workspaces/alpha/artifacts", token, payload)
        self.assertEqual(status, 201)
        self.assertEqual(self.request("/v1/workspaces/alpha/artifacts", token, payload)[1], receipt)
        self.assertEqual(self.request("/v1/receipts/"+receipt["receipt_id"], token)[0], 200)
        self.assertEqual(self.request("/v1/project-operations/"+payload["operation_key"], token)[0], 200)
        other = self.store.projects.operation("save-file-beta")
        self.assertEqual(self.request("/v1/receipts/"+other["receipt_id"], token)[0], 404)
        self.assertEqual(self.request("/v1/project-operations/save-file-beta", token)[0], 404)

    def test_revoke_is_immediate_and_persistent(self):
        token, key = self.server.auth.issue("project", "alpha", "read", "Agent")
        self.assertEqual(self.request("/v1/workspaces/alpha", token)[0], 200)
        self.assertEqual(self.request("/v1/auth/revoke", self.master, {"credential_id": key})[0], 200)
        self.server.auth = AuthStore(self.root / "data")
        self.assertEqual(self.request("/v1/workspaces/alpha", token)[0], 401)

    def test_idle_absolute_and_background_reads(self):
        at = [1000000.0]
        auth = AuthStore(self.root / "clock", clock=lambda: at[0])
        token, key = auth.issue("session", idle_days=2, lifetime_days=4)
        at[0] += DAY
        auth.authenticate(token, "session", touch=False)
        self.assertEqual(auth.list("session")[0]["last_used"], 1000000.0)
        at[0] += DAY
        with self.assertRaises(Problem): auth.authenticate(token, "session", touch=True)
        token, _ = auth.issue("project", "alpha", "read", "Agent", idle_days=2, lifetime_days=4)
        for _ in range(3):
            at[0] += DAY
            auth.authenticate(token, "project")
        at[0] += DAY
        with self.assertRaises(Problem): auth.authenticate(token, "project")

    def test_project_config_contains_reference_only_and_rotation_revokes_old(self):
        body = {"workspace_id":"alpha", "label":"Thesis Agent", "permissions":"write"}
        status, result, _ = self.request("/v1/auth/projects", self.master, body)
        self.assertEqual(status, 200)
        config = json.loads(Path(result["config_path"]).read_text(encoding="utf-8"))
        self.assertNotIn("token", config)
        secret = self.root / "data/credentials" / (result["credential_id"]+".secret")
        token = seal(secret.read_bytes(), decrypt=True).decode("ascii")
        self.assertNotIn(token, json.dumps(config))
        self.assertNotIn(token.encode(), self.server.auth.path.read_bytes())
        self.assertEqual(self.request("/v1/workspaces/alpha", token)[0], 200)
        self.assertEqual(self.request("/v1/auth/projects", self.master, body)[0], 200)
        self.assertFalse(secret.exists())
        self.assertEqual(self.request("/v1/workspaces/alpha", token)[0], 401)

    def test_concurrent_provision_leaves_one_active_directory_credential(self):
        auth = self.server.auth
        project = self.store.projects.workspace("alpha")
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: auth.provision(project, "Concurrent", "read"), range(3)))
        active = [row for row in auth.list() if row["active"]]
        self.assertEqual(len(active), 1)
        config = json.loads((self.root / "alpha/.workbench/project.json").read_text(encoding="utf-8"))
        self.assertEqual(active[0]["id"], config["credential_id"])
        self.assertEqual(len(list((self.root / "data/credentials").glob("*.secret"))), 1)

    def test_project_cannot_link_global_changes_and_expired_cookie_is_rejected(self):
        token = self.project_token("write")
        payload = {"item":{"data":{"change_ids":["another-project-change"]}}}
        self.assertEqual(self.request("/v1/workspaces/alpha/records", token, payload)[0], 403)
        at = [1000000.0]
        self.server.auth.clock = lambda: at[0]
        _, _, cookie = self.request("/v1/auth/session", self.master, {})
        at[0] += 30 * DAY
        self.assertEqual(self.request("/v1/auth/session", cookie=cookie.split(";", 1)[0])[0], 401)


if __name__ == "__main__":
    unittest.main()
