import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createHlstatsMotdHandler as createHandler,
  normalizeMotdCommunityId,
} from "./hlstats-motd.ts";
import { loadHlstatsMyStats } from "./hlstats.ts";

const createHlstatsMotdHandler = (options) =>
  createHandler({
    rateLimiter: { limit: async () => ({ success: true }) },
    ...options,
  });

const id = "76561197960265731";
const stats = {
  rank: 12,
  skill: 1234,
  kills: 100,
  deaths: 40,
  kpd: 2.5,
  headshots: 25,
  accuracy: 24.25,
};
const request = (query = `communityid=${id}`, headers = {}, method = "GET") =>
  new Request(`https://lamateam.eu/api/stats/motd?${query}`, {
    method,
    headers: {
      "User-Agent": "Valve Steam Client",
      "CF-Connecting-IP": "192.0.2.1",
      ...headers,
    },
  });

test("edge quota uses only prefixed CF ingress IP and rejects before upstream even on cache hits", async () => {
  const keys = [];
  let loads = 0;
  let success = true;
  const handle = createHandler({
    rateLimiter: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success };
      },
    },
    load: async () => {
      loads++;
      return { available: true, stats };
    },
  });
  const req = () =>
    request(`communityid=${id}&name=Other`, {
      "CF-Connecting-IP": "2001:db8::1",
      "X-Forwarded-For": "198.51.100.1",
    });
  assert.equal((await handle(req())).status, 200);
  success = false;
  const rejected = await handle(req());
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get("Retry-After"), "60");
  assert.equal((await rejected.json()).reason, "rate_limited");
  assert.deepEqual(keys, ["motd-stats:2001:db8::1", "motd-stats:2001:db8::1"]);
  assert.equal(loads, 1);
});

test("edge quota is called only after method, UA, origin and input validation", async () => {
  const handle = createHandler({
    rateLimiter: {
      limit: async () => assert.fail("invalid requests must not consume quota"),
    },
    load: async () => assert.fail("must not load"),
  });
  for (const [req, status] of [
    [request(undefined, {}, "POST"), 405],
    [request(undefined, { "User-Agent": "Mozilla/5.0" }), 403],
    [request(undefined, { Origin: "https://evil.test" }), 403],
    [request("communityid=invalid"), 400],
    [request(`communityid=${id}&name=${"x".repeat(257)}`), 400],
  ])
    assert.equal((await handle(req)).status, status);
});

test("production missing binding/IP, throwing or invalid binding results fail closed", async () => {
  const noIP = request(undefined, { "X-Forwarded-For": "192.0.2.2" });
  noIP.headers.delete("CF-Connecting-IP");
  for (const [options, req] of [
    [{ rateLimiter: undefined }, request()],
    [{ rateLimiter: { limit: async () => assert.fail("missing IP") } }, noIP],
    [
      {
        rateLimiter: {
          limit: async () => {
            throw new Error("sensitive upstream details");
          },
        },
      },
      request(),
    ],
    [{ rateLimiter: { limit: async () => ({}) } }, request()],
  ]) {
    const handle = createHandler({
      ...options,
      load: async () => assert.fail("fail closed"),
    });
    const response = await handle(req);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      source: "motd",
      authenticated: false,
      verified: false,
      available: false,
      reason: "unavailable",
    });
  }
});

test("development missing-IP fallback is loopback-only and still requires a limiter", async () => {
  const keys = [];
  const options = {
    development: true,
    rateLimiter: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    },
    load: async () => ({ available: true, stats }),
  };
  const local = (host) =>
    new Request(`http://${host}/api/stats/motd?communityid=${id}`, {
      headers: { "User-Agent": "Valve Steam Client" },
    });
  const handle = createHandler(options);
  for (const host of ["localhost:4321", "127.0.0.1:4321", "[::1]:4321"])
    assert.equal((await handle(local(host))).status, 200);
  assert.deepEqual(keys, Array(3).fill("motd-stats:local-development"));
  for (const host of ["lamateam.eu", "localhost.evil.test", "192.0.2.1"])
    assert.equal((await handle(local(host))).status, 503);
  assert.equal(
    (
      await createHandler({ ...options, development: false })(
        local("localhost"),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await createHandler({ ...options, rateLimiter: undefined })(
        local("localhost"),
      )
    ).status,
    503,
  );
});

test("normalizes SourceMod Steam3, Steam2 and Steam64 through the public-account validator", () => {
  for (const value of [id, "[U:1:3]", "STEAM_0:1:1", "STEAM_1:1:1"])
    assert.equal(normalizeMotdCommunityId(value), id);
  assert.equal(
    normalizeMotdCommunityId("[U:1:4294967295]"),
    "76561202255233023",
  );
  for (const value of [
    "",
    "[U:1:0]",
    "[U:2:3]",
    "[U:1:4294967296]",
    "STEAM_0:2:1",
    "STEAM_0:1:2147483648",
    "76561197960265728",
    "76561202255233024",
    `${id}\n`,
    "x".repeat(33),
  ])
    assert.equal(normalizeMotdCommunityId(value), null);
});

test("public successful response is always unverified, ignores name/cookies and discloses no identity", async () => {
  const calls = [];
  const handle = createHlstatsMotdHandler({
    load: async (identity) => {
      calls.push(identity);
      return {
        available: true,
        stats: { ...stats, steamID: id, name: "private", aliases: ["private"] },
        steamID: id,
      };
    },
  });
  for (const name of ["Alice", "STEAM_0:0:8", "<script>bad()</script>"]) {
    const response = await handle(
      request(
        `communityid=${encodeURIComponent("[U:1:3]")}&name=${encodeURIComponent(name)}`,
        { Cookie: "communityid=76561197960265730; steam_auth=ignored" },
      ),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      source: "motd",
      authenticated: false,
      verified: false,
      available: true,
      stats,
    });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
    assert.equal(
      response.headers.get("Cross-Origin-Resource-Policy"),
      "same-origin",
    );
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.deepEqual(calls, [id]);
});

