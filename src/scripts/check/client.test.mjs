import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { safeSourceUrl } from "./safety.mjs";

const script = stripTypeScriptTypes(
  readFileSync(new URL("./client.ts", import.meta.url), "utf8"),
).replace(/^import\b[\s\S]*?;\r?\n/gm, "");

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.hidden = false;
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.textContent = "";
  }
  addEventListener(type, handler) {
    this.handlers[type] = handler;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  getAttribute(key) {
    return this.attributes[key];
  }
  removeAttribute(key) {
    delete this.attributes[key];
    delete this[key];
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  focus() {}
}
class Anchor extends Element {}

function harness(
  respond,
  url = "https://lamateam.eu/check?communityid=76561197960265731",
) {
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const root = get("[data-check-page]");
  root.querySelector = get;
  root.querySelectorAll = () =>
    get("[data-check-players]").children.map((row) => row.children[1]);
  const handlers = {};
  const calls = [];
  const redirects = [];
  vm.runInNewContext(script, {
    document: {
      querySelector: () => root,
      documentElement: { lang: "en" },
      createElement: (tag) =>
        tag === "a" ? new Anchor(tag) : new Element(tag),
      createTextNode: (text) => ({ textContent: text }),
      addEventListener: (type, handler) => {
        handlers[type] = handler;
      },
    },
    window: {
      location: {
        href: url,
        replace: (url) => redirects.push(url),
      },
      setInterval: () => 1,
      clearInterval() {},
    },
    HTMLAnchorElement: Anchor,
    AbortController,
    AbortSignal,
    URL,
    Date,
    safeSourceUrl,
    fetch: async (path, options) => {
      calls.push({ path, options });
      return respond(path, options);
    },
  });
  get("[data-check-result-content]").hidden = true;
  handlers["astro:page-load"]();
  return { get, calls, redirects, elements };
}
const settle = async () => {
  for (let i = 0; i < 15; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

const steamId64 = "76561197960265731";
const profileUrl = `https://mizan.ac/players/steam/${steamId64}`;
const banResult = (overrides = {}) => ({
  queriedAt: Date.now(),
  profileUrl,
  steamId64,
  cheater: true,
  trolling: false,
  bans: {
    total: 3,
    active: 2,
    sources: 2,
    conduct: 1,
    categories: ["Cheating"],
    games: ["Counter-Strike: Source"],
    lastAt: "2026-10-01T12:00:00Z",
  },
  ...overrides,
});
const recentIds = () => ({
  observedAt: Date.now(),
  players: [{ communityId: steamId64, lastSeen: Date.now() }],
});

test("VM strips all client imports and loads recent IDs without authorization or automatic checks", async () => {
  assert.doesNotMatch(script, /^import\b/m);
  for (const query of [
    "",
    "?communityid=",
    "?communityid=%20",
    "?communityid=spoofed",
  ]) {
    const app = harness(
      () => response(200, recentIds()),
      `https://lamateam.eu/check${query}`,
    );
    await settle();
    assert.deepEqual(
      app.calls.map(({ path }) => path),
      ["/api/check/players"],
    );
    assert.deepEqual(app.redirects, []);
    const row = app.get("[data-check-players]").children[0];
    assert.equal(row.children[0].children[0].textContent, steamId64);
    assert.equal(
      row.children[1].attributes["aria-label"],
      `Check Mizan for CommunityID ${steamId64}`,
    );
  }
});
function checkHarness(result) {
  return harness((path) => {
    if (path.endsWith("/players")) return response(200, recentIds());
    return response(200, result);
  });
}
async function runCheck(app) {
  await settle();
  app.get("[data-check-players]").children[0].children[1].handlers.click();
  await settle();
}

test("manual ban check renders structured counts and untrusted labels as text, never raw names", async () => {
  const malicious = "<img src=x onerror=alert(1)>";
  const app = harness((path) => {
    if (path.endsWith("/players"))
      return response(200, {
        observedAt: Date.now(),
        players: [
          {
            communityId: "76561197960265731",
            name: malicious,
            lastSeen: Date.now(),
          },
        ],
      });
    const result = banResult();
    result.bans.categories = [malicious];
    result.bans.games = [malicious];
    return response(200, result);
  });
  await settle();
  assert.equal(app.get("[data-check-workspace]").hidden, false);
  const row = app.get("[data-check-players]").children[0];
  assert.equal(row.children[0].children[0].textContent, steamId64);
  row.children[1].handlers.click();
  await settle();
  assert.deepEqual(JSON.parse(app.calls[1].options.body), {
    communityId: "76561197960265731",
  });
  assert.equal(app.get("[data-check-categories]").textContent, malicious);
  assert.equal(app.get("[data-check-games]").textContent, malicious);
  assert.equal(app.get("[data-check-bans-active]").textContent, "2");
  assert.equal(app.get("[data-check-bans-total]").textContent, "3");
  assert.equal(app.get("[data-check-bans-sources]").textContent, "2");
  assert.equal(app.get("[data-check-bans-conduct]").textContent, "1");
  assert.equal(app.get("[data-check-cheater]").textContent, "Flagged by Mizan");
  assert.equal(
    app.get("[data-check-trolling]").textContent,
    "Not flagged by Mizan",
  );
  const profile = app.get("[data-check-profile]");
  assert.equal(profile.href, profileUrl);
  assert.equal(profile.target, "_blank");
  assert.equal(profile.rel, "noopener noreferrer");
  assert.match(
    app.get("[data-check-search-status]").textContent,
    /leads to verify, not a verdict/,
  );
  assert.match(
    app.get("[data-check-query-time]").textContent,
    /Query completed:/,
  );
  assert.notEqual(
    app.get("[data-check-last-ban]").textContent,
    "Time unavailable",
  );
});

test("zero matches are qualified and empty labels are explicit without undocumented data fields", async () => {
  const app = checkHarness(
    banResult({
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
    }),
  );
  await runCheck(app);
  assert.equal(app.get("[data-check-result-content]").hidden, false);
  assert.equal(app.get("[data-check-bans-active]").textContent, "0");
  assert.match(
    app.get("[data-check-search-status]").textContent,
    /not proof of innocence/,
  );
  assert.match(
    app.get("[data-check-categories]").textContent,
    /None reported by Mizan/,
  );
  assert.match(
    app.get("[data-check-games]").textContent,
    /None reported by Mizan/,
  );
  assert.equal(
    app.get("[data-check-last-ban]").textContent,
    "No last ban time reported",
  );
});

test("opaque record and Steam fields are ignored; bounded string arrays are accepted", async () => {
  const opaque = "UNDOCUMENTED_RECORD_CONTENT";
  const result = banResult({
    recordPresent: null,
    steamDataPresent: { arbitrary: opaque },
    record: opaque,
    steam: opaque,
  });
  result.bans.categories = Array(128).fill("a".repeat(128));
  result.bans.games = Array(128).fill("b".repeat(128));
  const app = checkHarness(result);
  await runCheck(app);
  assert.equal(app.get("[data-check-result-content]").hidden, false);
  for (const [selector, element] of app.elements) {
    assert.doesNotMatch(selector, /data-check-record|data-check-steam-data/);
    assert.equal(element.textContent.includes(opaque), false);
  }
  const page = readFileSync(
    new URL("../../pages/check.astro", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    page,
    /data-check-record|data-check-steam-data|Registry record|Steam data/,
  );
});

test("unsafe and noncanonical profile URLs never become links", async () => {
  for (const url of [
    "javascript:alert(1)",
    "https://evil.example/",
    `${profileUrl}?redirect=evil`,
    `${profileUrl}#test`,
    "https://mizan.ac/players/steam/76561197960265732",
    `https://user:secret@mizan.ac/players/steam/${steamId64}`,
  ]) {
    const app = checkHarness(banResult({ profileUrl: url }));
    await runCheck(app);
    assert.equal(app.get("[data-check-result-content]").hidden, false);
    assert.equal(app.get("[data-check-profile]").hidden, true);
    assert.equal(app.get("[data-check-profile]").href, undefined);
    assert.equal(app.get("[data-check-profile-unavailable]").hidden, false);
  }
});

test("invalid structured responses fail closed instead of displaying counts", async () => {
  const good = banResult();
  const invalid = [
    { summary: "Old API", sources: [] },
    banResult({ steamId64: "76561197960265732" }),
    banResult({ queriedAt: null }),
    banResult({ profileUrl: null }),
    banResult({ cheater: "false" }),
    banResult({ trolling: 0 }),
    ...[
      { total: -1 },
      { active: 4 },
      { active: "2" },
      { sources: 1.5 },
      { conduct: NaN },
      { total: Number.MAX_SAFE_INTEGER + 1 },
      { categories: [1] },
      { categories: [" "] },
      { categories: ["a".repeat(129)] },
      { categories: Array(129).fill("Cheating") },
      { categories: ["Cheating\u0000"] },
      { games: null },
      { games: ["a".repeat(129)] },
      { games: Array(129).fill("Counter-Strike: Source") },
      { games: ["\n"] },
      { lastAt: "not a date" },
      { lastAt: Date.now() },
    ].map((bans) => banResult({ bans: { ...good.bans, ...bans } })),
  ];
  for (const value of invalid) {
    const app = checkHarness(value);
    await runCheck(app);
    assert.equal(app.get("[data-check-result-content]").hidden, true);
    assert.match(
      app.get("[data-check-search-status]").textContent,
      /unavailable or response invalid/,
    );
    assert.equal(
      app.get("[data-check-results]").attributes["aria-busy"],
      "false",
    );
  }
});

test("stale registry results are labelled and a failed retry hides prior counts", async () => {
  let checks = 0;
  const app = harness((path) => {
    if (path.endsWith("/players")) return response(200, recentIds());
    return checks++
      ? response(503)
      : response(200, banResult({ queriedAt: "2020-01-01T00:00:00Z" }));
  });
  await runCheck(app);
  assert.equal(app.get("[data-check-result-stale]").hidden, false);
  await runCheck(app);
  assert.equal(app.get("[data-check-result-content]").hidden, true);
  assert.match(
    app.get("[data-check-search-status]").textContent,
    /No conclusion can be drawn/,
  );
});
