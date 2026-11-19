"""Offline contract regressions. All production IO is forbidden, not merely unused."""

import copy
import hashlib
import hmac
import json
from pathlib import Path
import shutil
import socket
import struct
import subprocess
from unittest.mock import MagicMock

import pytest

from player_check_roster import cli
from player_check_roster.steam import BASE, canonical, steamid2_to_64, steamid64_to_2
from player_check_roster.transports import HttpPublisher, Rcon, packet, receive
from player_check_roster.worker import (
    EPOCH, RECENT_MS, SERVER_ID, MysqlDisconnects, PlayerParser, build_snapshot,
    validate_snapshot,
)
from datetime import timedelta

NOW = 1800000000000
SECRET = "offline-test-ingest-secret-not-for-production"
HEADER = "# userid name uniqueid connected ping loss state adr"
ROW = '# 12 "Example player" STEAM_0:0:1 01:02 15 0 active 192.0.2.1:27005'


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Production network IO forbidden")
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)


def status(rows=(ROW,), count=None):
    count = len(rows) if count is None else count
    return f"hostname: Offline\nplayers : {count} humans, 0 bots (64 max)\n{HEADER}\n" + "\n".join(rows) + "\n#end\n"


def snapshot():
    rcon = MagicMock()
    rcon.status.return_value = status()
    mysql = MagicMock()
    mysql.recent.return_value = []
    return build_snapshot(rcon, mysql, frozenset({str(BASE + 2)}), NOW)


@pytest.mark.parametrize("account", [1, 2, 3, 12345, 4294967294, 4294967295])
def test_ids_match_backend_arithmetic(account):
    expected = (str(BASE + account), f"STEAM_0:{account % 2}:{account // 2}")
    for value in (expected[0], expected[1], expected[1].replace("STEAM_0", "STEAM_1"), f"[U:1:{account}]"):
        assert canonical(value) == expected
    assert steamid2_to_64(expected[1]) == expected[0]
    assert steamid64_to_2(expected[0]) == expected[1]


@pytest.mark.parametrize("value", [str(BASE), str(BASE - 1), str(BASE + 4294967296),
    "STEAM_0:0:0", "[U:1:0]", "[U:1:4294967296]", "STEAM_1:1:2147483648",
    "STEAM_0:2:1", "BOT", "STEAM_ID_PENDING", " STEAM_0:0:1", "STEAM_0:0:1\n",
    "[U:1:１２]", "STEAM_0:0:00000000001", None])
def test_invalid_ids(value):
    with pytest.raises(ValueError):
        canonical(value)


def test_status_valid_empty_bots_ipv6_and_duration():
    assert PlayerParser().parse_status(status([])) == []
    text = status([ROW, '# 13 "Bot" BOT active'])
    assert len(PlayerParser().parse_status(text)) == 1
    row = ROW.replace("01:02", "1:02:03").replace("192.0.2.1:27005", "[::ffff:192.0.2.1]:27005")
    parsed = PlayerParser().parse_status(status([row]))[0]
    assert parsed["ip"] == "192.0.2.1"
    assert parsed["connected_seconds"] == 3723
    assert parsed["name"] == "Example player"


@pytest.mark.parametrize("text", ["", HEADER, status().replace("#end", ""),
    status().replace(HEADER, "# userid uniqueid connected ping loss addr name"),
    status().replace("players : 1 humans, 0 bots (64 max)", ""),
    status(count=2), status() + "garbage", status().replace("#end", "bad row\n#end"),
    status().replace('"Example player"', '""'), status().replace('"Example player"', '"bad\x01name"'),
    status().replace("STEAM_0:0:1", "STEAM_ID_PENDING"), status().replace("STEAM_0:0:1", "INVALID"),
    status().replace("192.0.2.1:27005", ""), status().replace("192.0.2.1:27005", "example.org:27005"),
    status().replace("192.0.2.1:27005", "192.0.2.1"), status().replace("01:02", "01:99"),
    status([ROW, ROW]), status([ROW, ROW.replace("# 12", "# 13")]),
    status([ROW, ROW.replace("STEAM_0:0:1", "STEAM_0:0:2")]),
    status().replace("# 12", "# 0"), status().replace("active", "spawning")])
