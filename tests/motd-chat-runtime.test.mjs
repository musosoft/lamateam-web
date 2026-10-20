import assert from "node:assert/strict";
import test from "node:test";
import { issueSteamSession } from "../src/lib/steam-session.ts";

const base = process.env.MOTD_CHAT_URL;
test(
  "authenticated MOTD chat accepts focus, literal spaces and pointer-only sending",
  { skip: !base || !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      for (const viewport of [
        { width: 640, height: 480 },
        { width: 1280, height: 720 },
      ]) {
        const context = await browser.newContext({
          userAgent: "Valve Steam Client",
          viewport,
        });
        await context.addCookies([
          {
            name: "steam_auth",
            value: await issueSteamSession(
              "76561198000000001",
              "stable-render-offline-test-key",
            ),
            url: base,
          },
        ]);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let posts = 0;
        await page.route(/^https:\/\//, (route) => route.abort());
        await page.route("**/api/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/shoutbox") {
            if (route.request().method() === "POST") posts++;
            return route.fulfill({ json: [] });
          }
          return route.fulfill({ status: 401, json: {} });
        });
        await page.goto(base + "/");
        await page.waitForFunction(
          () =>
            document
              .querySelector("#chat-launcher")
              ?.getAttribute("aria-expanded") === "true",
        );
        const input = page.locator("#messageInput");
        assert.equal(
          await page
            .locator("#live-chat-shell")
            .getAttribute("data-authenticated"),
          "true",
        );
        assert.equal(await input.isEnabled(), true);
        // Opening the MOTD must put keyboard input in the composer, not the
        // heading. Do not use fill(), which would focus the field for us.
        assert.equal(
          await input.evaluate((node) => document.activeElement === node),
          true,
        );
        await page.keyboard.type("initial draft");
        assert.equal(await input.inputValue(), "initial draft");
        await page.evaluate(() =>
          document.dispatchEvent(new Event("astro:page-load")),
        );
        assert.equal(await input.inputValue(), "initial draft");
        await page.locator(".chat-close").click();
        await page.locator("#chat-launcher").click();
        assert.equal(
          await input.evaluate((node) => document.activeElement === node),
          true,
        );
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        await input.click({ timeout: 5000 });
        assert.equal(
          await input.evaluate((node) => document.activeElement === node),
          true,
        );
        await page.keyboard.type("hello team with spaces");
        assert.equal(await input.inputValue(), "hello team with spaces");
        await page.keyboard.press("Enter");
        assert.equal(posts, 0);
        await page.locator("#sendButton").focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Space");
        assert.equal(posts, 0);
        await page.locator("#sendButton").click();
        await page.waitForFunction(
          () => document.querySelector("#messageInput").value === "",
        );
        assert.equal(posts, 1);
        assert.deepEqual(errors, []);
        await context.close();
      }
      // MOTD community IDs are deliberately self-asserted; regular browsers
      // still need a signed session and focus the heading when chat opens.
      for (const scenario of [
        {
          userAgent: "Valve Steam Client",
          signedSession: false,
          enabled: true,
          inGame: true,
        },
        {
          userAgent: "Mozilla/5.0",
          signedSession: false,
          enabled: false,
          inGame: false,
        },
        {
          userAgent: "Mozilla/5.0",
          signedSession: true,
          enabled: true,
          inGame: false,
        },
      ]) {
        const context = await browser.newContext({
          userAgent: scenario.userAgent,
          viewport: { width: 1280, height: 720 },
        });
        await context.addCookies([
          {
            name: "session",
            value: encodeURIComponent(
              JSON.stringify({
                steamID: "76561198000000001",
                playerName: "Display only",
              }),
            ),
            url: base,
          },
          ...(scenario.signedSession
            ? [
                {
                  name: "steam_auth",
                  value: await issueSteamSession(
                    "76561198000000001",
                    "stable-render-offline-test-key",
                  ),
                  url: base,
                },
              ]
            : []),
        ]);
        const page = await context.newPage();
        await page.route(/^https:\/\//, (route) => route.abort());
        await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
        await page.goto(
          base + "/?communityid=76561198000000001&name=DisplayOnly",
        );
        await page.locator(".chat-close").click();
        await page.locator("#chat-launcher").click();
        assert.equal(
          await page.locator("#messageInput").isEnabled(),
          scenario.enabled,
        );
        assert.equal(
          await page.locator("#sendButton").isEnabled(),
          scenario.enabled,
        );
        const focused = await page.evaluate(() => {
          const target = /valve|steam/i.test(navigator.userAgent)
            ? document.querySelector("#messageInput")
            : document.querySelector("#shoutbox-title");
          return document.activeElement === target;
        });
        assert.equal(focused, true);
        if (scenario.inGame) {
          await page.keyboard.type("community member");
          assert.equal(
            await page.locator("#messageInput").inputValue(),
            "community member",
          );
        }
        if (!scenario.enabled) {
          await page.locator("#messageInput").evaluate((node) => node.focus());
          await page.keyboard.type("must not type");
          assert.equal(await page.locator("#messageInput").inputValue(), "");
          assert.equal(
            await page.locator(".chat-account a").getAttribute("href"),
            "/api/auth/steam",
          );
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
