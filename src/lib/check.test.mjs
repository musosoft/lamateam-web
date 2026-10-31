import assert from "node:assert/strict";
import test from "node:test";
import {
  createCheckHandlers,
  checkSteamId,
  signCheckRoster,
  CHECK_SERVER_ID,
  CHECK_ROSTER_KEY,
} from "./check.ts";
import {
  CHECK_PLAYER_PREFIX,
  CHECK_PLAYER_TTL,
  latestCheckPlayers,
  recordCheckPlayer,
} from "./check-players.ts";
import { createHlstatsMotdHandler } from "./hlstats-motd.ts";

const epoch = 1_800_000_000_000;
const id = "76561197960265732";
const origin = "https://lamateam.eu";
const secret = "offline-secret-not-for-production-1234";
function providerResult() {
  return {
    data: {
      player: { provider: "steam", id },
      cheater: false,
      trolling: false,
      bans: {
        total: 0,
        active: 0,
        sources: 0,
        conduct: 0,
        categories: [],
        games: [],
        lastAt: null,
      },
      record: null,
      steam: null,
    },
  };
}
function request(action, body, headers = {}) {
  return new Request(`${origin}/api/check/${action}`, {
    method: action === "players" ? "GET" : "POST",
    headers: {
      origin,
      "cf-connecting-ip": "192.0.2.1",
      "content-type": "application/json",
      ...headers,
    },
    ...(action === "players"
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function fixture(overrides = {}) {
  const values = new Map(),
    calls = [],
    writes = [],
    lists = [],
    gets = [];
  const kv = {
    get: async (key) => {
      gets.push(key);
      return values.get(key) ?? null;
    },
    put: async (key, value, options) => {
      values.set(key, value);
      writes.push({ key, value, options });
    },
    list: async (options) => {
      lists.push(options);
      const names = [...values.keys()]
        .filter((k) => k.startsWith(options.prefix))
        .sort();
      return {
        keys: names.slice(0, options.limit).map((name) => ({ name })),
        list_complete: names.length <= options.limit,
      };
    },
  };
  const deps = {
    kv,
    authSecret: secret,
    ingestSecret: secret,
    sourceIngestToken: secret,
    mizanKey: "offline-provider-key",
    now: () => epoch,
    rateLimiter: { limit: async () => ({ success: true }) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(providerResult());
    },
    ...overrides,
  };
  return {
    deps,
    kv,
    values,
    calls,
    writes,
    lists,
    gets,
    handlers: createCheckHandlers(deps),
  };
}

test("normalizes public individual Steam64/Steam3/Steam2 losslessly and rejects invalid input", () => {
  for (const input of [id, "[U:1:4]", "STEAM_0:0:2", "STEAM_1:0:2"])
    assert.equal(checkSteamId(input), id);
  assert.equal(checkSteamId("[U:1:4294967295]"), "76561202255233023");
  for (const input of [
    null,
    123,
    "BOT",
    "STEAM_2:0:2",
    "[U:1:0]",
    "[U:1:4294967296]",
    "76561197960265728",
    "76561202255233024",
    " " + id,
    "x".repeat(33),
  ])
    assert.equal(checkSteamId(input), null);
});

test("per-ID writes normalize/deduplicate, retain only time, and expire after seven days", async () => {
  const f = fixture();
  await recordCheckPlayer(f.kv, "STEAM_0:0:2", epoch - 1000, epoch);
  await recordCheckPlayer(f.kv, "[U:1:4]", epoch, epoch);
  assert.equal(f.values.size, 1);
  assert.deepEqual(JSON.parse(f.values.get(CHECK_PLAYER_PREFIX + id)), {
    lastSeen: epoch,
  });
  assert.equal(f.writes[0].options.expirationTtl, CHECK_PLAYER_TTL - 1);
  assert.equal(f.writes[1].options.expirationTtl, CHECK_PLAYER_TTL);
  for (const [input, time] of [
    ["BOT", epoch],
    [id, epoch + 1],
    [id, epoch - CHECK_PLAYER_TTL * 1000],
    [id, NaN],
  ])
    await assert.rejects(recordCheckPlayer(f.kv, input, time, epoch));
});

test("bounded listing sorts/deduplicates and caps latest 30, excluding corrupt/expired/future records", async () => {
  const f = fixture();
  for (let i = 1; i <= 40; i++)
    await recordCheckPlayer(f.kv, `[U:1:${i}]`, epoch - i * 1000, epoch);
  f.values.set(CHECK_PLAYER_PREFIX + "76561197960265828", "{");
  f.values.set(
    CHECK_PLAYER_PREFIX + "76561197960265829",
    JSON.stringify({ lastSeen: epoch + 1 }),
  );
  f.values.set(
    CHECK_PLAYER_PREFIX + "76561197960265830",
    JSON.stringify({ lastSeen: epoch - CHECK_PLAYER_TTL * 1000 }),
  );
  f.values.set(
    CHECK_PLAYER_PREFIX + "BOT",
    JSON.stringify({ lastSeen: epoch }),
  );
  const result = await latestCheckPlayers(f.kv, epoch);
  assert.equal(result.players.length, 30);
  assert.equal(result.observedAt, epoch - 1000);
  assert.equal(result.players.at(-1).lastSeen, epoch - 30_000);
  assert.equal(new Set(result.players.map((p) => p.communityId)).size, 30);
  assert.deepEqual(f.lists, [{ prefix: CHECK_PLAYER_PREFIX, limit: 1000 }]);
  assert.ok(f.gets.length <= 1000);
});

test("bootstraps the actual recent log snapshot and expires it at its observed age", async () => {
  const f = fixture();
  const firstSeen = Date.parse("2026-11-01T02:22:17.296+07:00");
  const result = await latestCheckPlayers(f.kv, firstSeen + 1000);
  assert.equal(result.players.length, 30);
  assert.equal(result.players[0].communityId, "76561198766056125");
  assert.equal(result.players[0].lastSeen, firstSeen);
  assert.equal(
    new Set(result.players.map((player) => player.communityId)).size,
    30,
  );

  const newer = firstSeen + 2000;
  await recordCheckPlayer(f.kv, "76561198766056125", newer, newer);
  const merged = await latestCheckPlayers(f.kv, newer);
  assert.equal(merged.players[0].lastSeen, newer);

  const expired = await latestCheckPlayers(
    f.kv,
    firstSeen + CHECK_PLAYER_TTL * 1000 + 2001,
  );
  assert.deepEqual(expired, { observedAt: null, players: [] });
});

test("public GET works without cookies or roster, is minimized, and never calls Mizan", async () => {
  const f = fixture();
  assert.deepEqual(
    await (await f.handlers.players(request("players"))).json(),
    { observedAt: null, players: [] },
  );
  await recordCheckPlayer(f.kv, id, epoch, epoch);
  f.values.set(CHECK_ROSTER_KEY, "corrupt unrelated legacy snapshot");
  const response = await f.handlers.players(
    request("players", null, { cookie: "invalid" }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    observedAt: epoch,
    players: [{ communityId: id, lastSeen: epoch }],
  });
  assert.equal(f.calls.length, 0);
});

test("public manual search accepts normalized identity outside roster and makes exactly one bounded read", async () => {
  for (const communityId of [id, "STEAM_0:0:2", "[U:1:4]"]) {
    const f = fixture();
    const response = await f.handlers.search(
      request("search", { communityId }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      queriedAt: epoch,
      profileUrl: `https://mizan.ac/players/steam/${id}`,
      steamId64: id,
      cheater: false,
      trolling: false,
      bans: providerResult().data.bans,
      recordPresent: false,
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `https://api.mizan.ac/v1/players/${id}`);
    assert.equal(f.calls[0].init.method, "GET");
    assert.equal(f.calls[0].init.redirect, "manual");
    assert.equal(f.calls[0].init.headers["X-API-Key"], "offline-provider-key");
    assert.equal(response.headers.get("x-api-key"), null);
    assert.equal(f.writes.length, 0);
  }
});

test("manual input rejects extras, old contract, invalid identity, bad JSON and oversized streams", async () => {
  const f = fixture();
  for (const body of [
    { steamId64: id },
    { communityId: id, name: "extra" },
    { communityId: "BOT" },
    {},
    null,
    "{",
  ])
    assert.equal(
      (await f.handlers.search(request("search", body))).status,
      400,
    );
  assert.equal(
    (
      await f.handlers.search(
        request("search", "x".repeat(1025), { "content-length": "1" }),
      )
    ).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});

test("both public actions preserve HTTPS, same-origin, per-IP rate limit and fail-closed bindings", async () => {
  for (const action of ["players", "search"]) {
    const f = fixture();
    for (const headers of [
      { origin: "https://evil.invalid" },
      { "sec-fetch-site": "cross-site" },
      { "cf-connecting-ip": "" },
    ])
      assert.equal(
        (
          await f.handlers[action](
            request(action, { communityId: id }, headers),
          )
        ).status,
        403,
      );
    const insecure = request(action, { communityId: id });
    assert.equal(
      (
        await f.handlers[action](
          new Request(insecure.url.replace("https:", "http:"), insecure),
        )
      ).status,
      403,
    );
    for (const overrides of [
      { kv: undefined },
      { authSecret: undefined },
      { rateLimiter: undefined },
      {
        rateLimiter: {
          limit: async () => {
            throw Error("private");
          },
        },
      },
    ])
      assert.equal(
        (
          await fixture(overrides).handlers[action](
            request(action, { communityId: id }),
          )
        ).status,
        503,
      );
    const limited = fixture({
      rateLimiter: { limit: async () => ({ success: false }) },
    });
    const response = await limited.handlers[action](
      request(action, { communityId: id }),
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(limited.calls.length, 0);
  }
  const f = fixture();
  const missingOrigin = request("search", { communityId: id });
  missingOrigin.headers.delete("origin");
  assert.equal((await f.handlers.search(missingOrigin)).status, 403);
  assert.equal(
    (
      await f.handlers.search(
        request(
          "search",
          { communityId: id },
          { "content-type": "text/plain" },
        ),
      )
    ).status,
    415,
  );
});

test("KV failure, missing list, or incomplete fixed-size page returns sanitized 503, not partial latest", async () => {
  for (const kv of [
    {
      list: async () => {
        throw Error("private");
      },
    },
    {},
    { list: async () => ({ keys: [], list_complete: false }) },
    {
      list: async () => ({
        keys: [{ name: CHECK_PLAYER_PREFIX + id }],
        list_complete: true,
      }),
      get: async () => {
        throw Error("private");
      },
    },
  ]) {
    const response = await fixture({ kv }).handlers.players(request("players"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Check unavailable" });
  }
});

test("MOTD records accepted normalized hint only after guards/limiter, even when stats absent", async () => {
  const f = fixture();
  const handler = createHlstatsMotdHandler({
    now: () => epoch,
    rateLimiter: f.deps.rateLimiter,
    load: async () => ({ available: false, reason: "not_found" }),
    recordObservation: (communityId, lastSeen) =>
      recordCheckPlayer(f.kv, communityId, lastSeen, epoch),
  });
  const req = (query, extra = {}) =>
    new Request(`${origin}/api/stats/motd?${query}`, {
      headers: {
        "user-agent": "Valve/Steam HTTP Client 1.0",
        "cf-connecting-ip": "192.0.2.1",
        ...extra,
      },
    });
  assert.equal(
    (
      await handler(
        req("communityid=STEAM_0%3A0%3A2&name=private&extra=secret"),
      )
    ).status,
    404,
  );
  assert.deepEqual(
    [...f.values],
    [[CHECK_PLAYER_PREFIX + id, JSON.stringify({ lastSeen: epoch })]],
  );
  const count = f.writes.length;
  for (const r of [
    req("communityid=BOT"),
    req(`communityid=${id}`, { origin: "https://evil.invalid" }),
    req(`communityid=${id}`, { "user-agent": "browser" }),
  ])
    assert.ok((await handler(r)).status >= 400);
  f.deps.rateLimiter.limit = async () => ({ success: false });
  assert.equal((await handler(req(`communityid=${id}`))).status, 429);
  assert.equal(f.writes.length, count);
});

test("MOTD observation storage failure preserves existing stats behavior", async () => {
  const handler = createHlstatsMotdHandler({
    rateLimiter: { limit: async () => ({ success: true }) },
    load: async () => ({ available: false, reason: "not_found" }),
    recordObservation: async () => {
      throw Error("private");
    },
  });
  const result = await handler(
    new Request(`${origin}/api/stats/motd?communityid=${id}`, {
      headers: {
        "user-agent": "Valve/Steam HTTP Client 1.0",
        "cf-connecting-ip": "192.0.2.1",
      },
    }),
  );
  assert.equal(result.status, 404);
  assert.ok(!(await result.text()).includes("private"));
});

test("provider errors, redirects, malformed/oversized bodies and wrong content type are sanitized without retry", async () => {
  for (const fetcher of [
    ...[401, 403, 404, 429, 500, 503].map(
      (status) => async () => new Response("private", { status }),
    ),
    async () =>
      new Response("", {
        status: 302,
        headers: { Location: "https://evil.invalid" },
      }),
    async () => {
      throw Error("private");
    },
    async () => new Response("{}"),
    async () =>
      new Response("{", { headers: { "content-type": "application/json" } }),
    async () =>
      new Response("x".repeat(128 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
  ]) {
    let calls = 0;
    const f = fixture({
      fetch: async (...args) => {
        calls++;
        return fetcher(...args);
      },
    });
    const response = await f.handlers.search(
      request("search", { communityId: id }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Check unavailable" });
    assert.equal(calls, 1);
  }
});

test("Mizan schema rejects mismatched identities, flags, counts, labels and dates", async () => {
  const mutations = [
    (d) => {
      d.player.id = "76561197960265730";
    },
    (d) => {
      d.player.provider = "other";
    },
    (d) => {
      d.cheater = "false";
    },
    (d) => {
      delete d.trolling;
    },
    (d) => {
      delete d.record;
    },
    ...["total", "active", "sources", "conduct"].flatMap((key) =>
      [null, -1, 0.5, "0"].map((value) => (d) => {
        d.bans[key] = value;
      }),
    ),
    ...["categories", "games"].flatMap((key) =>
      [null, [{}], ["x\n"], ["x".repeat(129)], Array(129).fill("x")].map(
        (value) => (d) => {
          d.bans[key] = value;
        },
      ),
    ),
    (d) => {
      d.bans.lastAt = "yesterday";
    },
  ];
  for (const mutate of mutations) {
    const data = providerResult();
    mutate(data.data);
    assert.equal(
      (
        await fixture({
          fetch: async () => Response.json(data),
        }).handlers.search(request("search", { communityId: id }))
      ).status,
      502,
    );
  }
  assert.equal(
    (
      await fixture({ mizanKey: undefined }).handlers.search(
        request("search", { communityId: id }),
      )
    ).status,
    503,
  );
});

test("provider deadlines cover headers and stalled response streams", async () => {
  for (const fetch of [
    async (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"data":'));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  ]) {
    const keepAlive = setTimeout(() => {}, 200);
    try {
      assert.equal(
        (
          await fixture({ fetch, timeoutMs: 10 }).handlers.search(
            request("search", { communityId: id }),
          )
        ).status,
        504,
      );
    } finally {
      clearTimeout(keepAlive);
    }
  }
});

test("legacy ingestion remains authenticated, sealed, bounded, and does not auto-query Mizan", async () => {
  const f = fixture();
  const body = JSON.stringify({
    version: 1,
    serverId: CHECK_SERVER_ID,
    generatedAt: epoch,
    connected: [],
    recentlyDisconnected: [],
  });
  const timestamp = String(epoch / 1000);
  assert.equal((await f.handlers.roster(request("roster", body))).status, 403);
  const headers = {
    "x-roster-timestamp": timestamp,
    "x-roster-signature": await signCheckRoster(body, secret, timestamp),
  };
  assert.equal(
    (await f.handlers.roster(request("roster", body, headers))).status,
    200,
  );
  assert.match(
    JSON.parse(f.values.get(CHECK_ROSTER_KEY)).seal,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    (await f.handlers.roster(request("roster", body, headers))).status,
    409,
  );
  const source = fixture();
  assert.equal(
    (await source.handlers.sourceRoster(request("source-roster", body))).status,
    403,
  );
  assert.equal(
    (
      await source.handlers.sourceRoster(
        request("source-roster", body, { authorization: `Bearer ${secret}` }),
      )
    ).status,
    200,
  );
  assert.equal(source.calls.length, 0);
  assert.equal(
    (
      await fixture().handlers.authorize(
        request("authorize", { communityId: id }),
      )
    ).status,
    503,
  );
});
