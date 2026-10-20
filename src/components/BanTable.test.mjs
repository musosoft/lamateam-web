import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const script = (path) =>
  stripTypeScriptTypes(
    source(path)
      .match(/<script>([\s\S]*?)<\/script>/)[1]
      .replace(/import .*? from .*?;/g, ""),
  );

test("stats remains a local native table route", () => {
  const page = source("../pages/stats.astro");
  assert.match(
    page,
    /await loadHlstatsPlayers\(\s*statsEnv\.HLSTATS_WAF_BYPASS_TOKEN,?\s*\)/,
  );
  assert.match(page, /<table/);
  assert.doesNotMatch(page, /<iframe|Astro\.redirect|http-equiv=["']refresh/);
});

test("stats links to full HLstatsX statistics in every loading state without the old key", () => {
  const page = source("../pages/stats.astro");
  const header = page.match(/<header[\s\S]*?<\/header>/)[0];
  assert.match(header, /href="https:\/\/stats\.lamateam\.eu\/"/);
  assert.match(header, /Full statistics on HLstatsX/);
  assert.match(header, /rel="external"/);
  assert.doesNotMatch(page, /Skill is the HLstatsX rating|stats-key/);
  assert.match(page, /<table aria-describedby="stats-summary">/);
});

test("shared responsive menu includes canonical external stats and bans destinations", () => {
  const nav = source("./CommunityNav.astro");
  const links = vm.runInNewContext(
    nav.match(/const links = ([\s\S]*?) as const;/)[1],
  );
  const bansUrl = source("../lib/sourcebans.ts").match(
    /SOURCEBANS_URL =\s*"([^"]+)"/,
  )[1];
  assert.equal(
    links.find(([label]) => label === "HLstatsX")[1],
    "https://stats.lamateam.eu/",
  );
  assert.equal(links.find(([label]) => label === "SourceBans")[1], bansUrl);
  const labelExpression = nav.match(
    /<span>\s*\{([\s\S]*?\blabel\b[\s\S]*?)\}\s*<\/span>/,
  )[1];
  const translated = [];
  for (const [label] of links) {
    const brand = label === "HLstatsX" || label === "SourceBans";
    const rendered = vm.runInNewContext(labelExpression, {
      label,
      t: (key) => {
        translated.push(key);
        return `translated:${key}`;
      },
    });
    assert.equal(rendered, brand ? label : `translated:${label}`);
  }
  assert.deepEqual(translated, [
    "Rules",
    "Maps",
    "Commands",
    "Money",
    "Hitreg",
    "Fixes",
    "Speed",
    "SourceTV",
    "Admins",
    "VIP",
    "Contact",
  ]);
  // One link collection serves desktop, mobile overflow, and no-JS navigation.
  assert.equal((nav.match(/links\.map\(/g) || []).length, 1);
  assert.match(nav, /href=\{localizedHref\(href, locale\)\}/);
  assert.match(
    nav,
    /rel=\{href\.startsWith\('https:\/\/'\) \? 'external' : undefined\}/,
  );
});

test("ban table matches HLstatsX table presentation while retaining mobile scrolling", () => {
  const bans = source("./BanTable.astro");
  const stats = source("../pages/stats.astro");
  for (const rule of [
    "scrollbar-color: #4878b6 #131f32;",
    "outline: 2px solid var(--accent);",
    "font-size: 0.875rem;",
    "background: #16263d;",
    "border-bottom: 1px solid var(--edge);",
    "padding: 0.875rem 1rem;",
    "vertical-align: middle;",
    "border-top: 1px solid var(--edge);",
    "@media (max-width: 700px)",
    "padding: 0.75rem;",
  ]) {
    assert.ok(stats.includes(rule), `HLstatsX baseline: ${rule}`);
    assert.ok(bans.includes(rule), `Ban table: ${rule}`);
  }
  assert.match(bans, /class="ban-table-scroll panel"/);
  assert.match(bans, /aria-describedby="banlist-scroll-help"/);
  assert.match(bans, /id="banlist-scroll-help"/);
  assert.match(bans, /overflow-x: auto/);
  assert.doesNotMatch(bans, /<caption class="sr-only"|#374151|#fbbf24/);
});

test("both public ban routes load the same native, accessible table without redirects", () => {
  for (const route of ["bans", "banlist"]) {
    const page = source(`../pages/${route}.astro`);
    assert.match(page, /await loadSourceBans\(\)/);
    assert.match(page, /<BanTable \{\.\.\.result\} \/>/);
    assert.match(page, /prerender = false/);
    assert.match(page, /response\.status = 503/);
    assert.doesNotMatch(page, /<iframe|Astro\.redirect|http-equiv=["']refresh/);
  }
  const table = source("./BanTable.astro");
  assert.match(table, /<table aria-describedby="banlist-summary">/);
  assert.match(table, /<caption/);
  assert.match(table, /scope="col"/);
  assert.match(table, /scope="row"/);
  assert.match(table, /tabindex="0"/);
  assert.match(table, /\{ban\.player\}/);
  assert.match(table, /\{ban\.reason/);
  assert.doesNotMatch(table, /<iframe|set:html/);
});

test("shared Layout enables native routing and refreshes MOTD links after each swap", () => {
  assert.match(
    source("../layouts/Layout.astro"),
    /import \{ ClientRouter \} from 'astro:transitions'/,
  );
  assert.match(source("../layouts/Layout.astro"), /<ClientRouter \/>/);
  const document = new EventTarget();
  const link = (href) => ({
    attrs: { href },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  });
  let links = [];
  document.body = {
    dataset: { communityId: "123", playerName: "Player & Friend" },
  };
  document.querySelectorAll = () => links;
  vm.runInNewContext(script("../layouts/Layout.astro"), {
    document,
    URL,
    window: { location: { origin: "https://lamateam.eu" } },
  });
  for (let swap = 0; swap < 2; swap++) {
    links = [
      link("/bans"),
      link("/api/auth/steam"),
      link("steam://connect/82.208.17.101:27516"),
      link("https://example.org/"),
    ];
    document.dispatchEvent(new Event("astro:page-load"));
    const target = new URL(links[0].attrs.href, "https://lamateam.eu");
    assert.equal(target.searchParams.get("communityid"), "123");
    assert.equal(target.searchParams.get("name"), "Player & Friend");
    assert.equal(links[1].attrs.href, "/api/auth/steam");
    assert.equal(links[1].attrs["data-astro-reload"], "");
    assert.equal(links[2].attrs.href, "steam://connect/82.208.17.101:27516");
    assert.equal(links[3].attrs.href, "https://example.org/");
  }
});

test("connect copy binds new route elements once after navigation and supports clipboard failure", async () => {
  const document = new EventTarget();
  let elements;
  document.querySelector = (selector) => elements?.[selector] ?? null;
  let calls = 0;
  let fail = false;
  vm.runInNewContext(script("../pages/connect.astro"), {
    document,
    navigator: {
      clipboard: {
        async writeText(value) {
          assert.equal(value, "connect 82.208.17.101:27516");
          calls++;
          if (fail) throw new Error("Denied");
        },
      },
    },
    clientTranslator: (element) => {
      let copy = {};
      try {
        copy = JSON.parse(element?.dataset?.copy || "{}");
      } catch {}
      return (key, values = {}) => {
        let text = copy[key] || key;
        for (const [name, value] of Object.entries(values)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
        return text;
      };
    },
  });
  for (let swap = 0; swap < 2; swap++) {
    const button = new EventTarget();
    button.dataset = {};
    const command = {
      value: "connect 82.208.17.101:27516",
      focus() {
        this.focused = true;
      },
      select() {
        this.selected = true;
      },
    };
    const status = { textContent: "" };
    elements = {
      "#copy-command": button,
      "#connect-command": command,
      "#copy-status": status,
    };
    document.dispatchEvent(new Event("astro:page-load"));
    document.dispatchEvent(new Event("astro:page-load"));
    fail = swap === 1;
    button.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, swap + 1);
    assert.match(
      status.textContent,
      fail ? /Copy unavailable/ : /Command copied/,
    );
    if (fail) assert.ok(command.focused && command.selected);
  }
});

test("language selector rebinds on static localized pages and returns to English for on-demand translation", async () => {
  const document = new EventTarget();
  let selector;
  const targets = [];
  document.getElementById = () => selector;
  document.querySelector = () => ({ textContent: "" });
  document.querySelectorAll = () => [];
  document.documentElement = { lang: "EN" };
  document.title = "Connect";
  vm.runInNewContext(script("./LanguageSelector.astro"), {
    document,
    AbortController,
    URL,
    navigate: (target) => targets.push(target),
    localStorage: {
      setItem() {},
      getItem() {
        return "CS";
      },
    },
    MutationObserver: class MutationObserver {
      constructor() {}
      observe() {}
      disconnect() {}
    },
    window: {
      location: { origin: "https://lamateam.eu", search: "?communityid=123" },
    },
  });
  for (let swap = 0; swap < 2; swap++) {
    const previous = selector;
    document.dispatchEvent(new Event("astro:before-swap"));
    selector = new EventTarget();
    selector.dataset = { pageKind: "connect", currentLanguage: "CS" };
    selector.value = "CS";
    selector.selectedOptions = [{ dataset: { path: "/cs/connect" } }];
    selector.querySelector = () => ({ dataset: { path: "/connect" } });
    document.dispatchEvent(new Event("astro:page-load"));
    document.dispatchEvent(new Event("astro:page-load"));
    assert.equal(targets.length, swap); // Stored preference must not redirect.
    previous?.dispatchEvent(new Event("change"));
    selector.dispatchEvent(new Event("change"));
    assert.equal(targets.length, swap + 1);
    assert.equal(targets[swap], "https://lamateam.eu/connect?communityid=123");
  }
});
