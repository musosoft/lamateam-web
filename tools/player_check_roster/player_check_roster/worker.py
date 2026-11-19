"""Complete, fail-closed read-only observations. No persistence or logging of PII."""

import ipaddress
import re
import time
from datetime import datetime, timedelta, timezone

from .steam import canonical

SERVER_ID = "82.208.17.101:27516"
RECENT_MS = 30 * 60 * 1000
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def timestamp(value, upper):
    if type(value) is not int or not 0 < value <= min(upper, 9007199254740991):
        raise ValueError("Invalid timestamp")
    return value


def valid_name(value):
    # JavaScript counts UTF-16 code units, not Python Unicode code points.
    if (not isinstance(value, str) or not value.strip()
            or len(value.encode("utf-16-le")) // 2 > 128
            or re.search(r"[\x00-\x1f\x7f]", value)):
        raise ValueError("Invalid player name")
    return value


def normalize_ip(value):
    if not isinstance(value, str) or "%" in value:
        raise ValueError("Invalid IP literal")
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return str(address)


def status_ip(value):
    """Status endpoints must include a port; output is a bare canonical IP."""
    match = re.fullmatch(r"\[([^\]]+)\]:([0-9]+)", value)
    if match:
        host, port = match.groups()
    else:
        host, separator, port = value.rpartition(":")
        if not separator or ":" in host or not port.isascii() or not port.isdecimal():
            raise ValueError("Invalid status endpoint")
    if not 1 <= int(port) <= 65535:
        raise ValueError("Invalid status port")
    return normalize_ip(host)


class PlayerParser:
    """Strict Source status table with count and #end completeness checks.

    Unknown variants intentionally fail instead of silently omitting players.
    Explicit BOT rows are counted but excluded. Pending/unknown humans abort.
    """

    HEADER = re.compile(r"#\s+userid\s+name\s+uniqueid\s+connected\s+ping\s+loss\s+state\s+adr")
    ROW = re.compile(
        r'#\s+([0-9]+)\s+"(.*)"\s+(\S+)\s+([0-9]+:[0-9]{2}(?::[0-9]{2})?)'
        r'\s+([0-9]+)\s+([0-9]+)\s+active\s+(\S+)')
    BOT = re.compile(r'#\s+([0-9]+)\s+"(.*)"\s+BOT\s+active')
    COUNT = re.compile(r"players\s*:\s*([0-9]+)(?: humans, ([0-9]+) bots)? \([0-9]+ max\)")

    def parse_status(self, output):
        if not isinstance(output, str) or len(output.encode("utf-8")) > 65536:
            raise ValueError("Invalid status size")
        players, users, identities = [], set(), set()
        expected = None
        header = ended = False
        rows = 0
        for raw in output.splitlines():
            line = raw.strip()
            if not line:
                continue
            if not header:
                count = self.COUNT.fullmatch(line)
                if count:
                    if expected is not None:
                        raise ValueError("Duplicate status count")
                    expected = int(count[1]) + int(count[2] or 0)
                elif line.startswith("players"):
                    raise ValueError("Malformed status count")
                if self.HEADER.fullmatch(line):
                    if expected is None or expected > 128:
                        raise ValueError("Missing or excessive status count")
                    header = True
                elif line.startswith("#"):
                    raise ValueError("Malformed status header")
                continue
            if ended:
                raise ValueError("Trailing status data")
            if line == "#end":
                ended = True
                continue
            match, bot = self.ROW.fullmatch(line), self.BOT.fullmatch(line)
            if not match and not bot:
                raise ValueError("Malformed status row")
            row = match or bot
            user = int(row[1])
            if not 1 <= user <= 2147483647 or user in users:
                raise ValueError("Invalid or duplicate status user")
            users.add(user)
            rows += 1
            name = valid_name(row[2])
            if bot:
                continue
            steam64, steam2 = canonical(match[3])
            if steam64 in identities:
                raise ValueError("Duplicate status identity")
            identities.add(steam64)
            parts = [int(part) for part in match[4].split(":")]
            if parts[-1] >= 60 or (len(parts) == 3 and parts[-2] >= 60):
                raise ValueError("Invalid status duration")
            duration = parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0] * 3600 + parts[1] * 60 + parts[2]
            players.append({"steamId64": steam64, "steamId2": steam2,
                            "userId": user, "name": name, "ip": status_ip(match[7]),
                            "connected_seconds": duration})
        if not header or not ended or rows != expected:
            raise ValueError("Incomplete status observation")
        return players