def test_status_fails_closed(text):
    with pytest.raises(ValueError):
        PlayerParser().parse_status(text)


@pytest.mark.parametrize("value", [None, "", " ", "STEAM_0:0:1", "[U:1:2]", str(BASE),
    f"{BASE + 2},", f"{BASE + 2},{BASE + 2}"])
def test_allowlist_required_canonical(value):
    with pytest.raises(ValueError):
        cli.parse_admin_allowlist(value)


def test_admin_disjoint_and_exact_schema():
    assert cli.parse_admin_allowlist("NONE") == frozenset()
    assert cli.parse_admin_allowlist(str(BASE + 2)) == {str(BASE + 2)}
    result = snapshot()
    assert result["serverId"] == SERVER_ID
    assert result["generatedAt"] == NOW
    assert result["connected"][0]["connectedAt"] == NOW - 62000
    assert result["connected"][0]["isAdmin"] is True
    rcon, mysql = MagicMock(), MagicMock()
    rcon.status.return_value = status()
    mysql.recent.return_value = [dict(steamId64=str(BASE + 2), steamId2="STEAM_0:0:1",
                                    name="Same account", disconnectedAt=NOW - 1000)]
    result = build_snapshot(rcon, mysql, cli.parse_admin_allowlist("NONE"), NOW)
    assert result["recentlyDisconnected"] == []
    assert result["connected"][0]["isAdmin"] is False
    assert set(result["connected"][0]) == {"steamId64", "steamId2", "userId", "name", "ip", "isAdmin", "connectedAt"}
    mysql.recent.assert_called_once_with(NOW)
    mysql.recent.side_effect = RuntimeError("PII credential")
    with pytest.raises(RuntimeError):
        build_snapshot(rcon, mysql, frozenset(), NOW)


def db_adapter(rows=()):
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = rows
    return MysqlDisconnects(lambda: connection, "cstrike", 7), connection, cursor


def event(at):
    return (EPOCH + timedelta(milliseconds=at)).replace(tzinfo=None)


def test_recent_readonly_scoped_schema_query_and_names():
    adapter, connection, cursor = db_adapter([
        ("0:1", "Recent name", event(NOW - 1000)),
        ("STEAM_1:0:1", "Recent name", event(NOW - 2000)),
    ])
    result = adapter.recent(NOW)
    assert result == [{"steamId64": str(BASE + 2), "steamId2": "STEAM_0:0:1",
                       "name": "Recent name", "disconnectedAt": NOW - 1000}]
    sql, args = cursor.execute.call_args.args
    assert sql.strip().startswith("SELECT")
    assert cursor.execute.call_count == 1
    assert "d.serverId = %s" in sql and "p.game = %s AND u.game = %s" in sql
    assert "d.eventTime > %s AND d.eventTime <= %s" in sql and "LIMIT 257" in sql
    assert args == (7, "cstrike", "cstrike", event(NOW - RECENT_MS), event(NOW))
    schema = (Path(__file__).parent / "fixtures/hlstats-schema.sql").read_text()
    for table, columns in {"Events_Disconnects": ["playerId", "serverId", "eventTime"],
                           "Players": ["playerId", "lastName", "game"],
                           "PlayerUniqueIds": ["playerId", "uniqueId", "game"]}.items():
        block = schema.split(f"CREATE TABLE IF NOT EXISTS `hlstats_{table}` (", 1)[1].split(") ENGINE=", 1)[0]
        assert all(f"`{column}`" in block for column in columns)
    connection.close.assert_called_once()


@pytest.mark.parametrize("at", [NOW, NOW - RECENT_MS + 1])
def test_recent_valid_boundaries(at):
    assert db_adapter([("0:1", "Recent", event(at))])[0].recent(NOW)[0]["disconnectedAt"] == at


@pytest.mark.parametrize("row", [("0:1", "Recent", event(NOW - RECENT_MS)),
    ("0:1", "Recent", event(NOW + 1)), ("0:1", "", event(NOW)),
    ("0:1", "Recent", None), ("0:1", "Recent", "not a date"), ("INVALID", "Recent", event(NOW))])
def test_recent_no_fallback_or_invalid_rows(row):
    adapter, connection, _ = db_adapter([row])
    with pytest.raises(ValueError):
        adapter.recent(NOW)
    connection.close.assert_called_once()