test("missing/bad/duplicate ID and bounded inputs fail without loading", async () => {
  const handle = createHlstatsMotdHandler({
    load: async () => assert.fail("no lookup"),
  });
  for (const query of [
    "",
    "name=Alice",
    "communityid=",
    "communityid=Alice",
    `communityid=${id}&communityid=${id}`,
    `communityid=${id}&name=A&name=B`,
    `communityid=${id}&name=${"x".repeat(257)}`,
    `communityid=${"9".repeat(33)}`,
    `communityid=${id}&ignored=${"x".repeat(2048)}`,
  ])
    assert.equal((await handle(request(query))).status, 400);
  assert.equal(
    (await handle(request(undefined, { "Content-Length": "1" }))).status,
    400,
  );
  assert.equal(
    (await handle(request(undefined, { "Transfer-Encoding": "chunked" })))
      .status,
    400,
  );
});

test("GET only, game-UA compatibility gate and same-origin restrictions", async () => {
  const handle = createHlstatsMotdHandler({
    load: async () => ({ available: true, stats }),
  });
  for (const ua of ["", "Mozilla/5.0", `Valve ${"x".repeat(512)}`])
    assert.equal(
      (await handle(request(undefined, { "User-Agent": ua }))).status,
      403,
    );
  for (const headers of [
    { Origin: "https://evil.test" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { Origin: "null" },
  ])
    assert.equal((await handle(request(undefined, headers))).status, 403);
  for (const ua of [
    "Valve Client",
    "Steam Client",
    "Mozilla/5.0 Valve Steam MOTD",
  ])
    assert.equal(
      (
        await handle(
          request(undefined, {
            "User-Agent": ua,
            Origin: "https://lamateam.eu",
            "Sec-Fetch-Site": "same-origin",
          }),
        )
      ).status,
      200,
    );
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await handle(request(undefined, {}, method));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
  }
});

test("upstream not found, errors and thrown failures produce sanitized unverified responses", async () => {
  for (const [load, reason, status] of [
    [async () => ({ available: false, reason: "not_found" }), "not_found", 404],
    [
      async () => ({ available: false, reason: "unavailable" }),
      "unavailable",
      503,
    ],
    [
      async () => {
        throw new Error(`${id} synthetic-secret upstream body`);
      },
      "unavailable",
      503,
    ],
  ]) {
    const handle = createHlstatsMotdHandler({ load });
    const response = await handle(request());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      source: "motd",
      authenticated: false,
      verified: false,
      available: false,
      reason,
    });
  }
});

test("coalesces normalized accounts; bounded refresh budget covers rotating IDs and backs off failures", async () => {
  let time = 0;
  let calls = 0;
  const handle = createHlstatsMotdHandler({
    now: () => time,
    load: async () => {
      calls++;
      return { available: true, stats };
    },
  });
  const responses = await Promise.all(
    [
      request(),
      request("communityid=%5BU%3A1%3A3%5D"),
      request("communityid=STEAM_0:1:1"),
    ].map(handle),
  );
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(calls, 1);
  for (let i = 4; i < 13; i++)
    assert.equal((await handle(request(`communityid=[U:1:${i}]`))).status, 200);
  const limited = await handle(request("communityid=[U:1:13]"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "10");
  assert.equal(calls, 10);
  time = 10_000;
  assert.equal((await handle(request("communityid=[U:1:13]"))).status, 200);
  await handle(request());
  assert.equal(calls, 11);
  time = 60_000;
  await handle(request());
  assert.equal(calls, 12);

  calls = 0;
  const failed = createHlstatsMotdHandler({
    now: () => time,
    load: async () => {
      calls++;
      throw new Error("safe failure");
    },
  });
  await Promise.all([failed(request()), failed(request())]);
  await failed(request());
  assert.equal(calls, 1);
  time += 10_000;
  await failed(request());
  assert.equal(calls, 2);
});

test("route uses existing fixed-origin public HLstats adapter, server secret and aggregates parser", async () => {
  const fixture = readFileSync(
    new URL("./fixtures/hlstats-me.html", import.meta.url),
    "utf8",
  );
  const handle = createHlstatsMotdHandler({
    load: (identity) =>
      loadHlstatsMyStats(identity, {
        bypassToken: "synthetic-test-secret",
        fetch: async (target, init) => {
          const url = new URL(target);
          assert.equal(url.origin, "https://stats.lamateam.eu");
          assert.equal(url.searchParams.get("uniqueid"), "1:1");
          assert.equal(url.searchParams.has("name"), false);
          assert.equal(
            init.headers["X-LamaTeam-Stats-Key"],
            "synthetic-test-secret",
          );
          return new Response(fixture, {
            headers: { "Content-Type": "text/html" },
          });
        },
      }),
  });
  assert.deepEqual(
    (
      await (
        await handle(request("communityid=%5BU%3A1%3A3%5D&name=Other"))
      ).json()
    ).stats,
    stats,
  );
  const route = readFileSync(
    new URL("../pages/api/stats/motd.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /loadHlstatsMyStats/);
  assert.match(route, /statsEnv\.HLSTATS_WAF_BYPASS_TOKEN/);
  assert.match(route, /rateLimiter: statsEnv\.TRANSLATION_RATE_LIMITER/);
  assert.match(route, /development: import\.meta\.env\.DEV/);
  assert.doesNotMatch(route, /readSteamSession|fetch\(/);
});
