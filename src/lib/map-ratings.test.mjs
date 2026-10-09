import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createMapRatingsHandler } from "./map-ratings.ts";

const migration = readFileSync(
  new URL("../../migrations/001-map-ratings.sql", import.meta.url),
  "utf8",
);
const catalog = JSON.parse(
  readFileSync(new URL("../data/maps.generated.json", import.meta.url), "utf8"),
);
const alice = "76561198000000001";
const bob = "76561198000000002";

function fixture(t, limiter = async () => ({ success: true })) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(migration);
  const calls = [];
  const execute = async (statement) => {
    calls.push(statement);
    const prepared = sqlite.prepare(statement.sql);
    if (statement.sql.trim().startsWith("SELECT"))
      return { rows: prepared.all(...statement.args) };
    prepared.run(...statement.args);
    return { rows: [] };
  };
  const db = {
    execute,
    async batch(statements, mode) {
      assert.equal(mode, "write");
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements)
          results.push(await execute(statement));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  let identity = alice;
  let dbCalls = 0;
  const quotaKeys = [];
  const handle = createMapRatingsHandler({
    rateLimiter: limiter
      ? {
          limit: async ({ key }) => {
            quotaKeys.push(key);
            return limiter();
          },
        }
      : undefined,
    maps: catalog.items.map((item) => item.map),
    database: () => {
      dbCalls++;
      return db;
    },
    session: async () => identity,
  });
  const post = (body, headers = {}, query = "") =>
    handle(
      new Request(`https://lamateam.eu/api/map-ratings${query}`, {
        method: "POST",
        headers: {
          origin: "https://lamateam.eu",
          "content-type": "application/json",
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const get = (query = "", headers = {}) =>
    handle(
      new Request(`https://lamateam.eu/api/map-ratings${query}`, { headers }),
    );
  return {
    sqlite,
    calls,
    quotaKeys,
    post,
    get,
    identity: (value) => {
      identity = value;
    },
    dbCalls: () => dbCalls,
  };
}

test("migration is additive, idempotent and enforces unique/valid votes", (t) => {
  const { sqlite } = fixture(t);
  sqlite.exec(migration);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|ALTER)\b/i);
  sqlite
    .prepare("INSERT INTO MapRatings VALUES (?, ?, ?)")
    .run("de_dust2", alice, 3);
  for (const [steam, stars] of [
    [alice, 4],
    [bob, 0],
    [bob, 6],
    [bob, 2.5],
    ["invalid", 3],
  ]) {
    assert.throws(() =>
      sqlite
        .prepare("INSERT INTO MapRatings VALUES (?, ?, ?)")
        .run("de_dust2", steam, stars),
    );
  }
});

test("upserts keep one vote per player; averages and caller-only ratings reflect edits", async (t) => {
  const f = fixture(t);
  let response = await f.post({ map: "de_dust2", stars: 1, steamID: bob });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    map: "de_dust2",
    average: 1,
    count: 1,
    userRating: 1,
    authenticated: true,
    canRate: true,
  });
  f.identity(bob);
  await f.post({ map: "de_dust2", stars: 5 });
  f.identity(alice);
  response = await f.post({ map: "de_dust2", stars: 3 });
  assert.deepEqual(await response.json(), {
    map: "de_dust2",
    average: 4,
    count: 2,
    userRating: 3,
    authenticated: true,
    canRate: true,
  });
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM MapRatings").get().n,
    2,
  );
  assert.deepEqual(await (await f.get("?map=de_dust2")).json(), {
    map: "de_dust2",
    average: 4,
    count: 2,
    userRating: 3,
    authenticated: true,
    canRate: true,
  });
  f.identity(bob);
  assert.equal((await (await f.get("?map=de_dust2")).json()).userRating, 5);
  f.identity(null);
  response = await f.get("?map=de_dust2");
  assert.deepEqual(await response.json(), {
    map: "de_dust2",
    average: 4,
    count: 2,
    userRating: null,
    authenticated: false,
    canRate: false,
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, User-Agent");
  assert.ok(
    f.calls.every(
      ({ sql, args }) =>
        Array.isArray(args) && !sql.includes(alice) && !sql.includes(bob),
    ),
  );
  assert.deepEqual(f.calls[0].args, ["de_dust2", alice, 1]);
});

test("GET returns catalog maps and zero-vote aggregates without identity fields", async (t) => {
  const f = fixture(t);
  const response = await f.get();
  const { ratings } = await response.json();
  assert.equal(ratings.length, catalog.items.length);
  assert.ok(
    ratings.every(
      (rating) =>
        rating.average === null &&
        rating.count === 0 &&
        rating.userRating === null,
    ),
  );
  assert.deepEqual(Object.keys(ratings[0]), [
    "map",
    "average",
    "count",
    "userRating",
  ]);
  assert.equal((await f.get("?map=not_a_map")).status, 400);
  const special = await f.post({ map: "$2000$", stars: 5 });
  assert.equal(special.status, 200);
});

test("GET exposes only authentication status for anonymous and signed-in callers", async (t) => {
  const f = fixture(t);
  await f.post({ map: "de_dust2", stars: 4 });
  for (const identity of [null, alice]) {
    f.identity(identity);
    for (const query of ["", "?map=de_dust2", "?map=$2000$"]) {
      const response = await f.get(query);
      assert.equal(response.status, 200);
      const text = await response.text();
      const body = JSON.parse(text);
      assert.equal(body.authenticated, identity !== null);
      assert.equal(body.canRate, identity !== null);
      assert.doesNotMatch(
        text,
        /7656119800000000[12]|steamid|steamID|playerName|playerAvatar/,
      );
      if (query === "") {
        assert.deepEqual(Object.keys(body).sort(), [
          "authenticated",
          "canRate",
          "ratings",
        ]);
        assert.ok(
          body.ratings.every(
            (rating) =>
              Object.keys(rating).sort().join(",") ===
              "average,count,map,userRating",
          ),
        );
      } else {
        assert.deepEqual(Object.keys(body).sort(), [
          "authenticated",
          "average",
          "canRate",
          "count",
          "map",
          "userRating",
        ]);
      }
    }
  }
});

test("rejects unknown maps, unsafe identifiers, malformed JSON and invalid stars before SQL", async (t) => {
  const f = fixture(t);
  for (const stars of [0, 6, 2.5, "5", null, true]) {
    assert.equal((await f.post({ map: "de_dust2", stars })).status, 400);
  }
  for (const map of ["missing", "../de_dust2", "de_dust2' OR 1=1 --", null]) {
    assert.equal((await f.post({ map, stars: 3 })).status, 400);
  }
  for (const body of ["{", "null", "[]", "3", "{}"])
    assert.equal((await f.post(body)).status, 400);
  assert.equal(f.dbCalls(), 0);
});

test("requires session, JSON and exact same-origin; no User-Agent bypass", async (t) => {
  const f = fixture(t);
  const vote = { map: "de_dust2", stars: 3 };
  for (const origin of [
    "",
    "null",
    "https://evil.example",
    "http://lamateam.eu",
    "https://lamateam.eu.evil.example",
  ]) {
    assert.equal((await f.post(vote, { origin })).status, 403);
  }
  for (const site of ["cross-site", "same-site", "none"]) {
    assert.equal((await f.post(vote, { "sec-fetch-site": site })).status, 403);
  }
  assert.equal(
    (await f.post(vote, { "content-type": "text/plain" })).status,
    415,
  );
  f.identity(null);
  assert.equal(
    (await f.post({ ...vote, steamid: alice }, { "user-agent": "Valve Steam" }))
      .status,
    401,
  );
  assert.equal(f.dbCalls(), 0);
});

const gameHeaders = {
  "user-agent": "Valve Steam Client",
  "cf-connecting-ip": "203.0.113.42",
};
const vote = { map: "de_dust2", stars: 4 };
const communityQuery = (id) => `?communityid=${encodeURIComponent(id)}`;

test("MOTD Steam64/3/2 aliases read and write the same unverified vote", async (t) => {
  const f = fixture(t);
  f.identity(null);
  const account = BigInt(alice) - 76561197960265728n;
  for (const id of [
    alice,
    `[U:1:${account}]`,
    `STEAM_0:${account % 2n}:${account / 2n}`,
  ]) {
    const query = communityQuery(id);
    const response = await f.post(vote, gameHeaders, query);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      map: "de_dust2",
      average: 4,
      count: 1,
      userRating: 4,
      authenticated: false,
      canRate: true,
    });
    for (const suffix of ["", "&map=de_dust2"]) {
      const get = await f.get(query + suffix, gameHeaders);
      assert.equal(get.status, 200);
      const text = await get.text();
      const body = JSON.parse(text);
      assert.equal(body.authenticated, false);
      assert.equal(body.canRate, true);
      assert.equal(
        suffix
          ? body.userRating
          : body.ratings.find((r) => r.map === "de_dust2").userRating,
        4,
      );
      assert.ok(!text.includes(alice));
    }
  }
  assert.deepEqual(f.quotaKeys, Array(3).fill("motd-map-ratings:203.0.113.42"));
});

