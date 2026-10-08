import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHlstatsLoader,
  HLSTATS_URL,
  HLSTATS_SECRET_HEADER,
  parseHlstatsPlayerId,
  parseHlstatsPlayers,
} from "./hlstats.ts";

const fixture = readFileSync(
  new URL("./fixtures/hlstats-players.html", import.meta.url),
  "utf8",
);
const html = (body = fixture, init = {}) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
    ...init,
  });
const noCache = () => undefined;
const testToken = "test-only-worker-secret";
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

test("faithful HLstats table extracts only player contract, with decoded inert text", () => {
  const players = parseHlstatsPlayers(fixture);
  assert.equal(players.length, 2);
  assert.deepEqual(players[0], {
    playerId: 101,
    rank: 1,
    name: "Alice & Bob 😀 <script>",
    country: "Slovakia",
    flagAlt: "Slovakia",
    flagUrl: "https://stats.lamateam.eu/hlstatsimg/flags/sk.gif",
    rankUrl: "https://stats.lamateam.eu/hlstatsimg/mmranks/18.png",
    skill: 12345,
    kills: 2345,
    deaths: 1000,
    kpd: "2.35",
    headshots: 900,
    accuracy: "24.56%",
  });
  assert.equal(players[1].kpd, null);
  assert.equal(players[1].accuracy, "0%");
  assert.equal(players[1].kills, 0);
});

test("player IDs come only from validated, unambiguous player-info links", () => {
  for (const href of [
    "hlstats.php?mode=playerinfo&player=101",
    "/hlstats.php?player=101&mode=playerinfo",
    "https://stats.lamateam.eu/hlstats.php?mode=playerinfo&player=101",
  ]) {
    assert.equal(parseHlstatsPlayerId(href), 101);
  }
  for (const href of [
    "https://evil.test/hlstats.php?mode=playerinfo&player=101",
    "https://user:pass@stats.lamateam.eu/hlstats.php?mode=playerinfo&player=101",
    "hlstats.php?mode=playerinfo&player=101#other",
    "hlstats.php?mode=playerinfo&mode=admin&player=101",
    "hlstats.php?mode=playerinfo&player=101&player=102",
    "hlstats.php?mode=admin&player=101",
    "other.php?mode=playerinfo&player=101",
    ...["", "0", "-1", "1.5", "1e2", "0101", "9007199254740992"].map(
      (id) => `hlstats.php?mode=playerinfo&player=${id}`,
    ),
  ]) {
    assert.equal(parseHlstatsPlayerId(href), null, href);
  }
});

test("numeric IDs are distinct from display names; duplicate IDs and ambiguous links fail closed", () => {
  const sameName = fixture.replace(
    "Player Two",
    "Alice &amp; Bob 😀 &lt;script&gt;",
  );
  const players = parseHlstatsPlayers(sameName);
  assert.equal(players[0].name, players[1].name);
  assert.deepEqual(
    players.map((player) => player.playerId),
    [101, 102],
  );
  assert.throws(() =>
    parseHlstatsPlayers(fixture.replace("player=102", "player=101")),
  );
  assert.throws(() =>
    parseHlstatsPlayers(
      fixture.replace(
        "Player Two",
        'Player Two</a><a href="hlstats.php?mode=playerinfo&amp;player=103">Other',
      ),
    ),
  );
});

test("scripts/styles are excluded; parser handles omitted cell/row closing tags", () => {
  const modified = fixture
    .replace(
      "Player Two",
      "Player<script>evil()</script><style>evil</style> Two",
    )
    .replaceAll("</td>", "")
    .replaceAll("</tr>", "");
  assert.equal(parseHlstatsPlayers(modified)[1].name, "Player Two");
});

test("only expected image origin/path/format is returned", () => {
  for (const src of [
    "https://evil.test/hlstatsimg/a.png",
    "//evil.test/a.png",
    "javascript:alert(1)",
    "data:image/png;base64,a",
    "https://user:pass@stats.lamateam.eu/hlstatsimg/a.png",
    "/hlstatsimg/../private.png",
    "/hlstatsimg/flags/sk.gif?track=1",
    "/hlstatsimg/flags/sk.gif#x",
    "/hlstatsimg/a.svg",
    "/hlstatsimg/%2e%2e/a.png",
  ]) {
    assert.equal(
      parseHlstatsPlayers(fixture.replace("hlstatsimg/flags/sk.gif", src))[0]
        .flagUrl,
      null,
      src,
    );
  }
});

