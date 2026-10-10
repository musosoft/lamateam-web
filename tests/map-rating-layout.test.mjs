import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/MapRatings.astro", import.meta.url),
  "utf8",
);
const markup = source.slice(0, source.indexOf("<style>"));
const styles = source.slice(
  source.indexOf("<style>"),
  source.indexOf("<script>"),
);

test("sign-in and personal rating share a left-aligned group before the stars", () => {
  assert.match(
    markup,
    /<form class="map-rating-form"[^>]*>\s*<div class="rating-details">[\s\S]*?data-rating-sign-in[\s\S]*?data-rating-summary[\s\S]*?<fieldset disabled>/,
  );
  assert.equal(markup.match(/data-rating-summary/g)?.length, 1);
  assert.equal(markup.match(/data-rating-sign-in/g)?.length, 1);
  assert.match(styles, /\.rating-details\s*\{[^}]*text-align: left;/);
});

test("anonymous cards show only the Steam rating prompt; signed-in summaries remain", () => {
  assert.match(markup, /\{t\('Sign in with Steam to rate\.'\)\}/);
  const renderSource = source
    .match(
      /const render = \(card: HTMLElement, rating: Rating\) => \{([\s\S]*?)\n    \};/,
    )[1]
    .replaceAll(/<HTMLElement>|<HTMLInputElement>/g, "")
    .replaceAll(")!", ")")
    .replaceAll("textContent!", "textContent");
  const summary = {};
  const card = {
    querySelector: (selector) =>
      selector === "[data-rating-summary]"
        ? summary
        : selector === ".random-community-rating"
          ? null
          : {},
    querySelectorAll: () => [],
  };
  const render = new Function(
    "card",
    "rating",
    "tc",
    "showStars",
    "controls",
    renderSource,
  );
  const tc = (key, params) =>
    params ? key.replace("{rating}", params.rating) : key;
  const rating = {
    authenticated: false,
    userRating: null,
    count: 0,
    average: null,
  };
  render(
    card,
    rating,
    tc,
    () => {},
    () => {},
  );
  assert.equal(summary.hidden, true);
  render(
    card,
    { ...rating, authenticated: true },
    tc,
    () => {},
    () => {},
  );
  assert.equal(summary.hidden, false);
  assert.equal(summary.textContent, "Your rating · Not rated yet.");
  render(
    card,
    { ...rating, authenticated: true, userRating: 4 },
    tc,
    () => {},
    () => {},
  );
  assert.equal(summary.hidden, false);
  assert.equal(summary.textContent, "Your rating · 4 / 5");
});

