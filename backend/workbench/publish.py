"""Bounded HTTP delivery of an existing payload; never generate producer facts."""
import argparse
import http.client
import json
import sys
import time
from pathlib import Path

from .contracts import MAX_BODY, Problem, identity, validate
from .server import ROOT, parse_json


class DeliveryError(Exception):
    def __init__(self, code, retryable=False):
        super().__init__(code)
        self.code, self.retryable = code, retryable


def confirmed_persistence(value, fields):
    return (isinstance(value, dict) and set(value) == set(fields)
            and all(value[field] is True for field in fields))


class Publisher:
    def __init__(self, port, token, attempts=3, timeout=10):
        if not 1 <= port <= 65535 or not 1 <= attempts <= 5 or not 0 < timeout <= 60:
            raise ValueError("Invalid port, attempts or timeout")
        if len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
            raise ValueError("Invalid token file")
        self.port, self.token = port, token
        self.attempts, self.timeout = attempts, timeout

    def request(self, method, path, body=None):
        # http.client does not follow redirects or use environment proxies.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)
        try:
            conn.request(method, path, body, {"Authorization": "Bearer " + self.token,
                                            "Content-Type": "application/json"})
            response = conn.getresponse()
            raw = response.read(2 * MAX_BODY + 1)
            if len(raw) > 2 * MAX_BODY:
                raise DeliveryError("invalid_response", True)
            try:
                value = parse_json(raw)
            except (ValueError, UnicodeError, RecursionError):
                raise DeliveryError("invalid_response", True) from None
            if not isinstance(value, dict):
                raise DeliveryError("invalid_response", True)
            if response.status not in (200, 201):
                error = value.get("error")
                code = error.get("code", "http_error") if isinstance(error, dict) else "http_error"
                raise DeliveryError(code,
                                    response.status in (408, 429) or response.status >= 500)
            return value
        except (OSError, http.client.HTTPException):
            raise DeliveryError("transport_error", True) from None
        finally:
            conn.close()

    @staticmethod
    def check_receipt(receipt, key, record_id, digest):
        if (type(receipt.get("schema_version")) is not int or receipt["schema_version"] != 1 or receipt.get("delivery_key") != key
                or receipt.get("record_id") != record_id or receipt.get("content_sha256") != digest):
            raise DeliveryError("receipt_mismatch")
        if (receipt.get("status") not in ("accepted", "duplicate")
                or not confirmed_persistence(receipt.get("persistence"), ("receipt", "discovery"))
                or not isinstance(receipt.get("receipt_id"), str)):
            raise DeliveryError("unconfirmed_receipt", True)
        try:
            identity(receipt["receipt_id"], "receipt_id")
        except Problem:
            raise DeliveryError("invalid_response", True) from None

    def publish(self, body):
        if not 0 < len(body) <= MAX_BODY:
            raise ValueError("Payload must be 1..131072 bytes")
        key, discovery, digest = validate(parse_json(body))
        record_id = discovery["record_id"]
        last_error = None
        for attempt in range(self.attempts):
            recovered = False
            try:
                try:
                    receipt = self.request("POST", "/v1/discoveries", body)
                except DeliveryError as exc:
                    if not exc.retryable:
                        raise
                    # A lost response can follow a successful commit. Query the
                    # SAME key, and compare its digest before treating it as ours.
                    try:
                        receipt = self.request("GET", "/v1/deliveries/" + key)
                    except DeliveryError as lookup:
                        if lookup.code == "not_found" or lookup.retryable:
                            raise exc
                        raise
                    recovered = True
                self.check_receipt(receipt, key, record_id, digest)
                saved = self.request("GET", "/v1/receipts/" + receipt["receipt_id"])
                if saved != receipt:
                    raise DeliveryError("receipt_mismatch")
                detail = self.request("GET", "/v1/discoveries/" + record_id)
                if detail.get("record_id") != record_id or detail.get("content_sha256") != digest:
                    raise DeliveryError("discovery_mismatch")
                return {"schema_version": 1, "status": receipt["status"],
                        "receipt_id": receipt["receipt_id"], "delivery_key": key,
                        "record_id": record_id, "content_sha256": digest,
                        "persistence": receipt["persistence"], "readback_confirmed": True,
                        "recovered_by_delivery_key": recovered,
                        "is_test": detail["is_test"],
                        "source_status": detail["source_locator"]["status"],
                        "session_status": detail["session_locator"]["status"],
                        "verified": detail["backend_verification"]["verified"]}
            except DeliveryError as exc:
                if not exc.retryable:
                    raise
                last_error = exc
                if attempt + 1 < self.attempts:
                    time.sleep(min(0.25 * 2 ** attempt, 1))
        raise last_error


def main():
    parser = argparse.ArgumentParser(description="Publish an unchanged Workbench v1 JSON file over local HTTP")
    parser.add_argument("payload", type=Path)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()
    try:
        # Read exactly once, with a bound; changes on disk cannot change a retry.
        with args.payload.open("rb") as stream:
            body = stream.read(MAX_BODY + 1)
        token = (args.data_dir / "api-token.txt").read_text(encoding="ascii").strip()
        result = Publisher(args.port, token, args.attempts, args.timeout).publish(body)
        code = 0
    except DeliveryError as exc:
        code = 3 if exc.retryable else 2
        result = {"schema_version": 1, "status": "unconfirmed" if exc.retryable else "failed",
                  "error": {"code": exc.code, "retryable": exc.retryable},
                  "action": "Preserve the payload and delivery_key; query or retry unchanged"}
    except (OSError, ValueError, Problem, RecursionError):
        code = 1
        result = {"schema_version": 1, "status": "local_error",
                  "error": {"code": "invalid_payload_or_configuration", "retryable": False}}
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
