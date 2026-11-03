"""Owned local server; atomic bind, cross-process lock and authenticated lifecycle."""
import argparse
import json
import os
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .contracts import Problem
from .server import ASSETS, MAX_BODY, Handler, Server, parse_json
from .store import Store


@contextmanager
def instance_lock(data):
    handle = (data / "service.lock").open("a+b")
    try:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        handle.close()  # OS releases this instance's lock on normal exit or crash.


def atomic_json(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class ManagedHandler(Handler):
    def runtime_body(self):
        lengths = self.headers.get_all("Content-Length", [])
        if (len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit()
                or len(lengths[0]) > 6 or self.headers.get("Transfer-Encoding")):
            raise Problem("invalid_body", "One bounded Content-Length required", 400)
        size = int(lengths[0])
        if not 0 < size <= 4096 or self.headers.get_content_type() != "application/json":
            raise Problem("invalid_body", "Bounded JSON body required", 400)
        value = parse_json(self.rfile.read(size))
        if not isinstance(value, dict):
            raise Problem("invalid_body", "JSON object required", 400)
        return value

    def handle_request(self):
        if self.path not in ("/v1/runtime", "/v1/runtime/stop", "/v1/runtime/ticket", "/v1/runtime/connect"):
            return super().handle_request()
        try:
            connect = self.path == "/v1/runtime/connect"
            self.guard(preflight=connect)
            if self.path == "/v1/runtime" and self.command == "GET":
                self.server.store.list(limit=1)
                self.send_json(200, dict(self.server.runtime, status="running"))
                return
            if self.command != "POST":
                raise Problem("not_found", "Unsupported runtime operation", 404)
            value = self.runtime_body()
            if connect:
                if set(value) != {"ticket"} or not isinstance(value["ticket"], str):
                    raise Problem("invalid_ticket", "Invalid or expired browser ticket", 401)
                with self.server.ticket_lock:
                    expiry = self.server.tickets.pop(value["ticket"], 0)
                if expiry < time.monotonic():
                    raise Problem("invalid_ticket", "Invalid or expired browser ticket", 401)
                self.send_json(200, {"token": self.server.token})
                return
            if value != {"instance_id": self.server.runtime["instance_id"]}:
                raise Problem("instance_mismatch", "Reload service status first", 409)
            if self.path == "/v1/runtime/ticket":
                ticket = secrets.token_urlsafe(32)
                with self.server.ticket_lock:
                    self.server.tickets = {k: v for k, v in self.server.tickets.items() if v >= time.monotonic()}
                    if len(self.server.tickets) >= 32:
                        raise Problem("too_many_tickets", "Use an existing ticket or wait", 429)
                    self.server.tickets[ticket] = time.monotonic() + 30
                self.send_json(200, {"url": self.server.runtime["api_base"] + "/#launch=" + ticket, "expires_in": 30})
            else:
                self.send_json(200, {"status": "stopping", "instance_id": value["instance_id"]})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
        except Problem as error:
            self.send_json(error.status, {"error": {"code": error.code, "message": error.message, "retryable": error.retryable}})
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": {"code": "invalid_json", "retryable": False}})
        except OSError:
            self.close_connection = True


def run(data, preferred_port=0):
    data = Path(data).resolve()
    data.mkdir(parents=True, exist_ok=True)
    with instance_lock(data):
        token_file = data / "api-token.txt"
        try:
            with token_file.open("x", encoding="ascii") as stream:
                stream.write(secrets.token_urlsafe(32))
            token_file.chmod(0o600)
        except FileExistsError:
            pass
        token = token_file.read_text(encoding="ascii").strip()
        store = Store(data / "workbench.sqlite3")
        # Bind candidates directly: no check-then-bind race, no assumption about
        # the machine's configured ephemeral port range (it may be below 49152).
        candidates = ([preferred_port] if preferred_port else []) + [49152 + secrets.randbelow(16384) for _ in range(64)]
        error = None
        for port in candidates:
            try:
                server = Server(("127.0.0.1", port), store, token)
                break
            except OSError as failure:
                error = failure
        else:
            raise error
        server.RequestHandlerClass = ManagedHandler
        ASSETS["/launch.js"] = ("launch.js", "text/javascript; charset=utf-8")
        server.runtime = {"schema_version": 1, "instance_id": uuid.uuid4().hex, "pid": os.getpid(),
                          "api_base": f"http://127.0.0.1:{server.server_port}", "version": "0.2.0"}
        server.tickets, server.ticket_lock = {}, threading.Lock()
        endpoint = data / "endpoint.json"
        try:
            atomic_json(endpoint, server.runtime)
            server.serve_forever(poll_interval=.1)
        finally:
            server.server_close()
            try:
                if json.loads(endpoint.read_text(encoding="utf-8"))["instance_id"] == server.runtime["instance_id"]:
                    endpoint.unlink()
            except (OSError, ValueError, KeyError):
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--preferred-port", type=int, default=0)
    args = parser.parse_args()
    if args.preferred_port and not 49152 <= args.preferred_port <= 65535:
        parser.error("preferred-port must be 0 or 49152..65535")
    try:
        run(args.data_dir, args.preferred_port)
    except OSError:
        print("Workbench did not start: storage lock, port or filesystem unavailable.", file=__import__('sys').stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