test("challenge/missing/wrong tables and malformed identities fail closed", () => {
  for (const invalid of [
    "<html><title>Just a moment...</title></html>",
    fixture.replaceAll("data-table", "other-table"),
    fixture.replaceAll("Accuracy", "Other"),
    fixture.replace('class="bg2">2', 'class="bg2">1'),
    fixture.replace('class="bg2">2', 'class="bg2">-'),
    fixture.replace("mode=playerinfo&amp;player=101", "mode=admin"),
    fixture.replace('<td class="bg2">0%</td>', ""),
  ]) {
    assert.throws(() => parseHlstatsPlayers(invalid));
  }
  assert.throws(() => parseHlstatsPlayers("x".repeat(1_048_577)));
  assert.throws(() => parseHlstatsPlayers("<div>".repeat(110) + fixture));
});

test("valid header-only table is an empty success; invalid numeric values become null", () => {
  assert.deepEqual(
    parseHlstatsPlayers(
      fixture.replace(/<tr>\s*<td[\s\S]*?<\/table>/, "</table>"),
    ),
    [],
  );
  const players = parseHlstatsPlayers(
    fixture.replace("24.56%", "101%").replace(">2,345<", ">1e5<"),
  );
  assert.equal(players[0].accuracy, null);
  assert.equal(players[0].kills, null);
});

test("missing or blank secret fails closed without fetching and uses backoff", async () => {
  for (const bypassToken of [undefined, "", "   "]) {
    let calls = 0;
    const load = createHlstatsLoader({
      bypassToken,
      cache: noCache,
      fetch: async () => {
        calls++;
        return html();
      },
    });
    const result = await load();
    assert.equal(result.error, true);
    assert.equal(result.players.length, 0);
    assert.equal(result.stale, false);
    assert.equal(result.fetchedAt, null);
    await load(testToken);
    assert.equal(calls, 0);
  }
});

test("fixed GET, exact private header, no other credentials; concurrent calls coalesce", async () => {
  let calls = 0;
  const load = createHlstatsLoader({
    bypassToken: testToken,
    cache: noCache,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, HLSTATS_URL);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, {
        Accept: "text/html",
        [HLSTATS_SECRET_HEADER]: testToken,
      });
      assert.deepEqual(Object.keys(init).sort(), [
        "headers",
        "method",
        "redirect",
        "signal",
      ]);
      assert.equal(new URL(url).username, "");
      assert.equal(new URL(url).password, "");
      assert.ok(!url.includes(testToken));
      assert.ok(init.signal instanceof AbortSignal);
      return html();
    },
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => load()));
  assert.equal(calls, 1);
  assert.ok(
    results.every((r) => !r.error && !r.stale && r.players.length === 2),
  );
});

test("five-minute freshness, one-minute failure backoff, max one-hour stale", async () => {
  let time = 1000;
  let calls = 0;
  const load = createHlstatsLoader({
    bypassToken: testToken,
    cache: noCache,
    now: () => time,
    fetch: async () => {
      calls++;
      if (calls > 1) throw new Error("failure");
      return html();
    },
  });
  await load();
  time += 299_999;
  assert.equal((await load()).stale, false);
  assert.equal(calls, 1);
  time++;
  const stale = await load();
  assert.equal(stale.stale, true);
  assert.equal(stale.error, true);
  assert.equal(stale.fetchedAt, 1000);
  assert.equal(stale.players.length, 2);
  time += 59_999;
  await load();
  assert.equal(calls, 2);
  time++;
  await load();
  assert.equal(calls, 3);
  time = 1000 + 3_600_000;
  assert.deepEqual(await load(), {
    players: [],
    fetchedAt: null,
    stale: false,
    error: true,
  });
});

test("missing binding preserves cached freshness, then stale/error without fetching", async () => {
  let time = 1000;
  const store = memoryCache();
  await createHlstatsLoader({
    bypassToken: testToken,
    cache: () => store,
    now: () => time,
    fetch: async () => html(),
  })();
  let calls = 0;
  const load = createHlstatsLoader({
    cache: () => store,
    now: () => time,
    fetch: async () => {
      calls++;
      return html();
    },
  });
  assert.equal((await load()).error, false);
  time += 300_000;
  const result = await load();
  assert.equal(result.players.length, 2);
  assert.equal(result.stale, true);
  assert.equal(result.error, true);
  assert.equal(calls, 0);
});

