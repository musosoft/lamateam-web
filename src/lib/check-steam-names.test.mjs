import assert from "node:assert/strict";
import test from "node:test";
import { enrichCheckPlayerNames } from "./check-steam-names.ts";

const id = (n) => String(76561197960265728n + BigInt(n));
const players = Array.from({ length: 35 }, (_, i) => ({
  communityId: id(i + 1),
  lastSeen: 1800000000000 - i,
}));
const fallback = (rows) => rows.map((row) => ({ ...row, displayName: null }));
const summaries = (rows) => Response.json({ response: { players: rows } });

test("one bounded encoded batch, keyed by Steam ID rather than provider order; source is unchanged", async () => {
  const original = structuredClone(players);
  const key = "offline +&?=/#key";
  let calls = 0;
  const result = await enrichCheckPlayerNames(players, {
    apiKey: key,
    fetch: async (input, init) => {
      calls++;
      const url = new URL(input);
      assert.equal(url.origin, "https://api.steampowered.com");
      assert.equal(url.pathname, "/ISteamUser/GetPlayerSummaries/v2/");
      assert.equal(url.hash, "");
      assert.deepEqual([...url.searchParams.keys()], ["key", "steamids"]);
      assert.equal(url.searchParams.get("key"), key);
      assert.deepEqual(
        url.searchParams.get("steamids").split(","),
        players.slice(0, 30).map((p) => p.communityId),
      );
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.signal.aborted, false);
      return summaries([
        { steamid: id(30), personaname: " Žluťoučký 🎮 " },
        { steamid: id(1), personaname: "<img src=x onerror=alert(1)>" },
        { steamid: id(35), personaname: "unsolicited" },
      ]);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result[0].displayName, "<img src=x onerror=alert(1)>");
  assert.equal(result[29].displayName, "Žluťoučký 🎮");
  assert.equal(result[34].displayName, null);
  assert.equal(result[1].displayName, null);
  assert.deepEqual(players, original);
  assert.deepEqual(
    result.map(({ displayName, ...row }) => row),
    original,
  );
});

test("missing key and empty list never call Steam", async () => {
  for (const apiKey of [undefined, "", "   "]) {
    assert.deepEqual(
      await enrichCheckPlayerNames(players, {
        apiKey,
        fetch: () => assert.fail("unexpected provider call"),
      }),
      fallback(players),
    );
  }
  assert.deepEqual(
    await enrichCheckPlayerNames([], {
      apiKey: "offline-key",
      fetch: () => assert.fail("unexpected provider call"),
    }),
    [],
  );
});

test("calls the Worker fetch binding with its required global receiver", async () => {
  let receiver;
  const result = await enrichCheckPlayerNames(players.slice(0, 1), {
    apiKey: "offline-key",
    fetch: async function (_input, _init) {
      receiver = this;
      return summaries([{ steamid: id(1), personaname: "Player" }]);
    },
  });
  assert.equal(receiver, globalThis);
  assert.equal(result[0].displayName, "Player");
});

test("manual Steam redirects fail closed without a second request", async () => {
  let calls = 0;
  const result = await enrichCheckPlayerNames(players.slice(0, 1), {
    apiKey: "offline-key",
    fetch: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.invalid/collect" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, fallback(players.slice(0, 1)));
});

test("missing profiles and malformed/unsafe names yield null without dropping rows", async () => {
  const invalidNames = [
    null,
    42,
    {},
    "",
    "  ",
    "x".repeat(129),
    "a\nb",
    "\u0000",
    "\u202eevil",
  ];
  const rows = players.slice(0, invalidNames.length + 2);
  const result = await enrichCheckPlayerNames(rows, {
    apiKey: "offline-key",
    fetch: async () =>
      summaries([
        ...invalidNames.map((personaname, i) => ({
          steamid: id(i + 1),
          personaname,
        })),
        null,
        { steamid: Number(id(1)), personaname: "wrong identity type" },
        { steamid: id(invalidNames.length + 1), personaname: "Valid name" },
      ]),
  });
  assert.deepEqual(
    result.slice(0, invalidNames.length),
    fallback(rows.slice(0, invalidNames.length)),
  );
  assert.equal(result.at(-2).displayName, "Valid name");
  assert.equal(result.at(-1).displayName, null);
});

test("hostile provider responses fail soft and never leak provider data", async (t) => {
  const cases = {
    network: () => {
      throw new Error("secret provider URL");
    },
    redirect: () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.invalid" },
      }),
    unauthorized: () => new Response("secret provider error", { status: 401 }),
    unavailable: () => new Response(null, { status: 503 }),
    html: () => new Response("<html>secret</html>"),
    malformed: () =>
      new Response("{", { headers: { "content-type": "application/json" } }),
    missing: () => Response.json({ response: {} }),
    null: () => Response.json(null),
    object: () => Response.json({ response: { players: {} } }),
    excessive: () =>
      summaries(Array(31).fill({ steamid: id(1), personaname: "ignored" })),
    oversized: () =>
      new Response(" ".repeat(128 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    brokenBody: () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error("broken"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  };
  for (const [name, response] of Object.entries(cases)) {
    await t.test(name, async () => {
      assert.deepEqual(
        await enrichCheckPlayerNames(players, {
          apiKey: "offline-key",
          fetch: async () => response(),
        }),
        fallback(players),
      );
    });
  }
});

test("timeouts bound both an abort-ignoring fetch and a stalled body", async () => {
  let signal;
  assert.deepEqual(
    await enrichCheckPlayerNames(players, {
      apiKey: "offline-key",
      timeoutMs: 10,
      fetch: async (_, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    }),
    fallback(players),
  );
  assert.equal(signal.aborted, true);
  let cancelled = false;
  assert.deepEqual(
    await enrichCheckPlayerNames(players, {
      apiKey: "offline-key",
      timeoutMs: 10,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    }),
    fallback(players),
  );
  assert.equal(cancelled, true);
});
