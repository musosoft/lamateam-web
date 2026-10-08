import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSourceBansLoader,
  parseSourceBans,
  SOURCEBANS_URL,
} from "./sourcebans.ts";

const header =
  "<tr><td>MOD/Country</td><td>Date</td><td>Player</td><td>Admin</td><td>Length</td></tr>";
const banRows = `<tr class="opener tbl_out"><td><img src="ignored" alt="CZ"></td>
  <td>10-04-26 03:43</td><td><div>Alice &amp; Bob &#x1F600; &lt;script&gt;</div></td>
  <td>CONSOLE</td><td>30 min (Expired)</td></tr>
  <tr><td colspan="7"><div class="opener"><table>
    <tr><td>Steam ID</td><td>STEAM_0:1:123</td></tr>
    <tr><td>IP address</td><td>Do not expose</td></tr>
    <tr><td>Reason</td><td>Team&nbsp;kill <script>bad()</script><a href="javascript:bad()">limit</a></td></tr>
  </table></div></td></tr>`;
function fixture(rows = banRows, total = 741) {
  return `<script>const fake = '<div id="banlist">spoof</div>';</script>
    <table><tr><td>Unrelated search form</td></tr></table>
    <div id="banlist-nav">Total Bans: ${total}</div>
    <div id="banlist"><table><tbody>${header}${rows}</tbody></table></div>`;
}
const html = fixture();
const htmlResponse = (body = html) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });

test("extracts only list summaries and paired details, returns inert decoded text", () => {
  const parsed = parseSourceBans(html);
  assert.equal(parsed.total, 741);
  assert.deepEqual(parsed.bans, [
    {
      date: "10-04-26 03:43",
      player: "Alice & Bob 😀 <script>",
      admin: "CONSOLE",
      length: "30 min (Expired)",
      steamId: "STEAM_0:1:123",
      reason: "Team kill limit",
      countryCode: null,
      flagUrl: null,
    },
  ]);
  assert.ok(!JSON.stringify(parsed).includes("Do not expose"));
  assert.ok(!JSON.stringify(parsed).includes("javascript:"));
});

test("extracts the observed SourceBans MOD/Country flag, not the game icon", () => {
  for (const code of [
    "us",
    "cz",
    "de",
    "hu",
    "sk",
    "ru",
    "fi",
    "ro",
    "hr",
    "sa",
  ]) {
    // Shape observed in the public banlist response; no IP or other detail data.
    const cell = `<img src="images/games/csource.png" alt="MOD" border="0" align="absmiddle" />&nbsp;<img src="images/country/${code}.gif" alt="${code.toUpperCase()}" border="0" align="absmiddle" />`;
    const ban = parseSourceBans(
      html.replace('<img src="ignored" alt="CZ">', cell),
    ).bans[0];
    assert.equal(ban.countryCode, code.toUpperCase());
    assert.equal(
      ban.flagUrl,
      `https://sourcebans.fakaheda.eu/sbans_336496/images/country/${code}.gif`,
    );
  }
});

