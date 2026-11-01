# Admin review-only `/check` backend

No SourceMod publisher is required or installed. Observed player identity is spoofable:
MOTD query hints are observations, **not proof of identity, online status, admin
membership or cheating**. Manual Mizan results are review leads only. No bans,
RCON, SourceBans writes, automatic batch checks or AI summaries are performed.

## Designer contract

- `GET /api/check/players` → `{observedAt, players:[{communityId,lastSeen}]}`.
  Canonical Steam64 strings, integer Unix-millisecond times, latest first;
  deterministic ID ordering breaks timestamp ties. At most 30 unique identities.
  `observedAt` is the newest retained observation time, or `null` when empty.
  A server-side Steam name lookup adds `displayName: string | null` to each player;
  failures leave it null. No IPs, query extras, roster or capability are exposed.
- `POST /api/check/search` accepts exactly `{communityId}` as Steam64, Steam3
  (`[U:1:4]`) or Steam2 (`STEAM_0:0:2`, `STEAM_1:0:2`). Normalizes public individual
  accounts losslessly. The target does not require roster membership; the caller
  must be a verified allowlisted admin.
  Each explicit request makes at most one fresh Mizan call; no retry or caching.
  Unknown fields, the obsolete `{steamId64}` request, invalid IDs and JSON fail 400.

Both are HTTPS-only and admin/review-only. POST requires same-origin `Origin`
and JSON. Any supplied Origin must match and Fetch Metadata must be `same-origin`.
No CORS. Responses use `no-store`, `nosniff`, same-origin resource policy.
The existing `CHECK_RATE_LIMITER` remains: namespace 1002, six requests per 60s
per action/IP HMAC digest. Requires trusted Cloudflare ingress IP, existing
`SESSION`, `CHECK_AUTH_SECRET` (32+ characters), and limiter; fails closed.
The auth secret remains necessary for the per-IP digest, **not** a user login.
Cloudflare quotas are approximate/per-colo, not a global spending cap.

## Admin authorization and operator configuration

Both route wrappers pass only `Astro.locals.steamProfile?.steamID` to the
handlers. Middleware obtains that identity from the verified signed Steam session;
request bodies, query parameters, MOTD hints and the legacy display cookie cannot
authorize a caller. Signed sessions alone do not grant access: the shared
server-side `isCheckAdmin(steamID, allowlist)` helper in `src/lib/check-admin.ts`
also requires membership in `CHECK_ADMIN_STEAM64_ALLOWLIST`.

A separate authorized operator must set that Cloudflare Worker **secret** to
comma-separated canonical public individual Steam64 IDs, with no whitespace,
empty entries or duplicates. Derive eligible members from local
`/home/muso/dev/srcds/lama-srcds/cstrike/addons/sourcemod/configs/sourcebans/sb_admins.cfg`:
eligible roles are exactly `Owner`, `Root`, and `Head Admin`. Convert their Steam
IDs losslessly to canonical Steam64 and deduplicate before configuring the secret.
Do not include other roles. This is an operator-maintained snapshot, not a live
SourceBans lookup; update it when membership changes or access is revoked.

No production allowlist values belong in code, public/build variables, rendered
markup, client bundles or logs. The runtime reads only the server-side binding.
Missing, malformed, duplicate or noncanonical configuration, invalid caller IDs,
absent identity and nonmembers all deny with sanitized 403 and `no-store`, before
KV/provider work. These implementation changes do not set secrets or deploy.

Search additionally requires server-only `MIZAN_API_KEY`. It must never appear
in public vars, query strings, rendered markup, client code or logs.

## Durable MOTD source

The existing `/api/stats/motd` handler records each accepted normalized
`communityid` **after** existing method, game-UA, origin, input and edge-rate
guards, even on cache hits or absent HLstats data. UA/identity are spoofable.
It awaits one per-ID KV write before loading stats. Storage failures do not break
MOTD stats and are never exposed/logged; later visits can retry the observation.
There is no background Mizan call.