test("private header is absent from public data, cache and logs, including failure reflection", async (t) => {
  const logs = ["log", "info", "warn", "error", "debug"].map((method) =>
    t.mock.method(console, method, () => {}),
  );
  for (const response of [
    () => html(),
    () => html(fixture.replace("Player Two", testToken)),
    () => {
      throw new Error(testToken);
    },
  ]) {
    const writes = [];
    const load = createHlstatsLoader({
      bypassToken: testToken,
      cache: () => ({
        match: async (key) => {
          assert.equal(
            new Headers(key.headers).get(HLSTATS_SECRET_HEADER),
            null,
          );
          assert.ok(!key.url.includes(testToken));
        },
        put: async (key, value) => {
          assert.equal(
            new Headers(key.headers).get(HLSTATS_SECRET_HEADER),
            null,
          );
          writes.push(await value.text(), JSON.stringify([...value.headers]));
        },
      }),
      fetch: async () => response(),
    });
    const result = await load();
    assert.doesNotMatch(
      JSON.stringify([result, writes]),
      /test-only-worker-secret|X-LamaTeam-Stats-Key/,
    );
  }
  assert.equal(logs[2].mock.callCount(), 2);
  assert.ok(
    logs
      .filter((_, index) => index !== 2)
      .every((log) => log.mock.callCount() === 0),
  );
  assert.doesNotMatch(
    JSON.stringify(
      logs.flatMap((log) => log.mock.calls.map((call) => call.arguments)),
    ),
    /test-only-worker-secret|X-LamaTeam-Stats-Key|Player Two|Alice|<table/,
  );
});

test("refresh diagnostics classify failures and log only allowlisted scalars once per backoff", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const sensitiveBody = `PRIVATE_BODY ${testToken} Player Two`;
  const cases = [
    { reason: "missing_secret", token: undefined, status: null },
    { reason: "missing_secret", token: "  ", status: null },
    {
      reason: "fetch_exception",
      status: null,
      response: () => {
        throw new TypeError(sensitiveBody);
      },
    },
    {
      reason: "fetch_exception",
      token: `${testToken}\nINVALID`,
      status: null,
      response: (_url, init) => {
        new Headers(init.headers);
        return html();
      },
    },
    {
      reason: "cloudflare_challenge",
      status: 403,
      mitigated: true,
      response: () =>
        new Response(sensitiveBody, {
          status: 403,
          headers: { "cf-mitigated": "challenge", "cf-ray": sensitiveBody },
        }),
    },
    {
      reason: "http_failure",
      status: 500,
      response: () => html(sensitiveBody, { status: 500 }),
    },
    {
      reason: "content_type_failure",
      status: 200,
      response: () =>
        new Response(sensitiveBody, {
          headers: { "content-type": "application/json" },
        }),
    },
    {
      reason: "size_failure",
      status: 200,
      response: () =>
        new Response(sensitiveBody, {
          headers: { "content-type": "text/html", "content-length": "1048577" },
        }),
    },
    {
      reason: "size_failure",
      status: 200,
      response: () => html("x".repeat(1_048_577)),
    },
    {
      reason: "response_read_failure",
      status: 204,
      response: () =>
        new Response(null, {
          status: 204,
          headers: { "content-type": "text/html" },
        }),
    },
    {
      reason: "response_read_failure",
      status: 200,
      response: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(sensitiveBody));
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    },
    {
      reason: "parser_rejection",
      status: 200,
      response: () => html("<html>PRIVATE_BODY Player Two</html>"),
    },
    {
      reason: "token_reflection",
      status: 200,
      response: () => html(fixture.replace("Player Two", testToken)),
    },
  ];
  for (const entry of cases) {
    const before = warning.mock.callCount();
    const load = createHlstatsLoader({
      bypassToken: Object.hasOwn(entry, "token") ? entry.token : testToken,
      cache: noCache,
      fetch:
        entry.response ??
        (async () => {
          assert.fail("missing secret must not fetch");
        }),
    });
    assert.equal((await load()).error, true);
    assert.equal((await load()).error, true);
    assert.equal(warning.mock.callCount(), before + 1);
    assert.deepEqual(warning.mock.calls[before].arguments, [
      {
        reason: entry.reason,
        secretPresent: entry.reason !== "missing_secret",
        upstreamStatus: entry.status,
        cfMitigated: entry.mitigated ?? false,
      },
    ]);
  }
  assert.doesNotMatch(
    JSON.stringify(warning.mock.calls.map((call) => call.arguments)),
    /test-only-worker-secret|PRIVATE_BODY|Player Two|Alice|<html>|cf-ray/,
  );
});

test("successful refresh is silent; diagnostic sink failure cannot break error/backoff", async (t) => {
  const warning = t.mock.method(console, "warn", () => {
    throw new Error(testToken);
  });
  const success = createHlstatsLoader({
    bypassToken: testToken,
    cache: noCache,
    fetch: async () => html(),
  });
  assert.equal((await success()).error, false);
  assert.equal(warning.mock.callCount(), 0);
  const failure = createHlstatsLoader({ cache: noCache });
  assert.equal((await failure()).error, true);
  assert.equal((await failure()).error, true);
  assert.equal(warning.mock.callCount(), 1);
});