test("country flags accept only exact trusted paths and valid ISO country codes", () => {
  const parseFlag = (image) =>
    parseSourceBans(html.replace('<img src="ignored" alt="CZ">', image))
      .bans[0];
  for (const path of [
    "images/country/cz.gif",
    "/sbans_336496/images/country/cz.gif",
    "https://sourcebans.fakaheda.eu/sbans_336496/images/country/cz.gif",
  ]) {
    const ban = parseFlag(`<img src="${path}" alt="CZ" onerror="bad()">`);
    assert.equal(ban.countryCode, "CZ");
    assert.equal(
      ban.flagUrl,
      "https://sourcebans.fakaheda.eu/sbans_336496/images/country/cz.gif",
    );
    assert.ok(!JSON.stringify(ban).includes("bad()"));
  }
  for (const path of [
    "images/country/zz.gif",
    "images/country/xx.gif",
    "images/country/eu.gif",
    "images/country/unknown.gif",
    "images/country/cz.svg",
    "images/country/cz.gif?tracking=1",
    "images/country/cz.gif#fragment",
    "images/country/../cz.gif",
    "images/country/%63z.gif",
    "//evil.example/images/country/cz.gif",
    "https://evil.example/images/country/cz.gif",
    "https://sourcebans.fakaheda.eu.evil.example/sbans_336496/images/country/cz.gif",
    "https://sourcebans.fakaheda.eu@evil.example/sbans_336496/images/country/cz.gif",
    "http://sourcebans.fakaheda.eu/sbans_336496/images/country/cz.gif",
    "javascript:bad()",
    "data:image/svg+xml,bad",
  ]) {
    const ban = parseFlag(`<img src="${path}" alt="CZ">`);
    assert.equal(ban.countryCode, null, path);
    assert.equal(ban.flagUrl, null, path);
  }
  for (const image of [
    '<img src="images/country/cz.gif" alt="US">',
    '<img src="images/country/cz.gif" alt="&lt;script&gt;">',
    '<img src="images/country/cz.gif" alt="CZ"><img src="images/country/us.gif" alt="US">',
    "",
  ]) {
    const ban = parseFlag(image);
    assert.equal(ban.countryCode, null);
    assert.equal(ban.flagUrl, null);
  }
  // A flag in a detail field is not country evidence for the summary row.
  assert.equal(
    parseSourceBans(
      html.replace(
        "Team&nbsp;kill",
        '<img src="images/country/cz.gif" alt="CZ">Team&nbsp;kill',
      ),
    ).bans[0].countryCode,
    null,
  );
});

test("recognizes confirmed empty lists but not challenge/error pages or changed structure", () => {
  assert.deepEqual(parseSourceBans(fixture("", 0)), { bans: [], total: 0 });
  assert.equal(
    parseSourceBans(fixture('<tr><td colspan="5">No bans found</td></tr>', 0))
      .bans.length,
    0,
  );
  for (const invalid of [
    "<html>Cloudflare challenge</html>",
    fixture("", 741),
    html.replace("<td>Admin</td>", "<td>Changed</td>"),
    html.replace('class="opener tbl_out"', 'class="changed"'),
    html.replace("<td>Reason</td>", "<td>Changed</td>"),
    html.replace("<td>10-04-26 03:43</td>", ""),
    html.replace("</tbody>", "<tr><td>Unexpected row</td></tr></tbody>"),
    html + '<div id="banlist"><table></table></div>',
  ])
    assert.throws(() => parseSourceBans(invalid));
  assert.throws(() => parseSourceBans("x".repeat(1_048_577)));
  assert.throws(() => parseSourceBans(fixture(banRows.repeat(31))));
});

test("coalesces concurrent reads and refreshes only after five minutes", async () => {
  let now = 1_000_000;
  let calls = 0;
  const load = createSourceBansLoader({
    now: () => now,
    cache: () => undefined,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, SOURCEBANS_URL);
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      return htmlResponse();
    },
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => load()));
  assert.equal(calls, 1);
  assert.ok(
    results.every((result) => result.data.bans.length === 1 && !result.stale),
  );
  now += 299_999;
  await load();
  assert.equal(calls, 1);
  now++;
  await load();
  assert.equal(calls, 2);
});

test("manual redirects fail closed even with valid ban HTML and never follow Location", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    let request;
    const load = createSourceBansLoader({
      cache: () => undefined,
      fetch: async (url, options) => {
        calls++;
        request = { url, options };
        return new Response(html, {
          status,
          headers: {
            "Content-Type": "text/html",
            Location: "https://example.org/untrusted",
          },
        });
      },
    });
    assert.deepEqual(await load(), {
      data: null,
      fetchedAt: null,
      stale: false,
    });
    await load();
    assert.equal(calls, 1);
    assert.equal(request.url, SOURCEBANS_URL);
    assert.equal(request.options.redirect, "manual");
  }
});