test("home picker occupies the desktop hero's right track above the sidebar", () => {
  const home = readFileSync(
    new URL("../src/pages/index.astro", import.meta.url),
    "utf8",
  );
  assert.match(
    home,
    /class="home-map-rating"[\s\S]*?<MapRatings compact unratedOnly/,
  );
  const desktop = home.slice(home.indexOf("@media (min-width: 1000px) {"));
  assert.match(desktop, /\.home-map-rating\s*\{\s*grid-area: rating;/);
  assert.match(
    desktop,
    /:global\(body:not\(\.is-game\)\) \.community-grid\s*\{\s*grid-template-areas: 'main rating' 'main side';\s*grid-template-rows: auto 1fr;/,
  );
  assert.match(desktop, /\.community-main\s*\{\s*grid-area: main;/);
  assert.match(desktop, /\.community-side\s*\{\s*grid-area: side;/);
  assert.ok(
    home.indexOf('class="home-map-rating"') <
      home.indexOf('class="community-main"'),
  );
  assert.match(styles, /container: rating-content \/ inline-size;/);
  assert.match(
    styles,
    /:global\(\.map-rating-form\)\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/,
  );
  assert.match(
    styles,
    /:global\(#random-map-skip\)\s*\{[^}]*white-space: nowrap;/,
  );
  assert.match(
    styles,
    /:global\(\.rating-overview\)\s*\{[^}]*flex-direction: column;[^}]*flex-wrap: nowrap;[^}]*align-items: center;[^}]*gap: 0;/,
  );
  assert.match(
    styles,
    /:global\(\.rating-details\)\s*\{[^}]*display: contents;/,
  );
  assert.match(
    styles,
    /:global\(\.rating-count\)\s*\{[^}]*white-space: nowrap;/,
  );
  assert.doesNotMatch(styles, /:global\(#random-map-skip\)\s*\{[^}]*grid-row:/);
  assert.doesNotMatch(
    styles,
    /flex-direction: column;\s*align-items: flex-start;/,
  );
  assert.doesNotMatch(styles, /grid-template-columns: 280px minmax\(0, 1fr\);/);
  assert.match(styles, /:global\(\.random-community-rating\)/);
  assert.match(
    styles,
    /:global\(\.rated-map-card\)\s*\{[^}]*grid-template-rows: auto auto;/,
  );
  assert.match(
    styles,
    /:global\(\.map-thumbnail img\)\s*\{[^}]*position: absolute;[^}]*inset: 0;/,
  );
  assert.match(
    styles,
    /\.rating-star\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/,
  );
});

test("small viewports wrap the prompt as a full-width group without shrinking targets", () => {
  assert.match(
    styles,
    /\.map-ratings-compact:not\(\[data-motd-map-prompt\]\) :global\(\.rating-actions\),[\s\S]*?flex-basis: 100%;/,
  );
  assert.match(styles, /\.rating-sign-in\s*\{[^}]*min-height: 44px;/);
  assert.match(styles, /\.ratings-retry\s*\{[^}]*min-height: 44px;/);
});

test("catalog stars and count fit narrow desktop tracks without shrinking touch targets", () => {
  assert.match(
    styles,
    /\.map-card-content\s*\{[^}]*container: rating-content \/ inline-size;/,
  );
  assert.match(
    styles,
    /@container rating-content \(min-width: 14rem\)\s*\{\s*@media \(min-width: 751px\) and \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.rating-stars\s*\{\s*gap: 0;\s*\}\s*\.rating-star\s*\{\s*min-width: 28px;/,
  );
});

test("compact row preserves the fieldset name and five accessible star targets", () => {
  assert.match(
    markup,
    /<legend class="sr-only">[\s\S]*?\{t\('Rate'\)\}[\s\S]*?\{map.name\}[\s\S]*?data-community-summary/,
  );
  assert.match(markup, /\{\[1, 2, 3, 4, 5\]\.map\(\(stars\) =>/);
  assert.match(
    markup,
    /type="radio"\s+name="stars"\s+value=\{stars\}\s+required/,
  );
  assert.match(
    markup,
    /<span class="sr-only">\s*\{t\('\{count\} stars'\)\.replace\('\{count\}', String\(stars\)\)\}/,
  );
  assert.match(styles, /:global\(\.rating-star\)\s*\{\s*min-width: 44px;/);
  assert.match(
    styles,
    /:global\(\.rating-feedback:empty\)\s*\{\s*display: none;/,
  );
});

test("gallery does not reserve an empty feedback row but keeps live feedback semantics", () => {
  assert.match(styles, /\.rating-feedback:empty\s*\{\s*margin: 0;/);
  assert.match(
    markup,
    /data-rating-feedback\s+role="status"\s+aria-live="polite"/,
  );
  assert.match(markup, /<legend class="sr-only">/);
  assert.match(markup, /href="\/api\/auth\/steam"\s+data-astro-reload/);
});

// Isolated browser only. PLAYWRIGHT_MODULE may point at a locally installed
// Playwright module; no dependency installation or signed-in profile needed.
test(
  "rendered / picker separates the 4:3 image from aligned responsive rating controls",
  {
    skip: !process.env.LAMATEAM_UI_URL,
    timeout: 300_000,
  },
  async () => {
    const { chromium } = await import(
      process.env.PLAYWRIGHT_MODULE || "playwright"
    );
    const maps = JSON.parse(
      readFileSync(new URL("../src/data/maps.generated.json", import.meta.url)),
    ).items.filter((item) => item.map !== "min_players");
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const artifacts =
      process.env.LAMATEAM_UI_ARTIFACTS ||
      "/tmp/opencode/map-ratings-responsive";
    mkdirSync(artifacts, { recursive: true });
    const measurements = [];
    try {
      for (const width of [1920, 1440, 1280, 1000, 999, 768, 390, 320]) {
        for (const authenticated of [false, true]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            isMobile: width < 1000,
            hasTouch: width < 1000,
          });
          try {
            const page = await context.newPage();
            await page.addInitScript(() => {
              Math.random = () => 0;
            });
            await page.route(/^https:\/\//, (route) => route.abort());
            // Use actual map artwork while avoiding local Cloudflare image-service
            // availability. The component still owns the rendered 4:3 crop.
            await page.route("**/_image?**", (route) => {
              const href = new URL(route.request().url()).searchParams.get(
                "href",
              );
              const filename = basename(href.split("?")[0]);
              return route.fulfill({
                contentType: "image/jpeg",
                body: readFileSync(
                  new URL(
                    `../public/assets/map-cache/${filename}`,
                    import.meta.url,
                  ),
                ),
              });
            });
            await page.route("**/api/server-status", (route) =>
              route.fulfill({ json: { online: false } }),
            );
            await page.route("**/api/map-ratings", (route) => {
              if (route.request().method() === "POST") {
                const { map, stars } = route.request().postDataJSON();
                return route.fulfill({
                  json: {
                    map,
                    average: 4.2,
                    count: 124,
                    userRating: stars,
                    authenticated: true,
                    canRate: true,
                  },
                });
              }
              return route.fulfill({
                json: {
                  authenticated,
                  canRate: authenticated,
                  ratings: maps.map((item) => ({
                    map: item.map,
                    average: 4.2,
                    count: 123,
                    userRating: null,
                  })),
                },
              });
            });
            await page.goto(new URL("/", process.env.LAMATEAM_UI_URL).href, {
              waitUntil: "domcontentloaded",
              timeout: 90_000,
            });
            await page.waitForFunction(
              () =>
                document.querySelector(
                  "#random-map-preview [data-rating-count]",
                )?.textContent === "123 ratings",
            );
            await page.evaluate(() => document.fonts.ready);
            const result = await page
              .locator(".random-map-widget")
              .evaluate((widget) => {
                const box = (element) => {
                  const r = element.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                };
                const find = (selector) => box(widget.querySelector(selector));
                return {
                  widget: box(widget),
                  preview: find(".map-thumbnail"),
                  image: find(".map-thumbnail img"),
                  content: find(".map-card-content"),
                  form: find("form"),
                  signIn: find("[data-rating-sign-in]"),
                  summary: find("[data-rating-summary]"),
                  label: find(".random-community-rating"),
                  stars: find(".rating-stars"),
                  count: find(".rating-count"),
                  skip: find("#random-map-skip"),
                  targets: [...widget.querySelectorAll(".rating-star")].map(
                    box,
                  ),
                  overflow: document.documentElement.scrollWidth > innerWidth,
                };
              });
            console.log(JSON.stringify({ width, ...result }));
            measurements.push({ width, authenticated, ...result });
            assert.equal(result.overflow, false, `${width}: page overflow`);
            const layout = await page.evaluate(() => {
              const box = (selector) => {
                const r = document
                  .querySelector(selector)
                  .getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  right: r.right,
                  bottom: r.bottom,
                  width: r.width,
                };
              };
              return {
                picker: box(".home-map-rating"),
                hero: box(".home-hero"),
                main: box(".community-main"),
                side: box(".community-side"),
              };
            });
            if (width >= 1000) {
              assert.ok(
                layout.picker.x >= layout.main.right,
                `${width}: picker right of hero`,
              );
              assert.ok(
                Math.abs(layout.picker.y - layout.hero.y) < 1,
                `${width}: picker aligned with hero top`,
              );
              assert.ok(
                Math.abs(layout.picker.x - layout.side.x) < 1,
                `${width}: picker aligned with sidebar`,
              );
              assert.ok(
                Math.abs(layout.picker.width - layout.side.width) < 1,
                `${width}: same sidebar track`,
              );
              assert.ok(
                layout.side.y >= layout.picker.bottom,
                `${width}: sidebar below picker`,
              );
            } else {
              assert.ok(
                layout.main.y >= layout.picker.bottom,
                `${width}: narrow picker still before hero`,
              );
              assert.ok(
                layout.side.y >= layout.main.bottom,
                `${width}: narrow sidebar still after main`,
              );
            }
            assert.ok(
              Math.abs(result.preview.width / result.preview.height - 4 / 3) <
                0.01,
            );
            for (const control of [
              result.form,
              result.content,
              result.stars,
              result.count,
              result.skip,
            ]) {
              assert.ok(
                control.y >= result.preview.y + result.preview.height - 1,
                `${width}: control must be below the image crop`,
              );
              assert.ok(
                control.y >= result.image.y + result.image.height - 1,
                `${width}: control must not overlap the image itself`,
              );
            }
            assert.ok(result.skip.height >= 44);
            for (const group of [
              result.label,
              result.stars,
              result.count,
              result.skip,
            ]) {
              assert.ok(
                group.x >= result.form.x - 1 &&
                  group.x + group.width <=
                    result.form.x + result.form.width + 1,
                `${width}: group fits its controls row`,
              );
            }
            assert.ok(
              result.count.y >= result.stars.y + result.stars.height - 1,
            );
            assert.ok(
              result.count.x >= result.stars.x &&
                result.count.x + result.count.width <=
                  result.stars.x + result.stars.width + 1,
            );
            assert.ok(
              result.targets.every(
                (target) => target.width >= 44 && target.height >= 44,
              ),
            );
            {
              const first = authenticated ? result.summary : result.signIn;
              assert.ok(result.label.y >= first.y + first.height);
              assert.ok(result.stars.y >= result.label.y + result.label.height);
              assert.ok(Math.abs(result.label.x - first.x) < 1);
              assert.ok(Math.abs(result.stars.x - first.x) < 1);
              assert.ok(result.skip.y >= result.stars.y);
            }
            const widget = page.locator(".random-map-widget");
            assert.equal(
              await widget
                .getByRole("link", {
                  name: "Sign in with Steam to rate.",
                  exact: true,
                })
                .count(),
              authenticated ? 0 : 1,
            );
            assert.equal(await widget.getByRole("radio").count(), 5);
            for (let stars = 1; stars <= 5; stars++) {
              const radio = widget.getByRole("radio", {
                name: `${stars} stars`,
                exact: true,
              });
              assert.equal(await radio.count(), 1);
              assert.equal(await radio.isEnabled(), authenticated);
            }
            const previousMap = await widget
              .locator("[data-map-rating]")
              .getAttribute("data-map-rating");
            assert.equal(
              await widget.locator(".random-community-rating").textContent(),
              `Rate ${previousMap} · Community rating · 4.2 / 5`,
            );
            await widget.locator("img").evaluate((img) => img.decode());
            const suffix = `${width}-${authenticated ? "signed-in" : "anonymous"}`;
            await page.screenshot({
              path: join(artifacts, `homepage-${suffix}.png`),
              animations: "disabled",
            });
            await widget.screenshot({
              path: join(artifacts, `picker-${suffix}.png`),
              animations: "disabled",
            });
            await widget
              .getByRole("button", { name: "Never played", exact: true })
              .click();
            assert.notEqual(
              await widget
                .locator("[data-map-rating]")
                .getAttribute("data-map-rating"),
              previousMap,
            );
            const afterSkip = await widget.evaluate((w) => {
              const image = w
                .querySelector(".map-thumbnail img")
                .getBoundingClientRect();
              const form = w.querySelector("form").getBoundingClientRect();
              return {
                imageBottom: image.bottom,
                controlsTop: form.top,
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            });
            assert.ok(afterSkip.controlsTop >= afterSkip.imageBottom);
            assert.equal(afterSkip.overflow, false);
            if (authenticated) {
              // A label click exercises the real 44px target; POST stays mocked.
              await widget.locator('[data-star="5"]').click();
              await page.waitForFunction(() =>
                document
                  .querySelector("#random-map-preview [data-rating-feedback]")
                  ?.textContent.includes("Thanks for rating!"),
              );
            }
          } finally {
            await context.close();
          }
        }
      }
      writeFileSync(
        join(artifacts, "measurements.json"),
        JSON.stringify(measurements, null, 2),
      );
    } finally {
      await browser.close();
    }
  },
);
