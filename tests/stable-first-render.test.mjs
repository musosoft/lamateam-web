import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectHomeLocale } from "../src/lib/motd-locale.ts";
import { issueSteamSession } from "../src/lib/steam-session.ts";
const source = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("explicit MOTD cookie is available to first-response locale selection only on root/game requests", () => {
  const options = {
    pathname: "/",
    userAgent: "Steam",
    acceptLanguage: "cs",
    cookieLocale: "en",
  };
  assert.equal(selectHomeLocale(options), "en");
  assert.equal(selectHomeLocale({ ...options, cookieLocale: "fr" }), "fr");
  assert.equal(selectHomeLocale({ ...options, cookieLocale: "invalid" }), "cs");
  assert.equal(selectHomeLocale({ ...options, pathname: "/sk/" }), undefined);
  assert.equal(
    selectHomeLocale({ ...options, userAgent: "Mozilla", cookieLocale: "fr" }),
    "en",
  );
});
test("MOTD never reconciles storage through a second navigation or custom page loader", () => {
  const home = source("pages/index.astro");
  assert.doesNotMatch(
    home,
    /savedMotdLanguage|attemptedPreference|preparation\.loader|void navigate/,
  );
  assert.match(
    source("components/LocalizedMarkup.astro"),
    /document\.cookie\s*=/,
  );
  assert.match(source("components/LocalizedMarkup.astro"), /SameSite=Lax/);
});
test("ratings initialization retains server preview and guards duplicate lifecycle execution", () => {
  const ratings = source("components/MapRatings.astro");
  assert.match(ratings, /activeRatingsRoot === root/);
  assert.doesNotMatch(ratings, /if \(!unratedOnly\) chooseRandomMap\(\)/);
  assert.match(ratings, /data-initial-map/);
});
test("SSR auth uses verified identity and never awaits an external avatar", () => {
  for (const path of [
    "layouts/Layout.astro",
    "components/LiveChat.astro",
    "pages/index.astro",
  ])
    assert.match(source(path), /Astro\.locals\.steamProfile/);
  assert.doesNotMatch(
    source("components/LiveChat.astro"),
    /fetchSteamAvatar|api\.steampowered\.com/,
  );
});

test(
  "local Worker first HTML and real browser stay stable through both Astro init opportunities",
  {
    skip: !process.env.STABLE_RENDER_URL || !process.env.PLAYWRIGHT_MODULE,
    timeout: 90000,
  },
  async () => {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const base = process.env.STABLE_RENDER_URL;
    const id = "76561198000000001";
    const secret = "stable-render-offline-test-key";
    const display = encodeURIComponent(
      JSON.stringify({
        steamID: id,
        playerName: "Signed Player",
        playerAvatar: "https://avatars.steamstatic.com/cached.jpg",
      }),
    );
    try {
      for (const [token, authenticated] of [
        ["", false],
        ["forged", false],
        [await issueSteamSession(id, "wrong-key"), false],
        [await issueSteamSession(id, secret), true],
      ]) {
        const response = await fetch(
          `${base}/?communityid=76561198000000002&name=UntrustedQuery`,
          {
            headers: {
              "User-Agent": "Valve Steam Client",
              "Accept-Language": "cs",
              Cookie: `session=${display}; steam_auth=${token}; lamateam-language=en`,
            },
          },
        );
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /<html[^>]*lang="en"/);
        assert.match(html, new RegExp(`data-authenticated="${authenticated}"`));
        assert.equal(html.includes("Signed Player"), authenticated);
        assert.doesNotMatch(html, />UntrustedQuery</);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.match(html, /data-initial-map=/);
      }
      const context = await browser.newContext({
        userAgent: "Valve Steam Client",
        locale: "cs-CZ",
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("lamateam-language", "FR"),
      );
      const maps = [
        ...new Map(
          JSON.parse(source("data/maps.generated.json")).items
            .filter((item) => item.map !== "min_players")
            .map((item) => [item.map, item]),
        ).values(),
      ];
      let requests = 0;
      let invalidRatings = false;
      const apiRequests = new Map();
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        apiRequests.set(path, (apiRequests.get(path) || 0) + 1);
        if (path === "/api/map-ratings") {
          requests++;
          return route.fulfill({
            json: {
              authenticated: false,
              canRate: false,
              ratings: invalidRatings
                ? []
                : maps.map((item) => ({
                    map: item.map,
                    count: 0,
                    average: null,
                    userRating: null,
                  })),
            },
          });
        }
        return route.fulfill({
          status: path === "/api/stats/me" ? 401 : 200,
          json: { available: false },
        });
      });
      await page.route(/^https:\/\//, (route) => route.abort());
      const response = await page.goto(
        base + "/?communityid=76561198000000002&name=UntrustedQuery",
      );
      const html = await response.text();
      const initial = html.match(/data-initial-map="([^"]+)"/)[1];
      await page.waitForFunction(
        () => document.querySelector("#map-ratings-status")?.textContent === "",
      );
      await page.waitForTimeout(1200);
      const snapshot = () =>
        page.evaluate(() => ({
          lang: document.documentElement.lang,
          map: document.querySelector("#random-map-preview [data-map-rating]")
            ?.dataset.mapRating,
          title: document.querySelector("#random-map-title")?.textContent,
          sections: document.querySelectorAll("#map-ratings-root").length,
          previews: document.querySelectorAll(
            "#random-map-preview > [data-map-rating]",
          ).length,
          accounts: document.querySelectorAll("#live-chat-shell").length,
        }));
      const first = await snapshot();
      assert.equal(first.map, initial);
      assert.ok(first.title.includes(initial));
      assert.equal(first.lang, "cs");
      assert.equal(first.sections, 1);
      assert.equal(first.previews, 1);
      assert.equal(first.accounts, 1);
      assert.equal(requests, 1);
      assert.equal(apiRequests.get("/api/stats/me"), 1);
      assert.equal(apiRequests.get("/api/stats/motd"), 1);
      assert.equal(apiRequests.has("/api/steamUser"), false);
      await page.evaluate(() =>
        document.dispatchEvent(new Event("astro:page-load")),
      );
      await page.waitForTimeout(200);
      assert.deepEqual(await snapshot(), first);
      assert.equal(requests, 1);
      invalidRatings = true;
      await page.evaluate(() => {
        document.dispatchEvent(new Event("astro:before-swap"));
        document.dispatchEvent(new Event("astro:page-load"));
      });
      await page.waitForTimeout(200);
      assert.deepEqual(await snapshot(), first);
      assert.equal(requests, 2);
      assert.equal(
        await page
          .locator("#random-map-preview fieldset")
          .evaluate((fieldset) => fieldset.disabled),
        true,
      );
      await page.evaluate(() =>
        document.dispatchEvent(new Event("astro:page-load")),
      );
      assert.equal(requests, 2);
      assert.equal(
        page.url(),
        base + "/?communityid=76561198000000002&name=UntrustedQuery",
      );
      // An explicit English choice on the same root must work on its first
      // response too, without a custom Accept-Language page loader.
      invalidRatings = false;
      await page.selectOption("#language", "EN", { force: true });
      await page.waitForFunction(() => document.documentElement.lang === "en");
      assert.equal(
        (await context.cookies()).find(
          (cookie) => cookie.name === "lamateam-language",
        )?.value,
        "en",
      );
      const firstEnglish = await context.request.get(base + "/", {
        headers: { "Accept-Language": "cs" },
      });
      assert.match(await firstEnglish.text(), /<html[^>]*lang="en"/);
      assert.deepEqual(pageErrors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  },
);
