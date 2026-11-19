"""Bounded status-only RCON and signed HTTPS POST. No transport payload logs."""

import hashlib
import hmac
import http.client
import json
import math
import socket
import struct
import threading
import time
from urllib.parse import urlsplit

from .worker import validate_snapshot

MAX_PACKET = 65536
DEFAULT_TIMEOUT = 5.0


def bounded_timeout(value):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.1 <= value <= 30:
        raise ValueError("Invalid network timeout")
    return value


def packet(request_id, kind, body):
    raw = body.encode("utf-8")
    if b"\0" in raw or len(raw) > MAX_PACKET - 10:
        raise ValueError("Invalid RCON body")
    return struct.pack("<iii", len(raw) + 10, request_id, kind) + raw + b"\0\0"


def receive(sock, deadline):
    def exact(size):
        result = bytearray()
        while len(result) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("RCON deadline")
            sock.settimeout(remaining)
            chunk = sock.recv(size - len(result))
            if not chunk:
                raise ConnectionError("Truncated RCON packet")
            result.extend(chunk)
        return bytes(result)

    size = struct.unpack("<i", exact(4))[0]
    if not 10 <= size <= MAX_PACKET:
        raise ValueError("Invalid RCON packet length")
    raw = exact(size)
    if raw[-2:] != b"\0\0" or b"\0" in raw[8:-2]:
        raise ValueError("Invalid RCON terminator/body")
    request_id, kind = struct.unpack("<ii", raw[:8])
    return request_id, kind, raw[8:-2].decode("utf-8", errors="strict")


class Rcon:
    """Only status is exposed; never executes SourceMod commands."""

    def __init__(self, host, port, password, timeout=DEFAULT_TIMEOUT):
        if not isinstance(password, str) or not password or "\0" in password:
            raise ValueError("RCON password required")
        if not isinstance(host, str) or not host or type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Invalid RCON endpoint")
        self.host, self.port, self.password = host, port, password
        self.timeout = bounded_timeout(timeout)

    def status(self):
        with socket.create_connection((self.host, self.port), self.timeout) as sock:
            deadline = time.monotonic() + self.timeout
            sock.sendall(packet(11, 3, self.password))
            for _ in range(3):
                rid, kind, _ = receive(sock, deadline)
                if rid == -1:
                    raise PermissionError("RCON authentication rejected")
                if rid != 11 or kind not in (0, 2):
                    raise ValueError("Unexpected RCON auth response")
                if kind == 2:
                    break
            else:
                raise ValueError("Missing RCON auth response")
            sock.sendall(packet(12, 2, "status"))
            sock.sendall(packet(13, 0, ""))
            total, parts = 0, []
            for _ in range(64):
                rid, kind, body = receive(sock, deadline)
                if kind != 0:
                    raise ValueError("Unexpected RCON response type")
                if rid == 13:
                    break
                if rid != 12:
                    raise ValueError("Unexpected RCON response ID")
                total += len(body.encode("utf-8"))
                if total > MAX_PACKET:
                    raise ValueError("Oversized RCON response")
                parts.append(body)
            else:
                raise ValueError("Too many RCON packets")
            # Packet splits can occur in the middle of a line.
            return "".join(parts)


class HttpPublisher:
    def __init__(self, url, hmac_secret, timeout=DEFAULT_TIMEOUT):
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment
                or parsed.path != "/api/check/roster"
                or any(ord(c) <= 32 or ord(c) == 127 for c in url)):
            raise ValueError("Exact HTTPS roster endpoint required")
        if not isinstance(hmac_secret, str) or len(hmac_secret.encode("utf-16-le")) // 2 < 32:
            raise ValueError("Ingest secret must have at least 32 characters")
        self.host, self.port = parsed.hostname, parsed.port or 443
        self.path, self.url = parsed.path, url
        self.hmac_secret = hmac_secret.encode("utf-8")
        self.timeout = bounded_timeout(timeout)

    def _sign(self, raw_body_bytes, timestamp_seconds):
        return hmac.new(self.hmac_secret, str(timestamp_seconds).encode("ascii") + b"\n" + raw_body_bytes,
                        hashlib.sha256).hexdigest()

    def publish(self, snapshot):
        now_ms = int(time.time() * 1000)
        validate_snapshot(snapshot, now_ms)
        body = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > 96 * 1024:
            raise ValueError("Oversized roster body")
        stamp = str(now_ms // 1000)
        headers = {"Content-Type": "application/json", "X-Roster-Timestamp": stamp,
                   "X-Roster-Signature": self._sign(body, stamp)}
        # HTTPSConnection validates TLS by default and never follows redirects.
        connection = http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout)
        watchdog = None
        try:
            deadline = time.monotonic() + self.timeout
            connection.connect()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Publisher connection deadline")
            transport_socket = connection.sock

            def interrupt():
                # A socket timeout alone can be evaded by slow-drip headers.
                # Keep the original socket even if HTTP detaches it on close.
                try:
                    transport_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            watchdog = threading.Timer(remaining, interrupt)
            watchdog.daemon = True
            watchdog.start()
            connection.request("POST", self.path, body=body, headers=headers)
            response = connection.getresponse()
            if response.status != 200 or response.getheader("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise ValueError("Roster ingestion rejected")
            data = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Publisher deadline")
                chunk = response.read1(min(4096, 4097 - len(data)))
                data.extend(chunk)
                if len(data) > 4096:
                    raise ValueError("Oversized publisher response")
                if not chunk:
                    break
            result = json.loads(data)
            if (not isinstance(result, dict) or result.get("accepted") is not True
                    or type(result.get("observedAt")) is not int
                    or result["observedAt"] != snapshot["generatedAt"]):
                raise ValueError("Invalid ingestion acknowledgement")
            return result
        finally:
            if watchdog is not None:
                watchdog.cancel()
            connection.close()
