import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { parse } from "parse5";
import { preferredMotdLanguage, selectHomeLocale } from "./motd-locale.ts";
import { translator } from "./page-copy.ts";

const select = (
  acceptLanguage,
  country = "CZ",
  userAgent = "Valve Steam Client",
  pathname = "/",
) => selectHomeLocale({ pathname, userAgent, acceptLanguage, country });

test("highest supported positive quality wins, with regional tags and stable ties", () => {
  assert.equal(select("ru;q=1, pl-PL;q=0.4, SK-sk;q=0.9, cs;q=0.8"), "sk");
  assert.equal(select("de;q=.8, fr;q=0.800"), "de");
  assert.equal(select("fr;q=0.9, cs"), "cs");
  assert.equal(select(" en-US ; Q = 1.000 , cs;q=0.9"), "en");
  assert.equal(select("cs;q=0, uk;q=0.2"), "uk");
});

test("malformed entries cannot win negotiation", () => {
  for (const header of [
    "cs;q=2",
    "cs;q=-1",
    "cs;q=NaN",
    "cs;q=0.1234",
    "cs;q=1.001",
    "cs;q=0.8;q=1",
    "cs;foo=1",
    "cs_XX",
    "cs;q=",
  ]) {
    assert.equal(preferredMotdLanguage(header), undefined, header);
    assert.equal(select(`${header}, fr;q=0.1`), "fr", header);
  }
});

test("explicit supported English beats geo fallback even behind unknown languages", () => {
  assert.equal(select("en"), "en");
  assert.equal(select("ru, en-GB;q=0.1"), "en");
  assert.equal(select("en;q=0.5, cs;q=0.8"), "cs");
});

test("unknown, absent, wildcard and zero-quality preferences use country then English", () => {
  const countries = {
    CZ: "cs",
    SK: "sk",
    PL: "pl",
    HU: "hu",
    DE: "de",
    UA: "uk",
    FR: "fr",
    US: "en",
  };
  for (const [country, locale] of Object.entries(countries)) {
    for (const header of [null, "", "ru-RU, es;q=0.8", "*", "en;q=0"]) {
      assert.equal(select(header, country), locale, `${header}/${country}`);
    }
  }
  assert.equal(
    selectHomeLocale({
      pathname: "/",
      userAgent: "Steam",
      acceptLanguage: "ru",
    }),
    "en",
  );
});

test("ordinary browsers, crawlers and explicit locale routes are not negotiated", () => {
  for (const ua of [
    null,
    "",
    "Mozilla/5.0 Chrome/140",
    "Googlebot",
    "Bingbot",
  ]) {
    assert.equal(select("cs", "SK", ua), "en");
  }
  for (const pathname of ["/cs/", "/fr/", "/maps", "/cs/maps/"]) {
    assert.equal(select("sk", "CZ", "Steam", pathname), undefined);
  }
});

test("home plumbing keeps root canonical and map locale, with cookie preference before SSR", () => {
  const home = readFileSync(
    new URL("../pages/index.astro", import.meta.url),
    "utf8",
  );
  assert.match(home, /country: Astro\.request\.cf\?\.country/);
  assert.match(home, /lang=\{locale\}/);
  assert.match(
    home,
    /canonicalPath=\{Astro\.url\.pathname === '\/' \? '\/' : undefined\}/,
  );
  assert.match(home, /<MapRatings compact unratedOnly locale=\{locale\}/);
  assert.match(home, /cookieLocale: cookies.get\('lamateam-language'\)/);
  assert.doesNotMatch(home, /localStorage\.getItem|Accept-Language': 'en'/);
});

test("hero preserves descriptive copy and background while keeping welcome, CTA and profile display", () => {
  const home = readFileSync(
    new URL("../pages/index.astro", import.meta.url),
    "utf8",
  );
  assert.match(home, /\.home-hero\s*\{[^}]*background: none;/s);
  assert.ok(home.includes("Welcome to LaMaTeAm."));
  assert.ok(
    home.includes(
      "Back for another round? Classic maps, fair play and a place to reconnect.",
    ),
  );
  assert.ok(
    home.includes(
      "LaMaTeAm is a CZ/SK Counter-Strike: Source community on a European server. Join us for classic maps every evening.",
    ),
  );
  assert.ok(home.includes("Connect to the server"));
  assert.ok(home.includes("src={avatar}"));
  assert.ok(home.includes("{displayName}"));
  assert.ok(home.includes("fetch('/api/stats/me'"));
  assert.ok(!home.includes("fetchSteamAvatar"));
});

function clientFixture({
  saved = "EN",
  lang = "cs",
  pathname = "/",
  userAgent = "Steam",
  storageThrows = false,
} = {}) {
  const home = readFileSync(
    new URL("../components/LocalizedMarkup.astro", import.meta.url),
    "utf8",
  );
  const source = [...home.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .at(-1)[1]
    .replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, "");
  const handlers = new Map();
  const navigations = [];
  const requests = [];
  const preferences = [];
  const document = {
    documentElement: { lang },
    addEventListener: (name, callback) => handlers.set(name, callback),
  };
  const parsed = { querySelectorAll: () => [] };
  vm.runInNewContext(stripTypeScriptTypes(source), {
    document,
    navigator: { userAgent },
    location: {
      origin: "https://lamateam.eu",
      protocol: "https:",
      pathname,
      search: "?communityid=123&name=Guest",
      hash: "#maps",
    },
    localStorage: {
      getItem: () => {
        if (storageThrows) throw new Error("disabled");
        return preferences.at(-1) ?? saved;
      },
      setItem: (_key, value) => {
        if (storageThrows) throw new Error("disabled");
        preferences.push(value);
      },
    },
    isGameUserAgent: (ua) => /steam|valve/i.test(ua),
    allLocales: ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"],
    localePath: (locale) => (locale === "en" ? "/" : `/${locale}/`),
    navigate: (...args) => navigations.push(args),
    fetch: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        headers: { get: () => "text/html" },
        text: async () => '<html lang="en"></html>',
      };
    },
    DOMParser: class {
      parseFromString() {
        return parsed;
      }
    },
  });
  return { handlers, navigations, requests, parsed, document, preferences };
}