def test_recent_overflow_query_failure_and_scope_validation():
    with pytest.raises(ValueError):
        db_adapter([("0:1", "Name", event(NOW))] * 257)[0].recent(NOW)
    adapter, connection, cursor = db_adapter()
    cursor.execute.side_effect = RuntimeError("database detail")
    with pytest.raises(RuntimeError):
        adapter.recent(NOW)
    connection.close.assert_called_once()
    for game, server in [("", 7), ("cstrike", 0), ("cstrike", "7"), ("sql'", 7)]:
        with pytest.raises(ValueError):
            MysqlDisconnects(lambda: None, game, server)


@pytest.mark.parametrize("field,value", [("generatedAt", NOW + 1), ("generatedAt", float(NOW)),
    ("generatedAt", True), ("generatedAt", NOW - 90000), ("serverId", 7), ("version", True)])
def test_envelope_validation(field, value):
    result = snapshot()
    result[field] = value
    with pytest.raises(ValueError):
        validate_snapshot(result, NOW)


def test_invalid_row_and_disconnection_cutoff():
    original = snapshot()
    for key, value in [("connectedAt", NOW + 1), ("connectedAt", True), ("name", ""),
                       ("userId", True), ("isAdmin", 1), ("ip", "192.0.2.1:1"), ("steamId2", "STEAM_0:0:2")]:
        result = copy.deepcopy(original)
        result["connected"][0][key] = value
        with pytest.raises(ValueError):
            validate_snapshot(result, NOW)
    original["recentlyDisconnected"] = [dict(steamId64=str(BASE + 4), steamId2="STEAM_0:0:2", name="Recent", disconnectedAt=NOW - RECENT_MS)]
    with pytest.raises(ValueError):
        validate_snapshot(original, NOW)


def http_fake(monkeypatch, result=None):
    connection = MagicMock()
    response = connection.getresponse.return_value
    response.status = 200
    response.getheader.return_value = "application/json"
    response.read1.side_effect = [json.dumps(result or {"accepted": True, "observedAt": NOW}).encode(), b""]
    factory = MagicMock(return_value=connection)
    monkeypatch.setattr("player_check_roster.transports.http.client.HTTPSConnection", factory)
    monkeypatch.setattr("player_check_roster.transports.time.time", lambda: NOW / 1000)
    return factory, connection, response


def test_exact_post_body_signature_headers_ack(monkeypatch):
    factory, connection, _ = http_fake(monkeypatch)
    publisher = HttpPublisher("https://example.invalid/api/check/roster", SECRET)
    result = snapshot()
    assert publisher.publish(result) == {"accepted": True, "observedAt": NOW}
    method, path = connection.request.call_args.args
    body, headers = connection.request.call_args.kwargs.values()
    assert method == "POST" and path == "/api/check/roster"
    assert json.loads(body) == result
    assert headers == {"Content-Type": "application/json", "X-Roster-Timestamp": "1800000000",
                       "X-Roster-Signature": hmac.new(SECRET.encode(), b"1800000000\n" + body, hashlib.sha256).hexdigest()}
    assert publisher._sign(b'{ "utf8":"\xc3\xa9" }\n', 1800000000) == hmac.new(SECRET.encode(), b'1800000000\n{ "utf8":"\xc3\xa9" }\n', hashlib.sha256).hexdigest()
    factory.assert_called_once_with("example.invalid", 443, timeout=5.0)
    connection.close.assert_called_once()


def test_http_deadline_watchdog_covers_headers_and_cancels(monkeypatch):
    _, connection, _ = http_fake(monkeypatch)
    timer = MagicMock()
    factory = MagicMock(return_value=timer)
    monkeypatch.setattr("player_check_roster.transports.threading.Timer", factory)
    HttpPublisher("https://example.invalid/api/check/roster", SECRET).publish(snapshot())
    duration, interrupt = factory.call_args.args
    assert 0 < duration <= 5
    assert timer.daemon is True
    timer.start.assert_called_once()
    timer.cancel.assert_called_once()
    interrupt()
    connection.sock.shutdown.assert_called_once_with(socket.SHUT_RDWR)