test("missing/invalid/duplicate game IDs cannot vote; desktop query never authorizes", async (t) => {
  const f = fixture(t);
  f.identity(null);
  for (const query of [
    "",
    communityQuery(""),
    communityQuery("invalid"),
    communityQuery("[U:1:0]"),
    communityQuery("76561197960265728"),
    `${communityQuery(alice)}&communityid=${bob}`,
  ]) {
    assert.equal((await f.post(vote, gameHeaders, query)).status, 401);
    const body = await (await f.get(query, gameHeaders)).json();
    assert.equal(body.canRate, false);
    assert.equal(body.userRating ?? null, null);
  }
  for (const ua of ["Mozilla/5.0", ""]) {
    assert.equal(
      (await f.post(vote, { "user-agent": ua }, communityQuery(alice))).status,
      401,
    );
    assert.equal(
      (await (await f.get(communityQuery(alice), { "user-agent": ua })).json())
        .canRate,
      false,
    );
  }
  assert.equal(f.calls.filter((c) => c.sql.includes("INSERT")).length, 0);
  assert.equal(f.quotaKeys.length, 0);
});

test("game cookies/name/body IDs never choose identity; desktop verified session does", async (t) => {
  const f = fixture(t);
  f.identity(bob);
  const query = `${communityQuery(alice)}&name=${bob}&steamid=${bob}`;
  const response = await f.post(
    { ...vote, communityid: bob, steamid: bob },
    { ...gameHeaders, cookie: `communityid=${bob}` },
    query,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0].args, ["de_dust2", alice, 4]);
  assert.equal((await response.json()).authenticated, true);
  assert.equal((await f.post(vote, {}, query)).status, 200);
  assert.deepEqual(f.calls[2].args, ["de_dust2", bob, 4]);
  assert.equal(f.quotaKeys.length, 1);
  f.identity(null);
  assert.equal(
    (
      await f.post(
        vote,
        { ...gameHeaders, cookie: `communityid=${alice}` },
        `?name=${alice}`,
      )
    ).status,
    401,
  );
});