test("fresh root selector and shortcut choices replace stale stored preference before navigation", () => {
  const fixture = clientFixture({ saved: "FR" });
  fixture.handlers.get("change")({ target: { id: "language", value: "EN" } });
  assert.match(fixture.document.cookie, /lamateam-language=en;/);
  fixture.handlers.get("click")({
    button: 0,
    target: { closest: () => ({ dataset: { languageShortcut: "SK" } }) },
  });
  assert.match(fixture.document.cookie, /lamateam-language=sk;/);
  for (const options of [{ userAgent: "Mozilla" }]) {
    const other = clientFixture(options);
    other.handlers.get("change")({ target: { id: "language", value: "EN" } });
    assert.equal(other.preferences.length, 0);
  }
});

test("legacy storage mismatch never navigates or fetches another page", () => {
  for (const saved of ["FR", "EN", "RU"]) {
    const fixture = clientFixture({ saved });
    fixture.handlers.get("astro:page-load")?.();
    assert.equal(fixture.navigations.length, 0);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.document.documentElement.lang, "cs");
  }
});

test("explicit game choice writes same-site cookie even when localStorage is disabled", () => {
  const fixture = clientFixture({ storageThrows: true });
  fixture.handlers.get("change")({ target: { id: "language", value: "EN" } });
  assert.match(
    fixture.document.cookie,
    /lamateam-language=en; Path=\/; Max-Age=31536000; SameSite=Lax; Secure/,
  );
  assert.equal(fixture.navigations.length, 0);
});

test(
  "MOTD root renders negotiated HTML and map copy without redirects",
  { skip: !process.env.SSR_BASE_URL },
  async () => {
    for (const [userAgent, acceptLanguage, locale] of [
      ["Valve Steam Client", "cs-CZ, en;q=0.5", "cs"],
      ["Steam", "fr;q=0.3, pl;q=0.9", "pl"],
      ["Steam", "hu-HU", "hu"],
      ["Steam", "de-DE", "de"],
      ["Steam", "uk-UA", "uk"],
      ["Steam", "fr-FR", "fr"],
      ["Steam", "sk-SK", "sk"],
      ["Steam", "ru, en-GB;q=0.1", "en"],
      ["Mozilla/5.0", "cs", "en"],
      ["Googlebot", "sk", "en"],
    ]) {
      const response = await fetch(new URL("/", process.env.SSR_BASE_URL), {
        headers: { "User-Agent": userAgent, "Accept-Language": acceptLanguage },
        redirect: "manual",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("location"), null);
      const html = await response.text();
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`));
      assert.match(html, new RegExp(`data-locale="${locale}"`));
      assert.match(html, /<\/body>\s*<\/html>/);
      let mapCopy;
      const text = [];
      function walk(node) {
        if (node.nodeName === "#text") text.push(node.value);
        if (
          node.attrs?.some(
            (attr) => attr.name === "id" && attr.value === "map-ratings-root",
          )
        ) {
          mapCopy = JSON.parse(
            node.attrs.find((attr) => attr.name === "data-copy").value,
          );
        }
        for (const child of node.childNodes ?? []) walk(child);
      }
      walk(parse(html));
      assert.ok(
        text.some(
          (value) =>
            value.trim() === translator(locale)("Welcome to LaMaTeAm."),
        ),
        locale,
      );
      assert.ok(
        text.some((value) =>
          value.includes(
            translator(locale)(
              "LaMaTeAm is a CZ/SK Counter-Strike: Source community on a European server. Join us for classic maps every evening.",
            ).split(". ")[0] + ".",
          ),
        ),
        locale,
      );
      assert.equal(mapCopy.Rate, translator(locale)("Rate"));
      assert.match(html, /rel="canonical" href="https:\/\/lamateam\.eu\/"/);
      assert.match(
        html,
        /hreflang="x-default" href="https:\/\/lamateam\.eu\/"/,
      );
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  },
);
