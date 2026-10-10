import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("hero belongs to the main grid column before the community content", () => {
  const home = read("../pages/index.astro");
  const grid = home.indexOf('<div class="community-grid');
  const main = home.indexOf('<div class="community-main');
  const hero = home.indexOf("<header");
  const content = home.indexOf('class="desktop-community');
  const aside = home.indexOf("<aside");
  assert.ok(grid < main && main < hero && hero < content && content < aside);
  assert.match(home, /\.community-main \.home-hero\s*\{\s*margin-bottom: 0;/);
  assert.match(
    home,
    /@media \(min-width: 1000px\)[\s\S]*minmax\(340px, 400px\)/,
  );
  assert.match(
    home,
    /:global\(\.is-game\) \.community-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("random map fills a consistent 4:3 frame without small height caps", () => {
  const maps = read("./MapRatings.astro");
  const image = maps.match(
    /\.random-map-widget :global\(\.map-thumbnail img\)\s*\{([^}]+)\}/,
  )[1];
  for (const rule of [
    "width: 100%",
    "height: 100%",
    "max-height: none",
    "object-fit: cover",
  ])
    assert.ok(image.includes(rule), rule);
  assert.ok(!maps.includes("max-height: 115px"));
  assert.ok(!maps.includes("max-height: 165px"));
  assert.match(maps, /\.map-thumbnail\s*\{\s*aspect-ratio: 4 \/ 3;/);
  assert.match(maps, /fit: 'cover' as const/);
  assert.doesNotMatch(
    maps,
    /object-fit: contain|min-height: 190px|max-height: 200px/,
  );
});

test("footer picker is centered and copyright shares the footer text scale", () => {
  const css = read("../assets/tailwind.css");
  const layout = read("../layouts/Layout.astro");
  assert.ok(layout.includes('class="footer-copy fl-text-xs/sm"'));
  assert.ok(layout.includes('class="nav-link fl-p-2/3 fl-text-xs/sm"'));
  for (const rule of css.matchAll(/\.footer-copy\s*\{([^}]+)\}/g))
    assert.ok(!rule[1].includes("font-size:"));
  const finalRules = css.slice(
    css.indexOf("/* Keep the complete picker centered"),
  );
  assert.match(
    finalRules,
    /\.community-footer \.language-control\s*\{[^}]*justify-self: center/,
  );
  assert.match(finalRules, /select::picker-icon\s*\{[^}]*align-self: center/);
});

// Opt-in local rendered regression: no signed-in browser or external account.
// LAMATEAM_UI_URL=http://127.0.0.1:4321 node --test src/components/HomeVisualLayout.test.mjs
test(
  "rendered desktop/mobile/MOTD columns and larger intrinsic map images fit",
  {
    skip: !process.env.LAMATEAM_UI_URL,
    timeout: 60_000,
  },
  async () => {
    const profile = mkdtempSync("/tmp/opencode/lamateam-visual-test-");
    const chrome = spawn(process.env.CHROMIUM_BIN || "chromium", [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ]);
    let socket;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        chrome.stderr.on("data", (chunk) => {
          const match = String(chunk).match(
            /DevTools listening on (ws:\/\/[^\s]+)/,
          );
          if (match) resolve(match[1]);
        });
        chrome.once("error", reject);
        chrome.once("exit", (code) =>
          reject(new Error(`Chromium exited: ${code}`)),
        );
      });
      socket = new WebSocket(endpoint);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let id = 0;
      const pending = new Map();
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.method === "Runtime.exceptionThrown")
          console.error(JSON.stringify(data.params));
        pending.get(data.id)?.(data);
        pending.delete(data.id);
      });
      const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
          const key = ++id;
          pending.set(key, (data) =>
            data.error
              ? reject(new Error(JSON.stringify(data.error)))
              : resolve(data),
          );
          socket.send(JSON.stringify({ id: key, method, params, sessionId }));
        });
      const target = await send("Target.createTarget", { url: "about:blank" });
      const attached = await send("Target.attachToTarget", {
        targetId: target.result.targetId,
        flatten: true,
      });
      const session = attached.result.sessionId;
      await send("Runtime.enable", {}, session);
      await send("Page.enable", {}, session);
      await send("Network.enable", {}, session);
      await send(
        "Network.setBlockedURLs",
        { urls: ["*gametracker.com/*", "*discord.com/*", "*wikimedia.org/*"] },
        session,
      );
      const evaluate = async (expression) => {
        const result = await send(
          "Runtime.evaluate",
          { expression, returnByValue: true, awaitPromise: true },
          session,
        );
        assert.ok(
          !result.result.exceptionDetails,
          JSON.stringify(result.result.exceptionDetails),
        );
        return result.result.result.value;
      };
      for (const [width, height, motd] of [
        [3840, 2160, false],
        [1920, 1000, false],
        [1024, 1000, false],
        [400, 1000, false],
        [320, 1000, false],
        [700, 400, true],
        [400, 700, true],
        [280, 400, true],
        [3840, 2160, true],
      ]) {
        await send(
          "Emulation.setDeviceMetricsOverride",
          { width, height, deviceScaleFactor: 1, mobile: false },
          session,
        );
        await send(
          "Emulation.setUserAgentOverride",
          { userAgent: motd ? "Valve Steam MOTD" : "Mozilla/5.0 Chromium" },
          session,
        );
        const loaded = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.removeEventListener("message", onLoad);
            reject(new Error("Page load timed out"));
          }, 20000);
          const onLoad = (event) => {
            const data = JSON.parse(event.data);
            if (
              data.sessionId === session &&
              data.method === "Page.loadEventFired"
            ) {
              clearTimeout(timer);
              socket.removeEventListener("message", onLoad);
              resolve();
            }
          };
          socket.addEventListener("message", onLoad);
        });
        await send(
          "Page.navigate",
          { url: process.env.LAMATEAM_UI_URL },
          session,
        );
        await loaded;
        await evaluate(`new Promise((resolve, reject) => {
        let tries = 0;
        const wait = () => {
          if (document.querySelector('#random-map-preview img')) resolve(true);
          else if (++tries > 100) reject(new Error('Random map did not render'));
          else setTimeout(wait, 100);
        }; wait();
      })`);
        // Upcoming large landscape asset; local data fixture, not a third-party fetch.
        await evaluate(`new Promise((resolve, reject) => {
        const image = document.querySelector('#random-map-preview img');
        image.onload = () => resolve(true); image.onerror = reject;
        image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="green"/></svg>');
        image.width = 1600; image.height = 1000;
      })`);
        const result = await evaluate(
          `(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height}; };
        const style = selector => { const element = document.querySelector(selector); return element ? getComputedStyle(element) : null; };
        const footer = rect('.community-footer');
        const footerStyle = style('.community-footer');
        const select = document.querySelector('.language-control select');
        return {
          hero: rect('.home-hero'), main: rect('.community-main'), side: rect('.community-side'),
          image: rect('#random-map-preview img'), card: rect('#random-map-preview'),
          viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
          motd: document.body.classList.contains('is-game'),
          nav: rect('.community-nav'), chat: rect('#live-chat-panel'),
          chatTitleSize: style('#shoutbox-title').fontSize,
          chatFeedSize: style('#shoutboxMessages').fontSize,
          chatInputSize: style('#messageInput').fontSize,
          chatInput: rect('#messageInput'),
          chatFeed: rect('#shoutboxMessages'),
          heroTitleSize: style('.motd-welcome h1')?.fontSize,
          heroIntroSize: style('.hero-intro').fontSize,
          chatHidden: document.querySelector('#live-chat-panel').hidden,
          connectVisible: [...document.querySelectorAll('a.connect-button')].some(a => a.getBoundingClientRect().height > 0),
          joinInstructions: Boolean(document.querySelector('.hero-links a[href^="/connect"]')),
          stars: rect('#random-map-preview .rating-stars'), skip: rect('#random-map-skip'),
          decision: rect('#random-map-preview .map-rating-form'),
          mapName: rect('#random-map-preview .map-name'),
          headerSurface: style('.server-monitor-heading')?.backgroundColor,
          surface: style('.gametracker-frame')?.backgroundColor,
          panel: style('.server-monitor')?.backgroundColor,
          footerCenter: (footer.left + parseFloat(footerStyle.paddingLeft) + footer.right - parseFloat(footerStyle.paddingRight)) / 2,
          picker: rect('.language-control'),
          footerLinks: rect('.footer-links'), footerCopy: rect('.footer-copy'),
          copyrightSize: style('.footer-copy').fontSize, linkSize: style('.footer-links .nav-link').fontSize,
          pickerAlignment: style('.language-control').justifySelf,
          customSelect: CSS.supports('appearance', 'base-select'),
          chevronAlignment: getComputedStyle(select, '::picker-icon').alignSelf,
          selectAlignment: style('.language-control select').alignItems,
        };
      })()`,
        );
        assert.equal(result.motd, motd);
        assert.equal(
          result.connectVisible,
          !motd,
          "Connect CTAs are hidden only in MOTD",
        );
        if (motd)
          assert.equal(
            result.joinInstructions,
            true,
            "join instructions remain available",
          );
        assert.ok(
          result.page <= result.viewport + 1,
          `${width}: page overflow`,
        );
        if (width >= 1000 && !motd) {
          assert.ok(result.side.width >= 340 && result.side.width <= 400);
          assert.ok(
            Math.abs(result.hero.top - result.side.top) < 1,
            `${width}: columns must start together`,
          );
          assert.ok(
            result.hero.right <= result.side.left,
            `${width}: separate columns`,
          );
        } else {
          assert.ok(
            result.side.top >= result.main.bottom,
            `${width}: sidebar stacks below main`,
          );
        }
        assert.ok(
          result.image.width > (width >= 1000 ? 300 : 200),
          `${width}: visibly larger image`,
        );
        assert.ok(
          result.image.right <= result.viewport && result.image.left >= 0,
        );
        assert.ok(result.image.width <= result.card.width);
        if (width > 320) {
          assert.ok(
            result.stars.left >= result.mapName.right,
            "decision immediately right of map name",
          );
          assert.ok(
            Math.abs(
              (result.mapName.top + result.mapName.bottom) / 2 -
                (result.stars.top + result.stars.bottom) / 2,
            ) < 2,
            "map name and stars vertically aligned",
          );
        }
        assert.ok(
          Math.abs(
            (result.stars.top + result.stars.bottom) / 2 -
              (result.skip.top + result.skip.bottom) / 2,
          ) < 2,
          "stars and skip vertically centered",
        );
        assert.ok(
          Math.abs(
            (result.stars.left + result.skip.right) / 2 -
              (result.decision.left + result.decision.right) / 2,
          ) < 2,
          "whole decision group horizontally centered",
        );
        if (motd) {
          console.log(
            JSON.stringify({
              width,
              height,
              chat: result.chat,
              title: result.chatTitleSize,
              feed: result.chatFeedSize,
              input: result.chatInputSize,
              inputHeight: result.chatInput.height,
              hero: result.heroTitleSize,
              intro: result.heroIntroSize,
            }),
          );
          assert.equal(result.chatHidden, false);
          assert.equal(result.nav.height, 64);
          assert.ok(
            result.chat.width <= (width === 3840 ? 1200 : 400) &&
              result.chat.right <= width,
          );
          assert.ok(result.chat.top >= result.nav.bottom);
          if (width === 3840) {
            assert.ok(result.chat.width > 1100);
            assert.equal(result.chat.height, 1600);
            assert.equal(result.chatTitleSize, "38.4px");
            assert.equal(result.chatFeedSize, "30.72px");
            assert.equal(result.chatInputSize, "30.72px");
            assert.ok(result.chatInput.height >= 80);
            assert.equal(result.heroTitleSize, "65.28px");
            assert.equal(result.heroIntroSize, "30.72px");
            assert.ok(result.chatFeed.height > result.chat.height * 0.65);
            const overflow = await evaluate(`(() => {
              const feed = document.querySelector('#shoutboxMessages');
              feed.replaceChildren();
              for (let i = 0; i < 30; i++) {
                const message = document.createElement('article');
                message.className = 'shoutbox-message';
                const text = document.createElement('div');
                text.textContent = 'Player: ' + 'LongUnbrokenMessage'.repeat(20);
                message.append(text); feed.append(message);
              }
              return {width: feed.clientWidth, scroll: feed.scrollWidth, height: feed.clientHeight, scrollHeight: feed.scrollHeight};
            })()`);
            assert.ok(overflow.scroll <= overflow.width);
            assert.ok(overflow.scrollHeight > overflow.height);
          } else {
            const small = { 700: [328, 328], 400: [369, 600], 280: [249, 328] }[
              width
            ];
            assert.equal(result.chat.width, small[0]);
            assert.equal(result.chat.height, small[1]);
            assert.equal(result.chat.top, 72);
            assert.equal(result.chatTitleSize, "14.4px");
            assert.equal(result.chatFeedSize, "12.8px");
            assert.equal(result.chatInputSize, "12.8px");
            assert.equal(result.chatInput.height, 44);
            assert.equal(result.heroTitleSize, "20px");
            assert.equal(result.heroIntroSize, "14px");
          }
          assert.ok(
            result.chat.bottom <= height + 1,
            JSON.stringify({
              width,
              height,
              nav: result.nav,
              chat: result.chat,
            }),
          );
          if (width > 600) assert.ok(result.main.right <= result.chat.left);
          await evaluate(`document.querySelector('.nav-peek').click()`);
          const menu = await evaluate(`(() => {
            const nav = document.querySelector('.community-nav');
            return {height: nav.getBoundingClientRect().height,
              flags: [...nav.querySelectorAll('.header-language-options a')].map(a => {const r=a.getBoundingClientRect(); return {left:r.left,right:r.right};})};
          })()`);
          assert.equal(menu.height, 64);
          assert.ok(menu.flags.every((r) => r.left >= 0 && r.right <= width));
          await evaluate(`(() => {
            document.querySelector('.nav-peek').click();
            const originalFetch = window.fetch;
            window.chatPosts = 0;
            window.fetch = (url, options) => String(url).endsWith('/api/shoutbox')
              ? (options?.method === 'POST' && window.chatPosts++, Promise.resolve(new Response('[]', {status:200})))
              : originalFetch(url, options);
            document.querySelector('#live-chat-shell').dataset.authenticated = 'true';
            document.dispatchEvent(new Event('astro:page-load'));
            const input = document.querySelector('#messageInput');
            input.value = 'Hello'; input.focus();
          })()`);
          await send(
            "Input.dispatchKeyEvent",
            {
              type: "keyDown",
              key: " ",
              code: "Space",
              text: " ",
              windowsVirtualKeyCode: 32,
            },
            session,
          );
          await send(
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key: " ",
              code: "Space",
              windowsVirtualKeyCode: 32,
            },
            session,
          );
          assert.ok(
            (
              await evaluate(`document.querySelector('#messageInput').value`)
            ).includes(" "),
            "literal typed spaces survive",
          );
          for (const selector of ["#messageInput", "#sendButton"]) {
            await evaluate(`document.querySelector('${selector}').focus()`);
            for (const [key, code, number] of [
              ["Enter", "Enter", 13],
              [" ", "Space", 32],
            ]) {
              await send(
                "Input.dispatchKeyEvent",
                { type: "keyDown", key, code, windowsVirtualKeyCode: number },
                session,
              );
              await send(
                "Input.dispatchKeyEvent",
                { type: "keyUp", key, code, windowsVirtualKeyCode: number },
                session,
              );
            }
          }
          assert.equal(
            await evaluate("window.chatPosts"),
            0,
            "no keyboard MOTD send",
          );
          const point = await evaluate(
            `(() => { const r = document.querySelector('#sendButton').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
          );
          await send(
            "Input.dispatchMouseEvent",
            { type: "mousePressed", ...point, button: "left", clickCount: 1 },
            session,
          );
          await send(
            "Input.dispatchMouseEvent",
            { type: "mouseReleased", ...point, button: "left", clickCount: 1 },
            session,
          );
          assert.equal(
            await evaluate("window.chatPosts"),
            1,
            "native pointer click sends",
          );
          console.log(
            `MOTD observed ${width}x${height}: header ${result.nav.height}px, chat ${result.chat.width}x${result.chat.height}, page ${result.page}px`,
          );
        }
        assert.ok(
          Math.abs(result.image.width / result.image.height - 4 / 3) < 0.01,
          "consistent cropped aspect ratio even for a non-4:3 source",
        );
        if (!motd) {
          assert.equal(result.surface, result.panel);
          assert.equal(result.surface, "rgb(19, 31, 50)");
          assert.equal(result.headerSurface, "rgb(255, 180, 30)");
          assert.notEqual(result.headerSurface, result.surface);
          assert.equal(result.copyrightSize, result.linkSize);
          assert.equal(result.pickerAlignment, "center");
          if (width > 1200) {
            const center = (r) => (r.top + r.bottom) / 2;
            assert.ok(
              Math.abs(center(result.picker) - center(result.footerLinks)) < 2,
            );
            assert.ok(
              Math.abs(center(result.picker) - center(result.footerCopy)) < 2,
            );
          }
          assert.ok(
            Math.abs(
              (result.picker.left + result.picker.right) / 2 -
                result.footerCenter,
            ) < 1,
            "complete picker centered in footer content",
          );
          if (result.customSelect) {
            assert.equal(result.chevronAlignment, "center");
            assert.equal(result.selectAlignment, "center");
          }
        }
      }
      await send("Browser.close");
    } finally {
      socket?.close();
      if (chrome.exitCode === null) {
        const exited = new Promise((resolve) => chrome.once("exit", resolve));
        chrome.kill();
        await exited;
      }
      rmSync(profile, { recursive: true, force: true });
    }
  },
);