@pytest.mark.parametrize("url", ["http://example.invalid/api/check/roster", "https://example.invalid", "https://example.invalid/api/check/roster/", "https://user:pass@example.invalid/api/check/roster", "https://example.invalid/api/check/roster?q=x", "https://example.invalid/api/check/roster#fragment"])
def test_destination_restrictions(url):
    with pytest.raises(ValueError):
        HttpPublisher(url, SECRET)


@pytest.mark.parametrize("kind", ["redirect", "oversize", "bad_ack", "wrong_time", "deadline"])
def test_http_failures_close_no_retry(monkeypatch, kind):
    _, connection, response = http_fake(monkeypatch)
    if kind == "redirect":
        response.status = 302
    elif kind == "oversize":
        response.read1.side_effect = [b"x" * 4097]
    elif kind == "bad_ack":
        response.read1.side_effect = [b'{"accepted":false}', b""]
    elif kind == "wrong_time":
        response.read1.side_effect = [b'{"accepted":true,"observedAt":1}', b""]
    else:
        ticks = iter([0, 0, 10])
        monkeypatch.setattr("player_check_roster.transports.time.monotonic", lambda: next(ticks))
    with pytest.raises((ValueError, TimeoutError)):
        HttpPublisher("https://example.invalid/api/check/roster", SECRET).publish(snapshot())
    assert connection.request.call_count == 1
    connection.close.assert_called_once()


def test_rcon_packet_and_exact_fragment_join(monkeypatch):
    raw = packet(12, 0, "test")
    assert struct.unpack("<i", raw[:4])[0] == len(raw) - 4
    sock = MagicMock()
    monkeypatch.setattr(socket, "create_connection", MagicMock(return_value=sock))
    monkeypatch.setattr("player_check_roster.transports.receive", MagicMock(side_effect=[
        (11, 0, ""), (11, 2, ""), (12, 0, "abc"), (12, 0, "def"), (13, 0, "")]))
    assert Rcon("192.0.2.1", 27516, "dummy-password").status() == "abcdef"
    sent = [call.args[0] for call in sock.__enter__.return_value.sendall.call_args_list]
    assert sent[1] == packet(12, 2, "status") and sent[2] == packet(13, 0, "")
    assert not hasattr(Rcon, "who")


def test_rcon_receive_rejects_truncation_and_lengths():
    sock = MagicMock()
    sock.recv.side_effect = [struct.pack("<i", 9)]
    with pytest.raises(ValueError):
        receive(sock, float("inf"))
    sock.recv.side_effect = [b""]
    with pytest.raises(ConnectionError):
        receive(sock, float("inf"))


def test_cli_errors_redacted_and_no_partial_publication(monkeypatch, caplog):
    monkeypatch.setattr("sys.argv", ["player-check-roster", "--once"])
    monkeypatch.setattr(cli, "run", MagicMock(side_effect=RuntimeError("SECRET 192.0.2.1 PlayerName")))
    with pytest.raises(SystemExit) as exit_info:
        cli.main()
    assert exit_info.value.code == 1
    assert "Publisher stopped" in caplog.text
    assert all(text not in caplog.text for text in ["SECRET", "192.0.2.1", "PlayerName", "Traceback"])