class MysqlDisconnects:
    """SELECT-only adapter for install.sql schema, with explicit UTC event times.

    Tables are MyISAM: READ ONLY transactions are not a write-security boundary.
    The supplied DB account MUST have SELECT-only grants.
    """

    SQL = """
        SELECT u.uniqueId, p.lastName, MAX(d.eventTime) AS disconnectedAt
        FROM hlstats_Events_Disconnects d
        JOIN hlstats_Players p ON p.playerId = d.playerId
        JOIN hlstats_PlayerUniqueIds u ON u.playerId = p.playerId AND u.game = p.game
        WHERE d.serverId = %s AND p.game = %s AND u.game = %s
          AND d.eventTime > %s AND d.eventTime <= %s
        GROUP BY u.uniqueId, p.lastName
        ORDER BY disconnectedAt DESC, u.uniqueId
        LIMIT 257
    """

    def __init__(self, connection_factory, game, server_id):
        if type(server_id) is not int or server_id <= 0:
            raise ValueError("Explicit HLstats server ID required")
        if not isinstance(game, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,32}", game):
            raise ValueError("Explicit HLstats game required")
        self.connect, self.game, self.server_id = connection_factory, game, server_id

    def recent(self, now_ms):
        timestamp(now_ms, 9007199254740991)
        end = (EPOCH + timedelta(milliseconds=now_ms)).replace(tzinfo=None)
        connection = self.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(self.SQL, (self.server_id, self.game, self.game,
                                         end - timedelta(minutes=30), end))
                rows = cursor.fetchall()
        finally:
            connection.close()
        if len(rows) > 256:
            raise ValueError("Recent observation exceeds record bound")
        recent = {}
        for identity, name, event_time in rows:
            # HLstats daemon strips STEAM_N: when storing uniqueId.
            if isinstance(identity, str) and re.fullmatch(r"[01]:[0-9]{1,10}", identity):
                identity = "STEAM_0:" + identity
            steam64, steam2 = canonical(identity)
            if not isinstance(event_time, datetime) or event_time.tzinfo is not None:
                raise ValueError("Expected naive UTC HLstats DATETIME")
            delta = event_time.replace(tzinfo=timezone.utc) - EPOCH
            at = delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000
            timestamp(at, now_ms)
            if now_ms - at >= RECENT_MS:
                raise ValueError("Recent query returned out-of-window event")
            record = {"steamId64": steam64, "steamId2": steam2,
                      "name": valid_name(name), "disconnectedAt": at}
            if steam64 not in recent or at > recent[steam64]["disconnectedAt"]:
                recent[steam64] = record
        return list(recent.values())


def validate_snapshot(snapshot, now_ms):
    """Mirror strict ingest fields/ranges before transmitting any body."""
    if (set(snapshot) != {"version", "serverId", "generatedAt", "connected", "recentlyDisconnected"}
            or type(snapshot["version"]) is not int or snapshot["version"] != 1
            or snapshot["serverId"] != SERVER_ID):
        raise ValueError("Invalid roster envelope")
    generated = timestamp(snapshot["generatedAt"], now_ms)
    if now_ms - generated >= 90000:
        raise ValueError("Stale observation")
    ids, users = set(), set()
    for key, limit in (("connected", 128), ("recentlyDisconnected", 256)):
        rows = snapshot[key]
        if not isinstance(rows, list) or len(rows) > limit:
            raise ValueError("Invalid roster bounds")
        for row in rows:
            fields = {"steamId64", "steamId2", "name"}
            fields |= {"userId", "ip", "isAdmin", "connectedAt"} if key == "connected" else {"disconnectedAt"}
            if set(row) != fields:
                raise ValueError("Invalid roster fields")
            steam64, _ = canonical(row["steamId64"])
            if steam64 != row["steamId64"] or canonical(row["steamId2"])[0] != steam64 or not row["steamId2"].startswith("STEAM_") or steam64 in ids:
                raise ValueError("Invalid or duplicate roster identity")
            ids.add(steam64)
            valid_name(row["name"])
            if key == "connected":
                user = row["userId"]
                if type(user) is not int or not 1 <= user <= 2147483647 or user in users or type(row["isAdmin"]) is not bool:
                    raise ValueError("Invalid roster user/admin")
                users.add(user)
                normalize_ip(row["ip"])
                timestamp(row["connectedAt"], generated)
            else:
                at = timestamp(row["disconnectedAt"], generated)
                if generated - at >= RECENT_MS:
                    raise ValueError("Stale disconnect")


def build_snapshot(rcon, mysql, admin_allowlist, now_ms=None):
    """Any collection/validation failure aborts the entire cycle."""
    if not isinstance(admin_allowlist, (set, frozenset)) or any(
            canonical(item)[0] != item for item in admin_allowlist):
        raise ValueError("Verified canonical admin allowlist required")
    # Capture observation time BEFORE status I/O to avoid future-start estimates.
    observed = int(time.time() * 1000) if now_ms is None else now_ms
    timestamp(observed, 9007199254740991)
    connected = PlayerParser().parse_status(rcon.status())
    for row in connected:
        row["connectedAt"] = observed - row.pop("connected_seconds") * 1000
        row["isAdmin"] = row["steamId64"] in admin_allowlist
    ids = {row["steamId64"] for row in connected}
    recent = [row for row in mysql.recent(observed) if row["steamId64"] not in ids]
    result = {"version": 1, "serverId": SERVER_ID, "generatedAt": observed,
              "connected": connected, "recentlyDisconnected": recent}
    validate_snapshot(result, observed)
    return result
