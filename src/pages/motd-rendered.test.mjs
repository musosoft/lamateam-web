import assert from "node:assert/strict";
import test from "node:test";

test(
  "shared chat collapses and reopens on home, rules and maps with circular controls",
  { skip: !process.env.LAMATEAM_UI_URL, timeout: 120_000 },
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
    try {
      for (const userAgent of ["Valve Client", "Mozilla/5.0 Chromium"]) {
        const context = await browser.newContext({
          userAgent,
          locale: "en-US",
        });
        const page = await context.newPage();
        const circle = async (selector) => {
          const result = await page.locator(selector).evaluate((button) => {
            const { width, height } = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
              width,
              height,
              aspectRatio: style.aspectRatio,
              radius: style.borderRadius,
              align: style.alignItems,
              justify: style.justifyContent,
            };
          });
          assert.ok(Math.abs(result.width - result.height) < 0.01);
          assert.ok(result.width >= 44);
          assert.equal(result.aspectRatio, "1 / 1");
          assert.equal(result.radius, "50%");
          assert.equal(result.align, "center");
          assert.equal(result.justify, "center");
        };
        const mainWidth = () =>
          page
            .locator("main")
            .evaluate((main) => main.getBoundingClientRect().width);
        for (const width of [390, 700, 1920, 3840]) {
          await page.setViewportSize({
            width,
            height: width === 700 ? 400 : 1080,
          });
          for (const route of ["/", "/rules", "/maps"]) {
            await page.goto(`${process.env.LAMATEAM_UI_URL}${route}`);
            // Web chat starts closed; MOTD chat starts open.
            if (await page.locator(".chat-launcher").isVisible())
              await page.locator(".chat-launcher").click();
            await page
              .locator("#live-chat-panel")
              .waitFor({ state: "visible" });
            await circle(".chat-close");
            const openWidth = await mainWidth();
            const openHeight = await page
              .locator("main")
              .evaluate((main) => main.getBoundingClientRect().height);
            const openColumns = await page
              .locator("body")
              .evaluate((body) => getComputedStyle(body).gridTemplateColumns);
            await page.locator(".chat-close").click();
            await page.locator("#live-chat-panel").waitFor({ state: "hidden" });
            await circle(".chat-launcher");
            const closedWidth = await mainWidth();
            if (userAgent === "Valve Client") {
              assert.ok(
                Math.abs(closedWidth - width) <= 1,
                `${route} at ${width}: ${closedWidth}`,
              );
              if (width <= 480) {
                assert.equal(openWidth, closedWidth);
                assert.ok(
                  (await page
                    .locator("main")
                    .evaluate((main) => main.getBoundingClientRect().height)) >
                    openHeight,
                  `${route} must reclaim chat row`,
                );
              } else {
                assert.ok(
                  closedWidth > openWidth,
                  `${route} must reclaim chat column`,
                );
              }
              assert.equal(
                await page
                  .locator("#live-chat-shell")
                  .evaluate((shell) => shell.getBoundingClientRect().width),
                0,
              );
            } else {
              assert.equal(
                closedWidth,
                openWidth,
                "web chat remains an overlay",
              );
            }
            await page.locator(".chat-launcher").click();
            await page
              .locator("#live-chat-panel")
              .waitFor({ state: "visible" });
            assert.equal(await mainWidth(), openWidth);
            assert.equal(
              await page
                .locator("body")
                .evaluate((body) => getComputedStyle(body).gridTemplateColumns),
              openColumns,
            );
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "Valve routes keep title/chat geometry and readable responsive maps with open and closed chat",
  { skip: !process.env.LAMATEAM_UI_URL, timeout: 120_000 },
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
    try {
      const context = await browser.newContext({
        userAgent: "Valve Client",
        locale: "en-US",
      });
      const page = await context.newPage();
      for (const width of [390, 700, 1920]) {
        await page.setViewportSize({
          width,
          height: width === 700 ? 400 : width === 390 ? 844 : 1080,
        });
        for (const open of [true, false]) {
          let baseline;
          for (const route of ["/", "/rules", "/maps", "/commands", "/stats"]) {
            await page.goto(`${process.env.LAMATEAM_UI_URL}${route}`);
            if (await page.locator(".chat-launcher").isVisible())
              await page.locator(".chat-launcher").click();
            await page
              .locator("#live-chat-panel")
              .waitFor({ state: "visible" });
            if (!open) await page.locator(".chat-close").click();
            const metrics = await page.evaluate(() => {
              const box = (selector) =>
                document
                  .querySelector(selector)
                  .getBoundingClientRect()
                  .toJSON();
              const main = document.querySelector("main");
              return {
                main: box("main"),
                title: box("main h1"),
                titleFont: getComputedStyle(document.querySelector("main h1"))
                  .fontSize,
                titleLineHeight: getComputedStyle(
                  document.querySelector("main h1"),
                ).lineHeight,
                nav: box(".community-nav"),
                chat: box("#live-chat-panel"),
                gutter: getComputedStyle(main).padding,
                overflow:
                  document.documentElement.scrollWidth > innerWidth ||
                  main.scrollWidth > main.clientWidth,
                placeholder:
                  document.querySelector("#messageInput").placeholder,
                helpRows: document.querySelectorAll("#chat-keyboard-notice")
                  .length,
                columns: document.querySelector("#rated-map-grid")
                  ? getComputedStyle(
                      document.querySelector("#rated-map-grid"),
                    ).gridTemplateColumns.split(" ").length
                  : null,
                mapOverflow: [
                  ...document.querySelectorAll(
                    "#rated-map-grid .rated-map-card",
                  ),
                ].some((card) => card.scrollWidth > card.clientWidth + 1),
              };
            });
            assert.equal(
              metrics.overflow,
              false,
              `${route} ${width} ${open}: overflow`,
            );
            assert.equal(metrics.placeholder, "Click Send to chat");
            assert.equal(metrics.helpRows, 0);
            const flags = page.locator(".header-language-options a");
            assert.equal(await flags.count(), 8);
            for (const flag of await flags.all()) {
              assert.equal(await flag.isVisible(), true);
              assert.ok(await flag.getAttribute("aria-label"));
              const box = await flag.boundingBox();
              assert.ok(box.width >= 44 && box.height >= 44);
              assert.ok(box.x >= 0 && box.x + box.width <= width);
            }
            if (!baseline) baseline = metrics;
            for (const part of ["main", "nav", ...(open ? ["chat"] : [])]) {
              for (const key of ["x", "y", "width", "height"])
                assert.ok(
                  Math.abs(metrics[part][key] - baseline[part][key]) < 1,
                  `${route} ${width} ${open}: ${part}.${key}`,
                );
            }
            for (const key of ["x", "y"])
              assert.ok(
                Math.abs(metrics.title[key] - baseline.title[key]) < 1,
                `${route} ${width} ${open}: title.${key}`,
              );
            assert.equal(metrics.titleFont, baseline.titleFont);
            assert.equal(metrics.titleLineHeight, baseline.titleLineHeight);
            assert.equal(metrics.gutter, baseline.gutter);
            if (route === "/maps") {
              assert.equal(metrics.mapOverflow, false);
              if (width === 390)
                assert.equal(
                  metrics.columns,
                  2,
                  `${width} ${open}: two map columns`,
                );
              else assert.ok(metrics.columns >= 2);
            }
            if (process.env.LAMATEAM_MOTD_SCREENSHOTS)
              await page.screenshot({
                path: `${process.env.LAMATEAM_MOTD_SCREENSHOTS}/motd-routes-${route.slice(1) || "home"}-${width}-${open ? "open" : "closed"}.png`,
              });
          }
        }
      }
      // Exercise ClientRouter continuity rather than only hard navigations.
      await page.setViewportSize({ width: 700, height: 400 });
      await page.goto(`${process.env.LAMATEAM_UI_URL}/`);
      if (await page.locator(".chat-launcher").isVisible())
        await page.locator(".chat-launcher").click();
      await page.locator("#messageInput").evaluate((input) => {
        input.disabled = false;
        input.value = "a draft";
      });
      await page.locator("#messageInput").focus();
      await page.locator("#messageInput").press("End");
      await page.locator("#messageInput").press("Space");
      await page.locator("#messageInput").pressSequentially("with spaces");
      assert.equal(
        await page.locator("#messageInput").inputValue(),
        "a draft with spaces",
      );
      const chatBefore = await page.locator("#live-chat-panel").boundingBox();
      await page.locator('.motd-guide-links a[href="/maps"]').click();
      await page.waitForURL("**/maps");
      await page.waitForFunction(
        () => !document.querySelector(".motd-welcome"),
      );
      assert.deepEqual(
        await page.locator("#live-chat-panel").boundingBox(),
        chatBefore,
      );
      assert.equal(
        await page.locator("#messageInput").inputValue(),
        "a draft with spaces",
      );
      assert.equal(
        await page.locator("#messageInput").getAttribute("placeholder"),
        "Click Send to chat",
      );
      await page.locator(".chat-close").click();
      await page
        .locator('a[href="/rules"]')
        .first()
        .evaluate((link) => link.click());
      await page.waitForURL("**/rules");
      await page.waitForFunction(() =>
        document.querySelector("main h1")?.textContent.includes("Server Rules"),
      );
      assert.equal(await page.locator("#live-chat-panel").isHidden(), true);
      assert.equal(
        await page
          .locator("main")
          .evaluate((main) => main.getBoundingClientRect().width),
        700,
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  "MOTD flags navigate and verified/public stats retain precedence, labels and right-aligned geometry",
  { skip: !process.env.LAMATEAM_UI_URL, timeout: 120_000 },
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
    try {
      const context = await browser.newContext({
        userAgent: "Valve Client",
        locale: "en-US",
      });
      const page = await context.newPage();
      let available = false;
      let invalid = false;
      let publicAvailable = false;
      let publicRequests = 0;
      await page.route("**/api/stats/motd?*", (route) => {
        publicRequests++;
        assert.ok(!route.request().url().includes("name="));
        return route.fulfill({
          status: publicAvailable ? 200 : 404,
          json: publicAvailable
            ? {
                available: true,
                source: "motd",
                verified: false,
                authenticated: false,
                stats: {
                  rank: 12,
                  skill: 1800,
                  kills: 80,
                  deaths: 40,
                  kpd: 2,
                  headshots: 20,
                  accuracy: 32.5,
                },
              }
            : {
                available: false,
                source: "motd",
                verified: false,
                authenticated: false,
                reason: "not_found",
              },
        });
      });
      await page.route("**/api/stats/me", (route) =>
        route.fulfill({
          status: available ? 200 : 401,
          json: available
            ? {
                available: true,
                stats: {
                  rank: 12,
                  skill: 1800,
                  kills: invalid ? "untrusted" : 80,
                  deaths: 40,
                  kpd: 2,
                  headshots: 20,
                  accuracy: 32.5,
                },
              }
            : { available: false, reason: "unauthorized" },
        }),
      );
      for (const width of [390, 700, 1920]) {
        await page.setViewportSize({
          width,
          height: width === 700 ? 400 : 1080,
        });
        for (const open of [true, false]) {
          let statsSlotGeometry;
          for (const state of [
            "unauthorized",
            "invalid",
            "available",
            "public",
          ]) {
            available = state === "available" || state === "invalid";
            invalid = state === "invalid";
            publicAvailable = state === "public";
            const beforePublic = publicRequests;
            await page.goto(
              `${process.env.LAMATEAM_UI_URL}/?communityid=76561197960265729&name=UnverifiedQuery`,
            );
            if (await page.locator(".chat-launcher").isVisible())
              await page.locator(".chat-launcher").click();
            if (!open) await page.locator(".chat-close").click();
            const panel = page.locator(".motd-personal-stats");
            if (state === "available" || state === "public") {
              await panel.waitFor({ state: "visible" });
              assert.equal(await panel.locator("dl > div").count(), 7);
              assert.equal(
                await panel.locator("dd").first().textContent(),
                "80",
              );
              const typography = await panel.evaluate((panel) => {
                const slot = panel.parentElement;
                const heading = panel.querySelector("[data-stats-title]");
                const values = panel.querySelector("dl");
                return {
                  headingSize: parseFloat(getComputedStyle(heading).fontSize),
                  panelSize: parseFloat(getComputedStyle(panel).fontSize),
                  valuesSize: parseFloat(getComputedStyle(values).fontSize),
                  lineHeight: parseFloat(getComputedStyle(values).lineHeight),
                  bottom: values.getBoundingClientRect().bottom,
                  slotBottom: slot.getBoundingClientRect().bottom,
                  scrollHeight: slot.scrollHeight,
                  clientHeight: slot.clientHeight,
                };
              });
              assert.equal(typography.headingSize, typography.panelSize);
              assert.ok(
                Math.abs(
                  typography.valuesSize / typography.headingSize - 0.875,
                ) < 0.01,
              );
              assert.ok(
                typography.valuesSize >= 12,
                "snapshot values remain readable at small MOTD resolutions",
              );
              assert.ok(
                Math.abs(typography.lineHeight / typography.valuesSize - 1.25) <
                  0.01,
              );
              assert.ok(
                typography.bottom <= typography.slotBottom + 1,
                "all seven stats fit the reserved panel height",
              );
              assert.ok(
                typography.scrollHeight <= typography.clientHeight + 1,
                "snapshot content needs no vertical scrollbar",
              );
              assert.ok(
                !(await panel.textContent()).includes("UnverifiedQuery"),
              );
              const title = await panel
                .locator("[data-stats-title]")
                .textContent();
              if (state === "public") assert.match(title, /Public.*unverified/);
              else {
                assert.match(title, /Your/);
                assert.equal(
                  publicRequests,
                  beforePublic,
                  "verified session prevents public lookup",
                );
              }
            } else {
              assert.equal(await panel.isHidden(), true);
              assert.equal(await panel.locator("dl > div").count(), 0);
              await page.waitForFunction(() =>
                document
                  .querySelector("[data-motd-stats-state]")
                  ?.textContent.includes("unavailable"),
              );
            }
            const geometry = await page.evaluate(() => {
              const row = document.querySelector(".motd-top-row");
              const boxes = [...row.children].map((child) =>
                child.getBoundingClientRect().toJSON(),
              );
              return {
                boxes,
                right: row.getBoundingClientRect().right,
                overflow:
                  document.querySelector("main").scrollWidth >
                  document.querySelector("main").clientWidth,
              };
            });
            assert.equal(geometry.overflow, false);
            assert.ok(
              geometry.boxes[1].height <= 184,
              "compact stats slot follows capped MOTD type scale",
            );
            if (width === 1920) {
              const [welcome, stats, rating] = geometry.boxes;
              for (const panel of [welcome, rating]) {
                assert.ok(
                  Math.abs(panel.y - stats.y) < 1,
                  "wide panels share a row",
                );
                assert.ok(
                  Math.abs(panel.height - stats.height) < 1,
                  "wide panels have equal height",
                );
              }
            }
            if (!statsSlotGeometry) statsSlotGeometry = geometry.boxes[1];
            assert.deepEqual(
              geometry.boxes[1],
              statsSlotGeometry,
              "loading/unavailable/available retain stable stats slot geometry",
            );
            assert.ok(
              Math.abs(geometry.boxes[2].right - geometry.right) < 1,
              "rating must align with row right edge",
            );
            if (state === "available" || state === "public") {
              const [welcome, stats, rating] = geometry.boxes;
              assert.ok(stats.y >= welcome.y);
              assert.ok(
                stats.y < rating.y || stats.right <= rating.x,
                "stats precede rating visually",
              );
              if (width === 1920)
                assert.ok(stats.x >= welcome.right && rating.x >= stats.right);
            }
            if (process.env.LAMATEAM_MOTD_SCREENSHOTS && state !== "invalid")
              await page.screenshot({
                path: `${process.env.LAMATEAM_MOTD_SCREENSHOTS}/motd-stats-${state === "available" || state === "public" ? `mock-${state}-NOT-REAL` : "anonymous"}-${width}-${open ? "open" : "closed"}.png`,
              });
          }
        }
      }
      await page.locator('[data-language-shortcut="SK"]').click();
      await page.waitForURL("**/sk/**");
      assert.equal(await page.locator("html").getAttribute("lang"), "sk");
      assert.equal(
        await page
          .locator('[data-language-shortcut="SK"]')
          .getAttribute("aria-current"),
        "true",
      );
    } finally {
      await browser.close();
    }
  },
);

// Isolated, opt-in local preview. Set LAMATEAM_UI_URL and optionally
// LAMATEAM_PLAYWRIGHT_MODULE / CHROMIUM_BIN for the host's browser tooling.
test(
  "MOTD sidebar, capped type, borderless top and desktop-only SourceTV",
  {
    skip: !process.env.LAMATEAM_UI_URL,
    timeout: 60_000,
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
    try {
      const context = await browser.newContext({
        userAgent: "Valve Client",
        locale: "en-US",
      });
      const page = await context.newPage();
      const metrics = () =>
        page.evaluate(() => {
          const box = (selector) =>
            document.querySelector(selector).getBoundingClientRect().toJSON();
          const style = (selector) =>
            getComputedStyle(document.querySelector(selector));
          return {
            main: box("main"),
            chat: box("#live-chat-panel"),
            nav: box(".community-nav"),
            rating: box(".random-map-widget"),
            thumbnail: box("#random-map-preview img"),
            content: box(".random-map-widget .map-card-content"),
            controls: [
              ".random-map-widget .rating-stars",
              "#random-map-skip",
            ].map(box),
            starTargets: [
              ...document.querySelectorAll(".random-map-widget .rating-star"),
            ].map((star) => star.getBoundingClientRect().toJSON()),
            ratingAlignment: {
              heading: style(".random-map-prompt").textAlign,
              content: style(".random-map-widget .map-card-content").textAlign,
              name: style(".random-map-widget .map-name").justifyContent,
              form: style(".random-map-widget .map-rating-form").justifyContent,
            },
            hidden: document.querySelector("#live-chat-panel").hidden,
            overflow: document.documentElement.scrollWidth > innerWidth,
            mainOverflow:
              document.querySelector("main").scrollWidth >
              document.querySelector("main").clientWidth,
            fonts: [
              ".motd-welcome h1",
              ".guide-description",
              ".motd-rules table",
              ".motd-rules h2",
              "#shoutbox-title",
              ".shoutbox-feed",
            ].map((s) => parseFloat(style(s).fontSize)),
            surfaces: [".motd-welcome", ".random-map-widget"].map((s) => ({
              border: style(s).borderTopWidth,
              background: style(s).backgroundColor,
              shadow: style(s).boxShadow,
            })),
            sourceTV: [
              ...document.querySelectorAll(".motd-guide-links a"),
            ].some((a) => a.href.includes("sourcetv")),
          };
        });
      for (const [width, height] of [
        [390, 844],
        [700, 400],
        [1920, 1080],
        [3840, 2160],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(
          `${process.env.LAMATEAM_UI_URL}/?communityid=76561197960265729&name=MotdPreview`,
        );
        await page.locator("#random-map-preview img").waitFor();
        await page.locator("#live-chat-panel").waitFor({ state: "visible" });
        const result = await metrics();
        assert.equal(result.hidden, false);
        assert.equal(result.overflow, false);
        assert.equal(result.mainOverflow, false);
        assert.equal(result.sourceTV, false);
        assert.ok(result.chat.width <= (width <= 480 ? width : 360));
        if (width === 700)
          assert.ok(result.chat.width >= 240 && result.chat.width <= 280);
        assert.ok(result.main.width > result.chat.width);
        if (width <= 480) {
          assert.equal(result.main.width, width);
          assert.ok(result.chat.top >= result.main.bottom);
        } else {
          assert.ok(result.chat.left >= result.main.right);
        }
        assert.ok(Math.abs(result.chat.bottom - height) <= 15);
        if (width > 480) assert.ok(Math.abs(result.main.bottom - height) <= 1);
        assert.ok(result.rating.right <= result.main.right);
        const assertRating = (result) => {
          assert.ok(result.thumbnail.right < result.content.left);
          assert.ok(result.rating.width < result.main.width);
          assert.deepEqual(result.ratingAlignment, {
            heading: "right",
            content: "right",
            name: "flex-end",
            form: "end",
          });
          for (const control of result.controls) {
            assert.ok(
              control.bottom < result.thumbnail.bottom,
              `${width}: controls must finish above image bottom`,
            );
            assert.ok(control.left >= result.content.left);
            assert.ok(control.right <= result.content.right + 0.01);
          }
          assert.ok(
            Math.abs(result.controls[1].right - result.content.right) < 0.01,
          );
          assert.ok(
            Math.abs(result.controls[0].top - result.controls[1].top) < 0.01,
          );
          assert.ok(result.controls[1].height >= 44);
          assert.ok(result.controls[1].width >= 44);
          assert.equal(result.starTargets.length, 5);
          for (const star of result.starTargets) {
            assert.ok(star.width >= 24 && star.height >= 44);
          }
        };
        assertRating(result);
        for (const [index, cap] of [23.2, 16, 16, 19.2, 19.2, 16].entries()) {
          assert.ok(
            result.fonts[index] >= 14 && result.fonts[index] <= cap + 0.01,
            `font ${index}: ${result.fonts[index]}`,
          );
        }
        for (const surface of result.surfaces) {
          assert.equal(surface.border, "0px");
          assert.equal(surface.background, "rgba(0, 0, 0, 0)");
          assert.equal(surface.shadow, "none");
        }
        console.log(`${width}×${height} open`, JSON.stringify(result));
        if (process.env.LAMATEAM_MOTD_SCREENSHOTS)
          await page.screenshot({
            path: `${process.env.LAMATEAM_MOTD_SCREENSHOTS}/motd-refined-${width}-open.png`,
          });
        await page.locator(".chat-close").click();
        const closed = await metrics();
        assert.equal(closed.hidden, true);
        assert.equal(closed.main.width, width);
        assert.equal(closed.overflow, false);
        assert.equal(closed.mainOverflow, false);
        assertRating(closed);
        if (process.env.LAMATEAM_MOTD_SCREENSHOTS)
          await page.screenshot({
            path: `${process.env.LAMATEAM_MOTD_SCREENSHOTS}/motd-refined-${width}-closed.png`,
          });
        await page.locator(".chat-launcher").click();
        assert.equal((await metrics()).hidden, false);
      }
      const desktop = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 Chromium",
      });
      const web = await desktop.newPage();
      await web.goto(process.env.LAMATEAM_UI_URL);
      assert.equal(
        (await web.locator(".footer-copy").textContent()).trim(),
        "© LaMaTeAm: crazy69 • web & server: muso.sk",
      );
      await web.goto(`${process.env.LAMATEAM_UI_URL}/sk/`);
      assert.equal(
        (await web.locator(".footer-copy").textContent()).trim(),
        "© LaMaTeAm: crazy69 • web & server: muso.sk",
      );
      await web.goto(process.env.LAMATEAM_UI_URL);
      assert.equal(
        await web.locator('.desktop-community a[href*="sourcetv"]').count(),
        1,
      );
    } finally {
      await browser.close();
    }
  },
);
