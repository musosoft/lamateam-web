# External `/check` roster publisher

Operator-run Python 3.11+ collector, not a deployed service. Runtime reads RCON
`status`, SELECTs HLstats disconnects, and POSTs a signed roster. It never changes
SourceMod, executes admin commands, writes SQL/state, deploys, or stores snapshots.
Running the CLI **does real network IO**; tests do not. Do not run against production
as part of installation/testing.

Canonical contract: `../../docs/check-backend.md` and `../../src/lib/check.ts` in
this repository. This is a convenience gate, **not strong authentication**.
Shared IPs, stale observations and a compromised collector undermine it.

## Install and configure

From this directory, create an isolated environment (Unix example):

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[mysql,test]'
.venv/bin/python -m pytest -q
```

Supply environment through an operator-controlled, permission-restricted service
environment or secret manager. There is no implicit dotenv/config-file reader.
Never put credentials on command lines, in version control, or in debug logs.

Required settings:

| Variable                                                       | Meaning                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `RCON_HOST`                                                    | Exactly `82.208.17.101`                                                                                                              |
| `RCON_PORT`                                                    | Exactly `27516`                                                                                                                      |
| `RCON_PASSWORD`                                                | Collector-only console credential; firewall the RCON port                                                                            |
| `HL_SERVER_ID`                                                 | Explicit positive **numeric HLstats database server ID**, mapped by the operator to this same game server; not the payload serverId  |
| `HL_GAME`                                                      | Exact installed HLstats game code for that server (verify it; do not infer it from the executable name)                              |
| `HL_EVENT_TIMEZONE`                                            | Exactly `UTC`: operator assertion that stored disconnect `eventTime` DATETIMEs are UTC; see below                                    |
| `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Required HLstats SELECT-only connection                                                                                              |
| `PUBLISHER_URL`                                                | Full HTTPS endpoint, e.g. `https://lamateam.eu/api/check/roster`; no query, fragment, credentials, or trailing slash                 |
| `CHECK_ROSTER_INGEST_SECRET`                                   | Same secret text as the Worker; >=32 characters with >=32 random bytes of entropy encoded as hex/base64; **do not decode** that text |
| `ADMIN_STEAMID64_ALLOWLIST`                                    | Required comma-separated unique canonical Steam64 IDs, or explicit `NONE` after verifying that no admins should be admitted          |

Optional: `MYSQL_PORT=3306`, `NETWORK_TIMEOUT=5` (0.1–30 seconds),
`POLL_SECONDS=30` (15–30 seconds). Network operations have socket timeouts,
RCON packet/byte caps, HTTP response/body caps and an HTTPS socket-shutdown
watchdog covering request/headers/body; no redirect following or automatic retries.
OS DNS resolution is not covered by a strict whole-process wall-clock deadline.
Use a bounded service/job runtime if a hard end-to-end deadline is required.
MySQL is mandatory: missing driver, invalid config or failed query aborts publication.

### Admin membership is an operator-maintained SourceBans allowlist

There is **no automatic SourceBans integration**. Before starting, the operator must
verify/export currently applicable SourceBans admin membership for this exact
server, including effective group/server scope and revocations, convert it to
canonical public individual Steam64 IDs, and set the allowlist. Review/update it
whenever membership changes; **restart the publisher with the new environment**.
If membership cannot be verified, stop the publisher; do not reuse a stale list.
`NONE` is an explicit verified-empty list, not a fallback for lookup failure.

Only exact connected Steam64 membership sets `isAdmin:true`. Steam2/3 inputs in
the allowlist, empty entries, duplicates, invalid IDs or missing configuration
are errors. The list is not independently authenticated or freshness-checked by
this collector, so its correctness is an operator security responsibility.
There is no `sm_who` path: the official command does not expose the previously
guessed machine-readable response. No SourceMod runtime changes are needed.

### HLstats read-only source and timestamps

The SELECT is tested offline against a minimal schema fixture in
`tests/fixtures/hlstats-schema.sql`, based on this tool's original checkout. This
does not verify the live database version; confirm its schema and grants before
running the collector:

- `hlstats_Events_Disconnects`: `serverId`, `playerId`, `eventTime`.
- `hlstats_Players`: joins `playerId`, filters `game`, supplies required `lastName`.
- `hlstats_PlayerUniqueIds`: joins `playerId` and `game`, supplies `uniqueId`.

It filters one explicit `HL_SERVER_ID`, both player/identity game values, and an
explicit event window **`generatedAt - 30min < eventTime <= generatedAt`**.
It groups identities using their latest disconnect, orders deterministically, and
requests at most 257 rows to detect overflow beyond the 256-record contract.
Canonical duplicate identities are reduced to their newest event; connected
identities are removed from recent records. Names are current `Players.lastName`,
not necessarily names used at disconnect. HLstats' stored `Y:Z` identity format
(the daemon strips `STEAM_N:`) is converted only inside this adapter; full Steam2,
Steam3 and Steam64 IDs are also validated losslessly. Malformed identity/name/time
rows, future or cutoff-age events, query failure and overflow abort the cycle;
dates never fall back to the current time.

`eventTime` is a timezone-less DATETIME. This version intentionally supports only
**verified UTC event storage**. Do not set `HL_EVENT_TIMEZONE=UTC` to silence a
failure if the logger actually stores local wall time; add/test a timezone adapter
first. Changing MySQL session timezone alone does not reinterpret stored DATETIMEs.
No live schema, grants, server mapping or clock/timezone verification is performed
by offline tests. Verify those operationally before authorizing a run.