test("Worker binding exists only in server frontmatter, never markup or client script", () => {
  const page = readFileSync(
    new URL("../pages/stats.astro", import.meta.url),
    "utf8",
  );
  const [, frontmatter, markup] = page.split(/^---\s*$/m);
  assert.match(frontmatter, /import \{ env \} from 'cloudflare:workers'/);
  assert.match(
    frontmatter,
    /loadHlstatsPlayers\(\s*statsEnv\.HLSTATS_WAF_BYPASS_TOKEN/,
  );
  assert.doesNotMatch(
    markup,
    /HLSTATS_WAF_BYPASS_TOKEN|statsEnv|X-LamaTeam-Stats-Key|test-only-worker-secret|<script|set:html/,
  );
});

test("Cache API shares snapshots/backoff across isolates", async () => {
  let time = 1000;
  let calls = 0;
  const store = memoryCache();
  const options = {
    bypassToken: testToken,
    cache: () => store,
    now: () => time,
    fetch: async () => {
      calls++;
      return calls === 1 ? html() : html("challenge");
    },
  };
  await createHlstatsLoader(options)();
  assert.equal((await createHlstatsLoader(options)()).players.length, 2);
  assert.equal(calls, 1);
  time += 300_000;
  assert.equal((await createHlstatsLoader(options)()).error, true);
  await createHlstatsLoader(options)();
  assert.equal(calls, 2);
  const entry = await store.match(
    new Request("https://lamateam.eu/_internal/hlstats-players-v2"),
  );
  assert.ok(entry !== undefined);
});

test("cache outage and bad cached JSON do not break successful fetch", async () => {
  for (const cache of [
    () => {
      throw new Error("unavailable");
    },
    () => ({
      match: async () => new Response("bad JSON"),
      put: async () => {
        throw new Error("full");
      },
    }),
  ]) {
    const load = createHlstatsLoader({
      bypassToken: testToken,
      cache,
      fetch: async () => html(),
    });
    assert.equal((await load()).error, false);
  }
});

test("failed refresh recovers after backoff and resets freshness", async () => {
  let time = 1000;
  let calls = 0;
  const load = createHlstatsLoader({
    bypassToken: testToken,
    cache: noCache,
    now: () => time,
    fetch: async () => (++calls === 1 ? html("challenge") : html()),
  });
  assert.equal((await load()).error, true);
  time += 60_000;
  const recovered = await load();
  assert.equal(recovered.error, false);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.fetchedAt, time);
});

test("empty upstream ranking remains a successful cached result", async () => {
  let calls = 0;
  const load = createHlstatsLoader({
    bypassToken: testToken,
    cache: noCache,
    now: () => 1000,
    fetch: async () => {
      calls++;
      return html(fixture.replace(/<tr>\s*<td[\s\S]*?<\/table>/, "</table>"));
    },
  });
  assert.deepEqual(await load(), {
    players: [],
    fetchedAt: 1000,
    stale: false,
    error: false,
  });
  await load();
  assert.equal(calls, 1);
});

test("manual redirects fail closed without following or forwarding credentials", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const load = createHlstatsLoader({
      bypassToken: testToken,
      cache: noCache,
      fetch: async (url, init) => {
        calls++;
        assert.equal(url, HLSTATS_URL);
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers[HLSTATS_SECRET_HEADER], testToken);
        return html(fixture, {
          status,
          headers: {
            "Content-Type": "text/html",
            Location: "https://elsewhere.invalid/",
          },
        });
      },
    });
    assert.equal((await load()).error, true);
    assert.deepEqual((await load()).players, []);
    assert.equal(calls, 1);
  }
});

test("HTTP/challenge/oversize/timeout failures are bounded and negatively cached", async () => {
  for (const response of [
    () => html("challenge", { status: 403 }),
    () =>
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    () => html("challenge"),
    () => html("x".repeat(1_048_577)),
    () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "text/html" },
      }),
  ]) {
    let calls = 0;
    const load = createHlstatsLoader({
      bypassToken: testToken,
      cache: noCache,
      timeoutMs: 20,
      fetch: async () => {
        calls++;
        return response();
      },
    });
    // Keep Node's event loop alive: AbortSignal.timeout timers are unref'd.
    const keepAlive = setInterval(() => {}, 1000);
    try {
      assert.equal((await load()).error, true);
      assert.equal((await load()).error, true);
      assert.equal(calls, 1);
    } finally {
      clearInterval(keepAlive);
    }
  }
});