Existing SESSION namespace `78ed4236838944ed86f5f0cedbac92c6` stores
`check:v2:player:{Steam64}` → `{"lastSeen":UnixMilliseconds}` with seven-day TTL.
Only the ID (in the key) and timestamp are retained; no name, IP or full URL.
There is no shared-array read/modify/write. Distinct IDs cannot overwrite one
another. KV is eventually consistent: visibility can lag and concurrent writes
for the **same ID** can reorder; this is not a transactional chronological ledger.
No unrelated session entries are modified.

GET performs **one** prefix list with limit 1000, then at most one get per valid
key, in groups of 20. Expired, future or malformed observations are excluded.
An incomplete list or KV error returns 503 rather than falsely claiming an
arbitrary lexicographic subset is the latest 30. If the retained seven-day
population exceeds 1000 keys, use a timestamp-indexed Durable Object/transactional
store before increasing capacity; no unbounded pagination is allowed.

The source includes a bootstrap of the 30 most recent distinct CommunityIDs
verified from the seven-day Cloudflare Workers Logs view on 2026-11-01. It stores
only normalized Steam64 IDs and their original observation times. The bootstrap
is merged with live KV values, where newer observations for the same ID win; each
bootstrap entry naturally expires seven days after its observed time. This makes
the initial page useful immediately, then MOTD visits update the list without
another log export. The snapshot is historical observation data, not a connected
roster or proof of identity. `recordCheckPlayer(kv, identity, observedMilliseconds,
now)` uses only the remaining original TTL; observations with under 60 seconds
remaining are rejected (KV minimum TTL).

## Mizan response contract

One fixed `GET https://api.mizan.ac/v1/players/{Steam64}`, with server-only
`X-API-Key` and JSON Accept header. No browser headers, names, IPs or prompts.
Redirects are rejected, deadline 12s including streaming, response limit 128 KiB,
request body limit 1024 bytes regardless of Content-Length.

Successful browser response:

```ts
{
  queriedAt: number; // Worker Unix milliseconds
  profileUrl: string; // locally constructed https://mizan.ac/players/steam/{Steam64}
  steamId64: string;
  cheater: boolean;
  trolling: boolean;
  bans: {
    total: number; active: number; sources: number; conduct: number;
    categories: string[]; games: string[]; lastAt: string | null;
  };
  recordPresent: boolean;
}
```

Adapter requires exact matching `data.player.provider === "steam"` and string
ID, booleans, nonnegative safe integer counts and present `record`. Only opaque
record presence is exposed. Unknown/Steam/linked-account data is discarded.
Arrays permit at most 128 plain nonblank strings of at most 128 characters,
without controls. `lastAt` must be null or a bounded parseable RFC3339 timestamp.
Undocumented variants fail closed, never imply a clear account. Detailed results
are not persisted. Render untrusted labels as escaped text, not HTML; canonical
profile links should use `rel="noopener noreferrer"`.

Errors: 400 invalid input, 403 guard rejection, 405 method, 413 body size,
415 content type, 429 rate limit (`Retry-After: 60`), 502 provider/schema/redirect,
503 missing bindings/KV/capacity, 504 timeout. All are sanitized. Provider errors
including 404 do not mean clean. No entitlement, free quota or global cap is assumed.

## Legacy endpoints

`/api/check/authorize`, `/roster` and `/source-roster` remain separate and keep
their existing authentication, IP, signing, schema, freshness, sealing and rate
guards. They do not supply admin players/search or grant allowlist membership. Neither ingestion endpoint
automatically queries Mizan. Legacy ingest secrets remain optional unless these
endpoints are intentionally used. Do not deploy a SourceMod Mizan plugin.

## Focused local validation

`node --test src/lib/check-admin.test.mjs src/lib/check.test.mjs src/lib/check-steam-names.test.mjs src/lib/hlstats-motd.test.mjs`
and `pnpm typecheck`. Tests mock bindings/provider and do not establish live
Cloudflare header guarantees, global ordering, deployment or Mizan entitlement.