def test_actual_backend_accepts_python_payload_and_ids():
    """Sibling backend integration, local Node only, no sockets/DB/providers."""
    backend = Path(__file__).resolve().parents[3] / "src/lib/check.ts"
    if not backend.exists() or not shutil.which("node"):
        pytest.skip("Optional sibling backend and Node 24+ required")
    roster = snapshot()
    roster["connected"][0]["name"] = "Offline hráč"
    roster["recentlyDisconnected"] = [{"steamId64": str(BASE + 4), "steamId2": "STEAM_0:0:2",
                                         "name": "Recent target", "disconnectedAt": NOW - 1000}]
    body = json.dumps(roster, ensure_ascii=False, separators=(",", ":"))
    signature = HttpPublisher("https://example.invalid/api/check/roster", SECRET)._sign(body.encode(), NOW // 1000)
    script = """
      import {createCheckHandlers,checkSteamId,signCheckRoster} from %s;
      const input=JSON.parse(await new Response(process.stdin).text());
      for (const [value,expected] of input.ids) {
        if(checkSteamId(value)!==expected) throw Error('ID mismatch');
      }
      if(await signCheckRoster(input.body,input.secret,'1800000000')!==input.signature) throw Error('HMAC mismatch');
      let stored;
      const handlers=createCheckHandlers({now:()=>1800000000000,ingestSecret:input.secret,
        authSecret:'offline-auth-secret-not-for-production',rateLimiter:{limit:async()=>({success:true})},
        kv:{get:async()=>null,put:async(k,v)=>{stored=v}},fetch:async()=>{throw Error('Network forbidden')}});
      const response=await handlers.roster(new Request('https://example.invalid/api/check/roster',{
        method:'POST',body:input.body,headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.9',
          'X-Roster-Timestamp':'1800000000','X-Roster-Signature':input.signature}}));
      if(response.status!==200 || !stored) throw Error('Backend rejected payload: '+response.status);
      console.log('accepted');
    """ % json.dumps(backend.as_uri())
    values = ["STEAM_0:0:1", "STEAM_1:1:12345", "[U:1:12345]", str(BASE + 2), str(BASE + 4294967295)]
    result = subprocess.run(["node", "--input-type=module", "-e", script],
        input=json.dumps({"body": body, "secret": SECRET, "signature": signature,
                          "ids": [[value, canonical(value)[0]] for value in values]}),
        text=True, capture_output=True, timeout=15, check=True)
    assert result.stdout.strip() == "accepted"


def test_request_body_bound_before_network(monkeypatch):
    roster = snapshot()
    roster["connected"][0]["name"] = "漢" * 128
    roster["recentlyDisconnected"] = [
        {"steamId64": str(BASE + 2 * index), "steamId2": f"STEAM_0:0:{index}",
         "name": "漢" * 128, "disconnectedAt": NOW - 1000}
        for index in range(2, 258)
    ]
    monkeypatch.setattr("player_check_roster.transports.time.time", lambda: NOW / 1000)
    factory = MagicMock()
    monkeypatch.setattr("player_check_roster.transports.http.client.HTTPSConnection", factory)
    with pytest.raises(ValueError, match="Oversized roster body"):
        HttpPublisher("https://example.invalid/api/check/roster", SECRET).publish(roster)
    factory.assert_not_called()


def test_cli_once_pipeline_and_collection_failure(monkeypatch):
    settings = {"ADMIN_STEAMID64_ALLOWLIST": str(BASE + 2), "HL_EVENT_TIMEZONE": "UTC",
                "RCON_HOST": "82.208.17.101", "RCON_PORT": "27516", "RCON_PASSWORD": "dummy-only",
                "MYSQL_HOST": "localhost", "MYSQL_USER": "offline", "MYSQL_PASSWORD": "dummy-only",
                "MYSQL_DATABASE": "offline", "HL_GAME": "cstrike", "HL_SERVER_ID": "7",
                "PUBLISHER_URL": "https://example.invalid/api/check/roster", "CHECK_ROSTER_INGEST_SECRET": SECRET}
    for key, value in settings.items():
        monkeypatch.setenv(key, value)
    for key in ("NETWORK_TIMEOUT", "POLL_SECONDS", "MYSQL_PORT"):
        monkeypatch.delenv(key, raising=False)
    rcon, mysql, publisher = MagicMock(), MagicMock(), MagicMock()
    rcon.status.return_value = status()
    mysql.recent.return_value = []
    monkeypatch.setattr(cli, "Rcon", MagicMock(return_value=rcon))
    monkeypatch.setattr(cli, "MysqlDisconnects", MagicMock(return_value=mysql))
    monkeypatch.setattr(cli, "HttpPublisher", MagicMock(return_value=publisher))
    monkeypatch.setitem(__import__("sys").modules, "pymysql", MagicMock())
    cli.run(once=True)
    assert publisher.publish.call_count == 1
    publisher.publish.reset_mock()
    rcon.status.return_value = status().replace("#end", "")
    with pytest.raises(ValueError):
        cli.run(once=True)
    publisher.publish.assert_not_called()
    monkeypatch.delenv("ADMIN_STEAMID64_ALLOWLIST")
    with pytest.raises(ValueError):
        cli.run(once=True)
    publisher.publish.assert_not_called()
