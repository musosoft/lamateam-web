import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("./MapRatings.astro");
const home = read("../pages/index.astro");
const locales = ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"];

test("ratings intro keeps anonymous copy in MOTD and Steam instructions only on the web", () => {
  const intro = component.slice(
    component.indexOf('<div class="map-ratings-intro"'),
    component.indexOf("<div class:list={['ratings-notice"),
  );
  assert.match(intro, /\{t\('LaMaTeAm CS:S map ratings are anonymous\.'\)\}/);
  assert.match(
    intro,
    /!motdPrompt && \(\s*<span>\s*\{t\('Sign in with Steam to rate a map or update your rating\.'\)\}\s*<\/span>\s*\)/,
  );
  for (const locale of locales) {
    const copy = JSON.parse(read(`../lib/i18n/${locale}.json`));
    assert.ok(
      copy["LaMaTeAm CS:S map ratings are anonymous."].includes(
        "LaMaTeAm CS:S",
      ),
      locale,
    );
    assert.ok(
      copy["Sign in with Steam to rate a map or update your rating."].includes(
        "Steam",
      ),
      locale,
    );
    const description =
      copy[
        "Explore the LaMaTeAm CS:S map collection, view community ratings and rate your favorite Counter-Strike: Source maps."
      ];
    assert.ok(description.includes("LaMaTeAm CS:S"), locale);
    assert.ok(description.includes("Counter-Strike: Source"), locale);
    assert.equal(
      copy[
        "Community ratings are anonymous. Sign in with Steam to set or update your own rating."
      ],
      undefined,
      locale,
    );
  }
});

test("every public HLstatsX snapshot label omits the unverified-player suffix", () => {
  const titles = home.slice(
    home.indexOf("const publicTitles ="),
    home.indexOf("const render =", home.indexOf("const publicTitles =")),
  );
  for (const locale of locales) {
    assert.ok(titles.includes(`${locale}: 'HLSTATSX SNAPSHOT'`), locale);
  }
});

test("all selected-card prompts follow the map while only the game opts into MOTD identity", () => {
  assert.match(
    home,
    /isGame && \([\s\S]*?<MapRatings\s+compact\s+motdPrompt\s+locale=\{locale\}/,
  );
  assert.equal(
    (home.match(/<MapRatings\s+compact\s+motdPrompt/g) || []).length,
    1,
  );
  assert.ok(
    home.includes("<MapRatings compact unratedOnly locale={locale} />"),
  );
  assert.match(component, /motdPrompt = false/);
  assert.match(component, /\{t\('Loading a map…'\)\}/);
  assert.match(
    component,
    /id="random-map-title" translate="no" data-no-translate/,
  );
  assert.match(component, /root\?\.hasAttribute\('data-motd-map-prompt'\)/);
  assert.match(component, /const map = card\.dataset\.mapRating!/);
  assert.match(
    component,
    /randomPreview\.replaceChildren\(card\);\s+if \(randomTitle\)\s+randomTitle\.textContent = tc\('Know \{map\}\? Rate it\.', \{ map \}\);/,
  );
  assert.match(
    component,
    /randomSkip\?\.addEventListener\('click', chooseRandomMap/,
  );
  assert.match(
    component,
    /advanceTimer = window\.setTimeout\([\s\S]*?chooseRandomMap\(\)/,
  );
  assert.match(component, /hidden=\{!compact \|\| mapCards\.length === 0\}/);
  assert.match(
    component,
    /<p role="status">\{t\('Could not load the maps\.'\)\}<\/p>/,
  );
});

test("every supported locale supplies a prompt with an unchanged map placeholder", () => {
  for (const locale of locales) {
    const copy = JSON.parse(read(`../lib/i18n/${locale}.json`));
    assert.equal(copy["Know {map}? Rate it."].split("{map}").length, 2, locale);
  }
});

test(
  "selected-card web and MOTD headings follow initial selection, skip and saved-rating advance",
  {
    skip: !process.env.LAMATEAM_UI_URL,
    timeout: 120_000,
  },
  async () => {
    const { chromium } = await import(
      process.env.LAMATEAM_PLAYWRIGHT_MODULE || "playwright"
    );
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_BIN
        ? { executablePath: process.env.CHROMIUM_BIN }
        : {}),
    });
    const maps = JSON.parse(read("../data/maps.generated.json")).items.filter(
      ({ map }) => map !== "min_players",
    );
    const rating = (map, stars = null) => ({
      map,
      average: stars,
      count: stars ? 1 : 0,
      userRating: stars,
      canRate: true,
    });
    try {
      for (const userAgent of ["Valve Client", "Mozilla/5.0 Chromium"]) {
        const context = await browser.newContext({
          userAgent,
          viewport: { width: 700, height: 400 },
        });
        const page = await context.newPage();
        const authenticated = userAgent !== "Valve Client";
        await page.route("**/api/map-ratings*", (route) => {
          const request = route.request();
          const query = new URL(request.url()).searchParams;
          assert.equal(
            query.get("communityid"),
            authenticated ? null : "76561197960265729",
          );
          assert.equal(query.has("name"), false);
          if (request.method() === "POST") {
            assert.deepEqual(Object.keys(request.postDataJSON()).sort(), [
              "map",
              "stars",
            ]);
            const { map, stars } = request.postDataJSON();
            return route.fulfill({
              json: { ...rating(map, stars), authenticated },
            });
          }
          return route.fulfill({
            json: {
              authenticated,
              canRate: true,
              ratings: maps.map(({ map }) => rating(map)),
            },
          });
        });
        for (const locale of locales) {
          const copy = JSON.parse(read(`../lib/i18n/${locale}.json`));
          await page.goto(
            `${process.env.LAMATEAM_UI_URL}${locale === "en" ? "/" : `/${locale}/`}?mapname=UNTRUSTED_QUERY_MAP&communityid=76561197960265729`,
          );
          const current = () =>
            page
              .locator("#random-map-preview [data-map-rating]")
              .getAttribute("data-map-rating");
          const check = async () => {
            const map = await current();
            assert.ok(map && map !== "UNTRUSTED_QUERY_MAP");
            assert.equal(
              await page
                .locator("#random-map-preview .map-name")
                .textContent()
                .then((text) => text.trim()),
              map,
            );
            assert.equal(
              await page
                .locator("#random-map-title")
                .textContent()
                .then((text) => text.trim()),
              copy["Know {map}? Rate it."].replace("{map}", map),
            );
            assert.equal(
              await page.locator("#random-map-preview .map-name").isVisible(),
              false,
            );
            return map;
          };
          await page.locator("#random-map-preview [data-map-rating]").waitFor();
          const initial = await check();
          await page.locator("#random-map-skip").click();
          assert.notEqual(await check(), initial);
          await page.waitForFunction(
            () =>
              !document.querySelector("#random-map-preview fieldset").disabled,
          );
          assert.equal(
            await page
              .locator("#random-map-preview [data-rating-sign-in]")
              .isVisible(),
            false,
          );
          const beforeRating = await current();
          await page.locator('#random-map-preview input[value="4"]').check();
          await page.waitForFunction(
            (previous) =>
              document.querySelector("#random-map-preview [data-map-rating]")
                ?.dataset.mapRating !== previous,
            beforeRating,
          );
          await check();
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
