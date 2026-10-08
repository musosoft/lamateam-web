import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hlstatsUniqueId,
  loadHlstatsMyStats,
  parseHlstatsMyStats,
  HLSTATS_SECRET_HEADER,
} from "./hlstats.ts";

const id = "76561197960265731";
const fixture = readFileSync(
  new URL("./fixtures/hlstats-me.html", import.meta.url),
  "utf8",
);
const stats = {
  rank: 12,
  skill: 1234,
  kills: 100,
  deaths: 40,
  kpd: 2.5,
  headshots: 25,
  accuracy: 24.25,
};
const token = "synthetic-test-secret";
const html = (body = fixture, init = {}) =>
  new Response(body, { headers: { "Content-Type": "text/html" }, ...init });

test("SteamID64 conversion uses individual public Steam account bits only", () => {
  assert.equal(hlstatsUniqueId(id), "1:1");
  assert.equal(hlstatsUniqueId("76561197960265730"), "0:1");
  assert.equal(hlstatsUniqueId("76561202255233023"), "1:2147483647");
  for (const invalid of [
    "76561197960265728",
    "76561202255233024",
    "00000000000000001",
    "STEAM_0:1:1",
    `${id}&game=other`,
    "https://evil.test",
    "7656119796026573",
    "76561197960265731\n",
  ]) {
    assert.equal(hlstatsUniqueId(invalid), null);
  }
});

test("source-shaped summary extracts aggregates only, not starred recent-event values", () => {
  assert.deepEqual(parseHlstatsMyStats(fixture, id), stats);
  assert.deepEqual(
    parseHlstatsMyStats(
      fixture.replaceAll("</td>", "").replaceAll("</tr>", ""),
      id,
    ),
    stats,
  );
  const partial = fixture
    .replace("<b>12</b>", "<b>Hidden</b>")
    .replace("2.50 (3.00*)", "- (-*)")
    .replace("24.25%", "101%")
    .replace("100 (30*)", "1e2 (30*)");
  assert.deepEqual(parseHlstatsMyStats(partial, id), {
    ...stats,
    rank: null,
    kills: null,
    kpd: null,
    accuracy: null,
  });
  assert.equal(
    parseHlstatsMyStats(
      fixture.replace(/<tr>\s*<td>Deaths:[\s\S]*?<\/tr>/, ""),
      id,
    ).deaths,
    null,
  );
});

test("exact absence recognized; ambiguous, foreign identity/game and hostile pages fail closed", () => {
  assert.equal(
    parseHlstatsMyStats(
      "<div>No players found matching uniqueId '1:1'</div>",
      id,
    ),
    null,
  );
  for (const invalid of [
    "<html>Challenge</html>",
    "<div>No players found matching uniqueId '0:1'</div>",
    fixture.replace(id, "76561197960265730"),
    fixture.replace("STEAM_0:1:1", "STEAM_0:0:1"),
    fixture.replace("http://steamcommunity.com", "https://evil.test"),
    fixture.replace("game=css", "game=other"),
    fixture.replace("Statistics Summary", "Other"),
    fixture.replace("<td>Points:</td>", "<td>Kills:</td>"),
    fixture + fixture,
    "<div>".repeat(110) + fixture,
    "x".repeat(1_048_577),
  ])
    assert.throws(() => parseHlstatsMyStats(invalid, id));
});

test("fixed no-store request only uses converted identity; no redirects, caching or coalescing", async () => {
  let calls = 0;
  const options = {
    bypassToken: token,
    fetch: async (url, init) => {
      calls++;
      const target = new URL(url);
      assert.equal(target.origin, "https://stats.lamateam.eu");
      assert.equal(target.pathname, "/hlstats.php");
      assert.deepEqual(Object.fromEntries(target.searchParams), {
        mode: "playerinfo",
        uniqueid: "1:1",
        game: "css",
        type: "ajax",
        tab: "general",
      });
      assert.equal(init.redirect, "manual");
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers[HLSTATS_SECRET_HEADER], token);
      assert.equal(init.headers.Cookie, undefined);
      assert.ok(init.signal instanceof AbortSignal);
      return html();
    },
  };
  assert.deepEqual(
    await Promise.all([
      loadHlstatsMyStats(id, options),
      loadHlstatsMyStats(id, options),
    ]),
    [
      { available: true, stats },
      { available: true, stats },
    ],
  );
  assert.equal(calls, 2);
});

test("concurrent different users never share a snapshot or pending result", async () => {
  const otherId = "76561197960265730";
  const options = {
    bypassToken: token,
    fetch: async (url) => {
      const other = new URL(url).searchParams.get("uniqueid") === "0:1";
      return html(
        other
          ? fixture
              .replaceAll(id, otherId)
              .replace("STEAM_0:1:1", "STEAM_0:0:1")
              .replace("<b>12</b>", "<b>20</b>")
          : fixture,
      );
    },
  };
  const [first, second] = await Promise.all([
    loadHlstatsMyStats(id, options),
    loadHlstatsMyStats(otherId, options),
  ]);
  assert.deepEqual(first, { available: true, stats });
  assert.deepEqual(second, { available: true, stats: { ...stats, rank: 20 } });
});

test("missing secret or invalid identity never fetches; upstream failures disclose nothing", async (t) => {
  const neverFetch = async () => assert.fail("must not fetch");
  for (const options of [
    { fetch: neverFetch },
    { fetch: neverFetch, bypassToken: " " },
  ]) {
    assert.deepEqual(await loadHlstatsMyStats(id, options), {
      available: false,
      reason: "unavailable",
    });
  }
  assert.equal(
    (
      await loadHlstatsMyStats("https://evil.test", {
        fetch: neverFetch,
        bypassToken: token,
      })
    ).available,
    false,
  );
  const logs = ["warn", "error", "log"].map((method) =>
    t.mock.method(console, method, () => {}),
  );
  for (const response of [
    () =>
      html(fixture, {
        status: 302,
        headers: { Location: "https://evil.test" },
      }),
    () => html(fixture, { status: 500 }),
    () => html(fixture, { headers: { "Content-Type": "application/json" } }),
    () =>
      html(fixture, {
        headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
      }),
    () => html("x".repeat(1_048_577)),
    () => html(fixture + token),
    () => {
      throw new Error(`${id} ${token}`);
    },
    () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "text/html" },
      }),
  ]) {
    const keepAlive = setInterval(() => {}, 1000);
    try {
      assert.deepEqual(
        await loadHlstatsMyStats(id, {
          bypassToken: token,
          timeoutMs: 10,
          fetch: async () => response(),
        }),
        { available: false, reason: "unavailable" },
      );
    } finally {
      clearInterval(keepAlive);
    }
  }
  assert.ok(logs.every((log) => log.mock.callCount() === 0));
  assert.deepEqual(
    await loadHlstatsMyStats(id, {
      bypassToken: token,
      fetch: async () =>
        html("<div>No players found matching uniqueId '1:1'</div>"),
    }),
    { available: false, reason: "not_found" },
  );
});