test("game votes keep exact origin, JSON and rating validation before quota/database", async (t) => {
  const f = fixture(t);
  f.identity(null);
  const query = communityQuery(alice);
  for (const headers of [
    { origin: "" },
    { origin: "https://evil.example" },
    { "sec-fetch-site": "same-site" },
  ]) {
    assert.equal(
      (await f.post(vote, { ...gameHeaders, ...headers }, query)).status,
      403,
    );
  }
  assert.equal(
    (
      await f.post(
        vote,
        { ...gameHeaders, "content-type": "text/plain" },
        query,
      )
    ).status,
    415,
  );
  for (const body of [
    "{",
    "[]",
    { ...vote, stars: 6 },
    { ...vote, map: "missing" },
  ]) {
    assert.equal((await f.post(body, gameHeaders, query)).status, 400);
  }
  assert.equal(f.dbCalls(), 0);
  assert.equal(f.quotaKeys.length, 0);
});

test("MOTD quota denies before DB and fails closed without binding or trusted IP", async (t) => {
  for (const [limiter, headers, status] of [
    [async () => ({ success: false }), gameHeaders, 429],
    [null, gameHeaders, 503],
    [
      async () => ({ success: true }),
      {
        ...gameHeaders,
        "cf-connecting-ip": "",
        "x-forwarded-for": "203.0.113.42",
      },
      503,
    ],
    [
      async () => {
        throw new Error("PRIVATE_LIMITER_DETAIL");
      },
      gameHeaders,
      503,
    ],
    [async () => ({}), gameHeaders, 503],
  ]) {
    const f = fixture(t, limiter);
    f.identity(null);
    const response = await f.post(vote, headers, communityQuery(alice));
    assert.equal(response.status, status);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
    assert.doesNotMatch(await response.text(), /PRIVATE|203\.0\.113|765611/);
    assert.equal(f.dbCalls(), 0);
    // A verified desktop vote does not depend on anonymous quota infrastructure.
    f.identity(alice);
    assert.equal((await f.post(vote)).status, 200);
  }
});

test("API wires the existing Cloudflare limiter", () => {
  const route = readFileSync(
    new URL("../pages/api/map-ratings.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /rateLimiter:.*TRANSLATION_RATE_LIMITER/);
  assert.match(route, /readSteamSession/);
});

test("database failures are generic and never leak secrets", async () => {
  const handle = createMapRatingsHandler({
    maps: ["de_dust2"],
    session: async () => null,
    database: () => {
      throw new Error("PRIVATE_DATABASE_TOKEN");
    },
  });
  const response = await handle(
    new Request("https://lamateam.eu/api/map-ratings"),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Map ratings unavailable" });
});