test("retains bounded stale data and backs off after HTTP failure", async () => {
  let now = 1_000_000;
  let calls = 0;
  const load = createSourceBansLoader({
    now: () => now,
    cache: () => undefined,
    fetch: async () => {
      calls++;
      return calls === 1
        ? htmlResponse()
        : new Response("Failed", { status: 503 });
    },
  });
  await load();
  now += 300_000;
  const stale = await load();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, 1_000_000);
  assert.equal(stale.data.bans.length, 1);
  await load();
  assert.equal(calls, 2);
  now += 60_000;
  await load();
  assert.equal(calls, 3);
  now = 4_600_000;
  assert.equal((await load()).data, null);
});

function memoryCache() {
  let stored;
  return {
    match: async () => stored?.clone(),
    put: async (_key, value) => {
      stored = value.clone();
    },
  };
}

test("edge cache shares fresh data across isolates and preserves stale data during failure", async () => {
  let now = 1_000_000;
  const store = memoryCache();
  let calls = 0;
  const options = {
    now: () => now,
    cache: () => store,
    fetch: async () => {
      calls++;
      return calls === 1
        ? htmlResponse()
        : new Response("Error", { status: 500 });
    },
  };
  const originalIsolate = createSourceBansLoader(options);
  await originalIsolate();
  assert.equal((await createSourceBansLoader(options)()).data.bans.length, 1);
  assert.equal(calls, 1);
  now += 300_000;
  assert.equal((await createSourceBansLoader(options)()).stale, true);
  assert.equal(calls, 2);
  assert.equal((await createSourceBansLoader(options)()).stale, true);
  assert.equal(calls, 2);
  now = 4_600_000;
  assert.equal((await originalIsolate()).data, null);
  assert.equal(calls, 3);
  assert.equal((await createSourceBansLoader(options)()).data, null);
  assert.equal(calls, 3);
});

test("negative caches cold failures across isolates, retries after one minute", async () => {
  let now = 1_000_000;
  const store = memoryCache();
  let calls = 0;
  const options = {
    now: () => now,
    cache: () => store,
    fetch: async () => {
      calls++;
      throw new Error("Offline");
    },
  };
  assert.equal((await createSourceBansLoader(options)()).data, null);
  assert.equal((await createSourceBansLoader(options)()).data, null);
  assert.equal(calls, 1);
  now += 60_000;
  await createSourceBansLoader(options)();
  assert.equal(calls, 2);
});

test("parser, content type, oversized response and cache failures are handled without throwing", async () => {
  for (const response of [
    htmlResponse("<html>Not a ban list</html>"),
    new Response("{}", { headers: { "Content-Type": "application/json" } }),
    htmlResponse("x".repeat(1_048_577)),
  ]) {
    let calls = 0;
    const load = createSourceBansLoader({
      fetch: async () => {
        calls++;
        return response;
      },
      cache: () => ({
        match: async () => {
          throw new Error("Cache failed");
        },
        put: async () => {
          throw new Error("Cache failed");
        },
      }),
    });
    assert.equal((await load()).data, null);
    assert.equal((await load()).data, null);
    assert.equal(calls, 1);
  }
  const load = createSourceBansLoader({
    fetch: async () => htmlResponse(),
    cache: () => {
      throw new Error("No cache");
    },
  });
  assert.equal((await load()).data.bans.length, 1);
});

test("shared ban table interpolates text only, without iframe or raw upstream HTML", () => {
  const table = readFileSync(
    new URL("../components/BanTable.astro", import.meta.url),
    "utf8",
  );
  assert.ok(!table.includes("<iframe"));
  assert.ok(!table.includes("set:html"));
  assert.ok(table.includes('scope="col"') && table.includes('scope="row"'));
  assert.ok(table.includes('tabindex="0"'));
  assert.ok(table.includes("{ban.player}") && table.includes("{ban.reason"));
  assert.match(table, /ban\.countryCode && ban\.flagUrl/);
  assert.match(table, /src=\{ban\.flagUrl\}/);
  assert.match(table, /alt=\{`\$\{ban\.countryCode\} flag`\}/);
  assert.match(table, /referrerpolicy="no-referrer"/);
});
