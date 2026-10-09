import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import {
  allLocales,
  locales,
  content,
  pageKinds,
  routeManifest,
  localePath,
  equivalentPage,
  localeFromPath,
  localizedHref,
} from "./localized-content.ts";
import {
  pageCopy,
  translator,
  interactionKeys,
  chatKeys,
  clientCopy,
} from "./page-copy.ts";
import { guideDescriptions } from "./page-metadata.ts";
import { routeSeo } from "./locale-seo.ts";
import { localizeShell } from "./localized-markup.ts";
import { GET as sitemap } from "../pages/sitemap.xml.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("raw locale dictionaries preserve exact keys and game/network terminology", () => {
  const english = JSON.parse(read("./i18n/en.json"));
  const expected = Object.keys(english).sort();
  for (const locale of allLocales) {
    const dictionary = JSON.parse(read(`./i18n/${locale}.json`));
    assert.deepEqual(Object.keys(dictionary).sort(), expected, locale);
    for (const key of [
      "Rate",
      "loss",
      "choke",
      "CT",
      "T",
      "Cmdrate",
      "Updaterate",
    ])
      assert.equal(dictionary[key], key, `${locale}: ${key}`);
    for (const token of ["loss", "choke"])
      assert.ok(
        dictionary[
          "to monitor loss, choke, and gaps in the graph lines."
        ].includes(token),
        `${locale}: ${token}`,
      );
    const commands =
      dictionary[
        "❌ spamming commands, chat, or voice, and repeatedly pressuring players to use rtv, votemap/ban/kick/mute"
      ];
    assert.match(commands, /rtv/i, locale);
    assert.match(commands, /votemap\/ban\/kick\/mute/i, locale);
    assert.notEqual(dictionary["Admin Rules"], dictionary.Admins, locale);
    assert.ok(dictionary["CT Penalties"].includes("CT"), locale);
    assert.ok(dictionary["T Penalties"].includes("T"), locale);
  }
});
test("complete typed static-copy dictionaries have exact key and placeholder parity", () => {
  const keys = Object.keys(pageCopy.en).sort();
  assert.ok(keys.length > 300);
  for (const locale of allLocales) {
    assert.deepEqual(Object.keys(pageCopy[locale]).sort(), keys, locale);
    for (const key of keys) {
      const value = translator(locale)(key);
      assert.ok(value.trim().length > 0, `${locale}: ${key}`);
      const placeholders = (text) =>
        [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
      assert.deepEqual(
        placeholders(value),
        placeholders(key),
        `${locale}: ${key}`,
      );
      assert.doesNotMatch(value, /ZXQ\d|ZXP\w+PXZ/);
    }
    for (const key of [...interactionKeys, ...chatKeys])
      assert.ok(pageCopy[locale][key]);
    for (const key of ["CT", "T", "Counter-Strike: Source"])
      assert.equal(pageCopy[locale][key], key);
  }
  assert.throws(() => translator("cs")("missing key"), /Missing cs copy/);
});
test("existing home and connect seed copy remains complete without locale fallback", () => {
  const keys = Object.keys(content.cs).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(content[locale]).sort(), keys);
    assert.match(content[locale].languageRule, /CZ\/SK\/EN/);
  }
});
test("manifest contains exactly thirteen logical pages in eight locales and real route implementations", () => {
  assert.equal(pageKinds.length, 13);
  assert.equal(routeManifest.length, 104);
  assert.equal(new Set(routeManifest.map((r) => r.path)).size, 104);
  for (const { page, locale, path } of routeManifest) {
    assert.equal(path, localePath(locale, page));
    assert.equal(equivalentPage(path), page);
    assert.equal(localeFromPath(path), locale);
    assert.ok(
      existsSync(
        new URL(
          `../pages/${page === "home" ? "index" : page}.astro`,
          import.meta.url,
        ),
      ),
    );
  }
  const route = read("../pages/[locale]/[page].astro");
  assert.match(route, /<Page locale=\{locale\}/);
  for (const page of pageKinds.filter(
    (p) => !["home", "connect"].includes(p),
  )) {
    assert.match(route, new RegExp(`['"]\\.\\./${page}\\.astro['"]`));
    const implementation = read(`../pages/${page}.astro`);
    assert.match(implementation, /Astro\.props\.locale \?\? localeFromPath/);
    assert.match(implementation, /translator\(locale\)/);
    assert.match(implementation, /lang=\{locale\}/);
    assert.ok(pageCopy.cs[guideDescriptions[page]], `${page} metadata`);
  }
});
test("English URLs stay unprefixed, locale navigation keeps query/hash and exempts APIs and dashboards", () => {
  assert.equal(localePath("en", "home"), "/");
  assert.equal(localePath("en", "rules"), "/rules");
  assert.equal(localePath("cs", "connect"), "/cs/connect/");
  assert.equal(
    localizedHref("/rules?view=full#penalties", "fr"),
    "/fr/rules/?view=full#penalties",
  );
  assert.equal(localizedHref("/cs/maps/", "de"), "/de/maps/");
  for (const path of [
    "/api/auth/steam",
    "/stats",
    "/bans",
    "/banlist",
    "steam://connect/82.208.17.101:27516",
    "https://discord.com",
  ])
    assert.equal(localizedHref(path, "cs"), path);
  for (const path of [
    "/xx/",
    "/cs/stats/",
    "/cs/home/",
    "/home",
    "/de/connect/extra",
    "/cs//rules",
  ])
    assert.equal(equivalentPage(path), undefined);
});
test("canonical, reciprocal hreflang, x-default and sitemap share the real route manifest", async () => {
  const xml = await (await sitemap({})).text();
  const locs = new Set(
    [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
  );
  for (const { page, locale, path } of routeManifest) {
    const seo = routeSeo(path);
    assert.equal(seo.locale, locale);
    assert.equal(seo.canonical, `https://lamateam.eu${path}`);
    assert.equal(seo.xDefault, `https://lamateam.eu${localePath("en", page)}`);
    assert.ok(locs.has(seo.canonical));
    assert.equal(seo.alternates.length, 8);
    for (const alternate of seo.alternates) {
      assert.ok(locs.has(alternate.url));
      const reciprocal = routeSeo(new URL(alternate.url).pathname);
      assert.deepEqual(reciprocal.alternates, seo.alternates);
    }
  }
  for (const path of ["/bans", "/banlist", "/stats"]) {
    const seo = routeSeo(path);
    assert.deepEqual(seo.alternates, []);
    assert.equal(seo.xDefault, undefined);
    assert.ok(locs.has(seo.canonical));
  }
  assert.equal(routeSeo("/rules/").canonicalPath, "/rules");
});
test("server shell localizes copy, accessibility and links, never code, SVGs or user values", () => {
  const html =
    '<nav aria-label="Community"><a href="/rules">Rules</a><button title="Pull down navigation">Menu</button><span translate="no">Rules</span><svg><title>Rules</title></svg><script>const text="Rules"</script></nav>';
  const output = localizeShell(html, "cs");
  assert.match(output, /href="\/cs\/rules\/"/);
  assert.ok(output.includes(pageCopy.cs.Rules));
  assert.ok(output.includes(pageCopy.cs["Pull down navigation"]));
  assert.ok(output.includes('<span translate="no">Rules</span>'));
  assert.ok(output.includes("<svg><title>Rules</title></svg>"));
  assert.ok(output.includes('<script>const text="Rules"</script>'));
  assert.throws(
    () => localizeShell("<p>New untranslated shell label</p>", "cs"),
    /Missing shell copy/,
  );
});
test("language selector keeps designer flag markup but disables the old DOM translation script", () => {
  const html =
    '<label for="language">Language</label><select id="language" translate="no"><button><selectedcontent></selectedcontent></button><option data-path="/cs/rules/"><svg width="18" height="12"><path d="M0 0"/></svg><span>Čeština</span></option></select><script src="/old-language-selector.js" type="module"></script>';
  const output = localizeShell(html, "cs", true);
  assert.doesNotMatch(output, /<script/);
  assert.ok(
    output.includes('<svg width="18" height="12"><path d="M0 0"/></svg>'),
  );
  assert.ok(output.includes("<selectedcontent></selectedcontent>"));
  assert.ok(output.includes("Čeština"));
  assert.ok(output.includes(pageCopy.cs.Language));
  const component = read("../components/LocalizedMarkup.astro");
  assert.doesNotMatch(component, /api\/translate|localStorage|TreeWalker/);
  assert.match(component, /target\.search = location\.search/);
  assert.match(component, /target\.hash = location\.hash/);
  const noScript = localizeShell(
    '<noscript><nav aria-label="Languages"><a href="/cs/rules/" hreflang="cs" lang="cs">Čeština</a></nav></noscript>',
    "cs",
    true,
  );
  assert.ok(noScript.includes(pageCopy.cs.Languages));
  assert.ok(noScript.includes('href="/cs/rules/"'));
});
test("interaction copy is explicit bundled locale data, never an external translation request", () => {
  assert.equal(Object.keys(clientCopy("uk")).length, interactionKeys.length);
  const maps = read("../pages/maps.astro");
  const ratings = read("../components/MapRatings.astro");
  assert.match(maps, /<MapRatings locale=\{locale\}/);
  assert.match(ratings, /JSON\.stringify\(\{\s*\.\.\.clientCopy\(locale\)/);
  assert.match(ratings, /clientTranslator\(root\)/);
  assert.match(ratings, /const request =/);
  assert.doesNotMatch(ratings, /api\/translate/);
});
