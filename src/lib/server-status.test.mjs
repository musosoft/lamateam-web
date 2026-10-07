import assert from "node:assert/strict";
import test from "node:test";
import {
  createServerStatusLoader,
  parseServerPlayerCount,
  SERVER_STATUS_URL,
} from "./server-status.ts";

const ok = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

function memoryCache() {
  const entries = new Map();
  return {
    async match(key) {
      return entries.get(key.url)?.clone();
    },
    async put(key, value) {
      entries.set(key.url, value.clone());
    },
  };
}

test("count parser accepts only a nonnegative safe integer players field", () => {
  assert.equal(
    parseServerPlayerCount({ players: "6", playerlist: ["secret"] }),
    6,
  );
  assert.equal(parseServerPlayerCount({ players: 0 }), 0);
  for (const value of [
    null,
    [],
    {},
    { players: "-1" },
    { players: "1.5" },
    { players: "6 players" },
    { players: "9007199254740992" },
    { players: -1 },
    { players: 1.5 },
    { players: null },
  ])
    assert.equal(parseServerPlayerCount(value), null);
});

test("fixed request exposes only count and freshness, coalescing concurrent loads", async () => {
  let calls = 0;
  const load = createServerStatusLoader({
    now: () => 42_000,
    cache: () => undefined,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, SERVER_STATUS_URL);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, { Accept: "application/json" });
      assert.ok(init.signal instanceof AbortSignal);
      return ok({ players: "6", playerlist: ["PRIVATE_PLAYER_NAME"] });
    },
  });
  const results = await Promise.all(Array.from({ length: 8 }, () => load()));
  assert.equal(calls, 1);
  assert.deepEqual(results[0], {
    players: 6,
    fetchedAt: 42_000,
    stale: false,
    error: false,
  });
  assert.doesNotMatch(
    JSON.stringify(results),
    /PRIVATE_PLAYER_NAME|playerlist/,
  );
});

test("accepts FakaHeda JSON feed even when mislabeled as text/html", async () => {
  const load = createServerStatusLoader({
    now: () => 42_000,
    cache: () => undefined,
    fetch: async () =>
      new Response(
        JSON.stringify({ players: "6", players_list: ["private"] }),
        {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        },
      ),
  });
  assert.deepEqual(await load(), {
    players: 6,
    fetchedAt: 42_000,
    stale: false,
    error: false,
  });
});

test("offline, malformed, redirected, wrong content-type, and oversized responses fail closed", async () => {
  const responses = [
    async () => {
      throw new Error("offline");
    },
    async () => ok({ players: "unknown" }),
    async () =>
      ok(
        { players: "6" },
        { status: 302, headers: { Location: "https://attacker.invalid" } },
      ),
    async () =>
      new Response("{}", { headers: { "Content-Type": "text/plain" } }),
    async () =>
      new Response(`{"players":"${"1".repeat(16_400)}"}`, {
        headers: { "Content-Type": "application/json" },
      }),
  ];
  for (const fetch of responses) {
    const load = createServerStatusLoader({ fetch, cache: () => undefined });
    assert.deepEqual(await load(), {
      players: null,
      fetchedAt: null,
      stale: false,
      error: true,
    });
  }
});

test("aborted upstream response fails closed within configured timeout", async () => {
  const load = createServerStatusLoader({
    timeoutMs: 10,
    cache: () => undefined,
    fetch: async (_url, { signal }) =>
      await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
  });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    assert.deepEqual(await load(), {
      players: null,
      fetchedAt: null,
      stale: false,
      error: true,
    });
  } finally {
    clearInterval(keepAlive);
  }
});

test("shared one-minute cache avoids repeat upstream requests", async () => {
  let calls = 0;
  const store = memoryCache();
  const options = {
    now: () => 1_000,
    cache: () => store,
    fetch: async () => {
      calls++;
      return ok({ players: "3", playerlist: ["PRIVATE_PLAYER_NAME"] });
    },
  };
  assert.equal((await createServerStatusLoader(options)()).players, 3);
  assert.equal((await createServerStatusLoader(options)()).players, 3);
  assert.equal(calls, 1);
  const entry = await store.match(
    new Request("https://lamateam.eu/_internal/server-status-v1"),
  );
  assert.match(entry.headers.get("cache-control"), /max-age=60/);
  assert.doesNotMatch(await entry.text(), /PRIVATE_PLAYER_NAME|playerlist/);
});

test("a recent last-known count is marked stale on failure, then expires", async () => {
  let time = 1_000;
  let failing = false;
  const load = createServerStatusLoader({
    now: () => time,
    cache: () => undefined,
    fetch: async () => {
      if (failing) throw new Error("offline");
      return ok({ players: "2" });
    },
  });
  assert.equal((await load()).players, 2);
  time += 60_000;
  failing = true;
  assert.deepEqual(await load(), {
    players: 2,
    fetchedAt: 1_000,
    stale: true,
    error: true,
  });
  time += 10 * 60_000;
  assert.deepEqual(await load(), {
    players: null,
    fetchedAt: null,
    stale: false,
    error: true,
  });
});