Use a DB account granted **SELECT only** on those three tables, over a trusted
local/private connection or authenticated tunnel. The adapter has no SQL writes
or session mutations. Installed tables are MyISAM: a `READ ONLY` transaction is
not a write-security boundary, and these reads are not an atomic DB snapshot.
There is no DB TLS configuration in this tool; do not expose its plain DB
connection over an untrusted network.

## Operator-authorized runtime

With the verified environment loaded:

```sh
.venv/bin/player-check-roster --once  # collects and POSTs once
.venv/bin/player-check-roster         # sequential 15–30s polling, default 30s
# Equivalent entry point:
.venv/bin/python -m player_check_roster.cli --once
```

Use one publisher only; no parallel instances or overlapping jobs. Any collection,
validation, admin configuration, signing, or ingestion failure terminates with
exit 1 and a generic redacted error. A successful cycle logs only `Roster accepted`.
Do not enable library wire/debug logging or log headers, exception tracebacks,
raw RCON, SQL values, player data or response bodies. Empty **complete** observations
are published. No SQLite State/dedup database is needed: each request replaces the
entire current/recent window. Removed legacy options (`STATE_DB`, `SERVER_ID`,
`SM_WHO_ENABLED`, `MAX_AGE_HOURS`, `MAX_DISCONNECTED`, `PUBLISHER_HMAC_SECRET`)
are not used.

### Fail-closed status format

Supported Source status output has a `players : N (M max)` or
`players : N humans, B bots (M max)` count, then exactly:

```text
# userid name uniqueid connected ping loss state adr
# 12 "Example" STEAM_0:0:1 00:10 15 0 active 192.0.2.1:27005
#end
```

Whitespace columns are flexible. Duration is MM:SS or HH:MM:SS; IPv4:port or
bracketed IPv6:port becomes a literal without a port, bracket or zone. Explicit
`# 13 "Bot" BOT active` rows count toward completeness but are excluded. Missing
count/header/end marker, truncation/count mismatch, malformed/unknown rows,
pending/unknown humans, missing identity/IP/name, invalid times, non-active human
states and duplicate Steam64/user IDs abort the entire observation. Unsupported
status variants deliberately fail: add a sanitized fixture and a strict parser
variant rather than skipping rows. Raw output must never be logged.

`connectedAt` is estimated from the status duration relative to the start of
collection, using integer milliseconds. Status duration rounding/collection jitter
can shift this estimate between snapshots and invalidate a backend capability,
requiring reauthorization; it is not an authoritative connection-event timestamp.

## Exact backend wire schema

No unknown fields. This example uses matching public individual identities:

```json
{
  "version": 1,
  "serverId": "82.208.17.101:27516",
  "generatedAt": 1800000000000,
  "connected": [
    {
      "steamId64": "76561197960265730",
      "steamId2": "STEAM_0:0:1",
      "userId": 12,
      "name": "Example",
      "ip": "192.0.2.1",
      "isAdmin": true,
      "connectedAt": 1799999990000
    }
  ],
  "recentlyDisconnected": [
    {
      "steamId64": "76561197960265732",
      "steamId2": "STEAM_0:0:2",
      "name": "Recent target",
      "disconnectedAt": 1799999995000
    }
  ]
}
```

Every payload timestamp is a positive safe-integer Unix **millisecond** value,
never in the future. Observation age must be <90s; recent age must be **<30min**
(the exact 30min cutoff is rejected by the backend). Recent Steam64 IDs are unique
and disjoint from connected. At most 128 connected/256 recent rows and 96 KiB UTF-8
JSON. Names are nonblank, <=128 UTF-16 code units, without ASCII controls. User IDs
are unique positive integers <=2147483647. IDs must agree; normalized Steam2 is
`STEAM_0:Y:Z` for both input universes 0/1. Account IDs must be 1–4294967295;
even Steam64 IDs are valid too.

POST unchanged UTF-8 JSON bytes to the full configured HTTPS `/api/check/roster`:

- `Content-Type: application/json`
- `X-Roster-Timestamp`: canonical decimal Unix **seconds**
- `X-Roster-Signature`: lowercase hex HMAC-SHA256 of the timestamp text, one LF,
  then the **exact transmitted body bytes**, keyed directly by the UTF-8 bytes of
  `CHECK_ROSTER_INGEST_SECRET`. No decoding, prefix or key derivation.

Backend header skew tolerance is inclusive ±60s, independent of snapshot freshness.
Only HTTP 200 JSON `{accepted:true,observedAt:<matching generatedAt>}` is success.
409 ordering conflicts, redirects and other non-200 responses stop the publisher;
there are no retries. Keep clocks synchronized. No auth/provider credentials
other than the dedicated ingest secret belong on this collector.

## Offline validation and limits

`python -m pytest -q` runs parser, Steam IDs, admin, SQL schema/window, timestamp,
redaction, RCON framing, HTTP bounds and exact signature tests. Python network
connections are explicitly forbidden by an autouse fixture. No production IO,
deployment, DB/RCON login or SourceMod change is part of the test suite.

When `../../src/lib/check.ts` and Node 24+ are present, an additional offline test
invokes the real backend with mocked KV/limiter/fetch to verify the Python-signed
payload, Steam conversions and HMAC interoperability. Otherwise that one test skips;
the independent Python protocol tests still run.
Tests cannot prove live status dialect, DB mapping/timezone/grants, SourceBans
membership, TLS/DNS availability or Cloudflare route/auth configuration. The
backend's KV ordering is best-effort/eventually consistent, not a replay ledger.
