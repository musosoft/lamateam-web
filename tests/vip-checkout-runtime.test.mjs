import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.VIP_CHECKOUT_URL;

test(
  "Reserve checkout initializes after client navigation and only prepares a review",
  {
    skip: !base || !process.env.PLAYWRIGHT_MODULE,
    timeout: 60000,
  },
  async () => {
    const origin = new URL(base);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname),
      "local QA only",
    );
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let requests = 0;
      let fail = false;
      // Never permit an external request or a real checkout/IPN request.
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin.origin) return route.abort();
        if (url.pathname === "/api/donations/checkout") {
          requests++;
          assert.equal(route.request().method(), "POST");
          assert.equal(
            route.request().postData(),
            "steamid_user=STEAM_0%3A1%3A123&offer=1",
          );
          if (fail) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            json: {
              action: "https://www.paypal.com/cgi-bin/webscr",
              offerName: "Reserve - 1 month",
              amount: "100.00",
              steamId: "STEAM_0:1:123",
              estimatedExpiry: "2026-11-22",
              fields: {
                cmd: "_xclick",
                business: "qa@example.invalid",
                amount: "100.00",
                currency_code: "CZK",
                item_name: "Reserve - 1 month",
                item_number: "reserve-1",
                custom: "STEAM_0:1:123|1|offer:1",
                no_note: "1",
                no_shipping: "1",
                rm: "2",
                return: `${origin.origin}/vip`,
                notify_url: `${origin.origin}/api/donations/ipn`,
                cancel_return: `${origin.origin}/vip`,
              },
            },
          });
        }
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({ json: [] });
        if (route.request().method() !== "GET") return route.abort();
        return route.continue();
      });
      const navigate = async (path) => {
        await page.evaluate((path) => {
          const link = document.createElement("a");
          link.id = "qa-navigation";
          link.href = path;
          link.textContent = "Local QA navigation";
          document.body.append(link);
        }, path);
        await page.locator("#qa-navigation").click();
        await page.waitForURL(`${origin.origin}${path}`);
      };
      await page.goto(`${origin.origin}/vip`);
      await page.waitForFunction(
        () => !document.querySelector("#reserve-form button").disabled,
      );
      await page.evaluate(() => (window.__vipQaDocument = true));
      await navigate("/commands");
      await navigate("/vip");
      // Module scripts execute once; a returned form still needs initialization.
      await page.waitForFunction(
        () => !document.querySelector("#reserve-form button").disabled,
        null,
        { timeout: 5000 },
      );
      assert.equal(await page.evaluate(() => window.__vipQaDocument), true);
      for (const path of ["/vip", "/cs/vip-vyhody/"]) {
        if (path !== "/vip") await navigate(path);
        await page.waitForFunction(
          () => !document.querySelector("#reserve-form button").disabled,
        );
        await page.evaluate(() => {
          document.dispatchEvent(new Event("astro:page-load"));
          document.dispatchEvent(new Event("astro:page-load"));
        });
        const submit = page.locator('#reserve-form button[type="submit"]');
        const before = requests;
        await submit.click();
        assert.equal(
          requests,
          before,
          "native required-field validation blocks empty form",
        );
        await page.locator("#reserve-steam").fill("STEAM_0:1:123");
        await page.locator('input[name="months"][value="1"]').check();
        await submit.click();
        await page.locator("#reserve-review").waitFor({ state: "visible" });
        assert.equal(
          requests,
          before + 1,
          "repeat lifecycle events do not duplicate handlers",
        );
        assert.equal(
          await page.locator('[data-review="steamId"]').textContent(),
          "STEAM_0:1:123",
        );
        assert.equal(await submit.isEnabled(), true);
        assert.equal(
          new URL(page.url()).pathname,
          path,
          "review does not navigate to PayPal",
        );
        await page.locator("#reserve-steam").fill("STEAM_0:1:124");
        assert.equal(await page.locator("#reserve-review").isHidden(), true);
        await page.locator("#reserve-steam").fill("STEAM_0:1:123");
        fail = true;
        await submit.click();
        await page.waitForFunction(
          () =>
            document.querySelector("#reserve-status").textContent.length > 0 &&
            !document.querySelector("#reserve-form button").disabled,
        );
        assert.equal(
          await page.locator("#reserve-status").textContent(),
          await page.locator("#reserve-form").getAttribute("data-error"),
        );
        assert.equal(await page.locator("#reserve-review").isHidden(), true);
        fail = false;
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
