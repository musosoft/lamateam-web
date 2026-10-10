import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = readFileSync(
  new URL("./LiveChat.astro", import.meta.url),
  "utf8",
);
const script = stripTypeScriptTypes(
  source.match(/<script>([\s\S]*?)<\/script>/)[1],
  { mode: "transform" },
);
class Element {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.text = "";
  }
  addEventListener(name, callback, options = {}) {
    if (options.signal?.aborted) return;
    const set = this.listeners.get(name) ?? new Set();
    set.add(callback);
    this.listeners.set(name, set);
    options.signal?.addEventListener("abort", () => set.delete(callback), {
      once: true,
    });
  }
  async emit(name, event = {}) {
    await Promise.all(
      [...(this.listeners.get(name) ?? [])].map((callback) => callback(event)),
    );
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.text = "";
    this.children = nodes;
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  getBoundingClientRect() {
    return this.box ?? { left: 0, right: 1, top: 0, bottom: 1 };
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("MOTD visual prompt is static rich text, non-interactive and separately described", () => {
  assert.match(
    source,
    /Click <b>Send<\/b> to chat\{' '\}\s*<span class="text-red-500">\s*not <kbd>Enter<\/kbd>\s*<\/span>/,
  );
  assert.match(
    source,
    /id="chat-game-prompt"[\s\S]*?aria-hidden="true"[\s\S]*?translate="no"/,
  );
  assert.match(
    source,
    /id="chat-game-instruction"[\s\S]*?Click Send to chat, not Enter\./,
  );
  assert.match(
    source,
    /<label for="messageInput" class="sr-only">\s*\{t\('Your message'\)\}/,
  );
  assert.match(source, /pointer-events: none/);
  assert.match(source, /input:not\(:placeholder-shown\) \+ \.chat-game-prompt/);
  assert.match(source, /\.chat-input-wrap \{\s*display: contents/);
  assert.match(source, /min-width: 0/);
  assert.match(source, /t\('Say hello to the team…'\)/);
  assert.doesNotMatch(source, /innerHTML|set:html/);
});

test("rich placeholder does not size the compose row or shrink the input", () => {
  assert.match(
    source,
    /\.chat-input-wrap\[data-rich-prompt='true'\] \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);\s*position: relative;\s*flex: 1 1 0%;\s*width: 0;\s*min-width: 0/,
  );
  assert.match(
    source,
    /\.chat-input-wrap\[data-rich-prompt='true'\] #messageInput \{\s*display: block;\s*width: 100%;\s*height: 100%/,
  );
  assert.match(
    source,
    /\.chat-game-prompt \{\s*position: absolute;\s*inset-inline: 0;/,
  );
  const styles = readFileSync(
    new URL("../assets/tailwind.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /\.chat-compose \{\s*display: flex;/);
  assert.match(
    styles,
    /\.is-game \.chat-compose input,\s*\.is-game \.chat-compose button \{\s*min-height: clamp\(44px/,
  );
  assert.match(source, /\.chat-input-wrap \{\s*display: contents;/);
});

function setup({
  authenticated = false,
  messages = [],
  post,
  get,
  userAgent = "Mozilla/5.0",
} = {}) {
  const document = new Element();
  document.visibilityState = "visible";
  const shell = new Element();
  shell.dataset = {
    copy: readFileSync(new URL("../lib/i18n/en.json", import.meta.url), "utf8"),
    locale: "en",
    baseUrl: "/",
    authenticated: String(authenticated),
    steamId: "fixture-user",
    playerName: "Fixture",
    playerAvatar: "/assets/default-avatar.webp",
    defaultOpen: "false",
  };
  const selectors = [
    "#live-chat-panel",
    "#chat-launcher",
    ".chat-close",
    "#messageInput",
    "#sendButton",
    "#shoutboxForm",
    "#shoutboxMessages",
    "#shoutbox-status",
    "#shoutbox-title",
    "#chat-game-prompt",
    "#chat-game-instruction",
    ".chat-input-wrap",
  ];
  const nodes = Object.fromEntries(
    selectors.map((selector) => [selector, new Element()]),
  );
  shell.querySelector = (selector) => nodes[selector];
  nodes["#messageInput"].dataset.gamePlaceholder = "Click Send to chat";
  nodes["#messageInput"].placeholder = "Say hello to the team…";
  shell.contains = (node) => Object.values(nodes).includes(node);
  nodes["#live-chat-panel"].querySelector = (selector) => nodes[selector];
  Object.values(nodes).forEach(
    (node) =>
      (node.focus = () => {
        document.activeElement = node;
      }),
  );
  document.querySelector = (selector) =>
    selector === "#live-chat-shell" ? shell : null;
  const created = [];
  document.createElement = (tag) => {
    const node = new Element();
    node.tag = tag;
    created.push(node);
    return node;
  };
  document.createTextNode = (text) => {
    const node = new Element();
    node.textContent = text;
    return node;
  };
  document.createDocumentFragment = () => new Element();
  const storage = new Map();
  const intervals = new Set();
  const calls = [];
  const context = {
    navigator: { userAgent },
    document,
    HTMLElement: Element,
    AbortController,
    URL,
    console,
    queueMicrotask,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: {
      setTimeout,
      clearTimeout,
      setInterval: (callback) => {
        intervals.add(callback);
        return callback;
      },
      clearInterval: (callback) => intervals.delete(callback),
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return options.method === "POST"
        ? await post(options)
        : get
          ? await get(options)
          : { ok: true, json: async () => messages };
    },
  };
  vm.runInNewContext(script, context);
  return { document, shell, nodes, calls, intervals, storage, created };
}

test("close/reopen persists preference and restores keyboard focus", async () => {
  const ui = setup();
  const panel = ui.nodes["#live-chat-panel"];
  assert.equal(panel.hidden, true);
  assert.equal(ui.calls.length, 0);
  await ui.nodes["#chat-launcher"].emit("click");
  await flush();
  assert.equal(panel.hidden, false);
  assert.equal(ui.document.activeElement, ui.nodes["#shoutbox-title"]);
  assert.equal(ui.storage.get("lamateam-chat-open"), "true");
  await panel.emit("keydown", { key: "Escape", stopPropagation() {} });
  assert.equal(panel.hidden, true);
  assert.equal(ui.document.activeElement, ui.nodes["#chat-launcher"]);
  assert.equal(ui.storage.get("lamateam-chat-open"), "false");
  await ui.document.emit("astro:before-swap");
  await ui.document.emit("astro:page-load");
  assert.equal(panel.hidden, true);
  assert.equal(ui.intervals.size, 1);
  assert.equal(ui.nodes["#shoutboxForm"].listeners.get("submit").size, 1);
});

test("Valve preserves a closed sidebar across Astro route changes", async () => {
  const ui = setup({ userAgent: "Valve Client" });
  const panel = ui.nodes["#live-chat-panel"];
  assert.equal(panel.hidden, false);
  await ui.nodes[".chat-close"].emit("click");
  assert.equal(ui.storage.get("lamateam-chat-open"), "false");
  await ui.document.emit("astro:before-swap");
  await ui.document.emit("astro:page-load");
  assert.equal(panel.hidden, true);
  assert.equal(ui.nodes["#messageInput"].placeholder, " ");
  await ui.nodes["#chat-launcher"].emit("click");
  assert.equal(panel.hidden, false);
});

test("shared chat keeps Steam payload, guards duplicate posts, and renders user content as text", async () => {
  let resolvePost;
  const ui = setup({
    authenticated: true,
    messages: [
      {
        player_name: "<script>name</script>",
        message: "<img onerror=alert(1)>",
        player_avatar: "javascript:alert(1)",
        timestamp: "2026-10-07T00:00:00Z",
      },
    ],
    post: () =>
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
  });
  await ui.nodes["#chat-launcher"].emit("click");
  await flush();
  assert.match(ui.nodes["#shoutboxMessages"].textContent, /<img onerror/);
  assert.equal(
    ui.created.find((node) => node.tag === "img").src,
    "/assets/default-avatar.webp",
  );
  ui.nodes["#messageInput"].value = "Hello";
  const event = { preventDefault() {} };
  const pending = ui.nodes["#shoutboxForm"].emit("submit", event);
  await flush();
  await ui.nodes["#shoutboxForm"].emit("submit", event);
  const posts = ui.calls.filter(({ options }) => options.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/shoutbox");
  assert.equal(posts[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    steamid: "fixture-user",
    player_name: "Fixture",
    player_avatar: "/assets/default-avatar.webp",
    message: "Hello",
  });
  resolvePost({ ok: true });
  await pending;
  await flush();
  assert.equal(ui.nodes["#messageInput"].value, "");
  assert.equal(ui.nodes["#shoutbox-status"].textContent, "Message sent.");
});

test("navigation aborts pending requests and removes scoped listeners and polling", async () => {
  const ui = setup({
    get: (options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("Aborted")),
          { once: true },
        ),
      ),
  });
  await ui.nodes["#chat-launcher"].emit("click");
  await flush();
  await ui.document.emit("astro:before-swap");
  await flush();
  assert.equal(ui.calls[0].options.signal.aborted, true);
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.nodes["#shoutboxForm"].listeners.get("submit").size, 0);
});

test("guest posting stays disabled and offline loading never claims success", async () => {
  const ui = setup({
    get: async () => {
      throw new Error("Offline");
    },
  });
  assert.equal(ui.nodes["#sendButton"].disabled, true);
  await ui.nodes["#chat-launcher"].emit("click");
  await flush();
  assert.match(ui.nodes["#shoutboxMessages"].textContent, /unavailable/);
  ui.nodes["#messageInput"].value = "Attempt";
  await ui.nodes["#shoutboxForm"].emit("submit", { preventDefault() {} });
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    0,
  );
});

test("Valve uses a rich prompt; Enter is guarded but typed spaces and browser Enter are unchanged", async () => {
  for (const userAgent of ["Valve Steam", "Mozilla/5.0"]) {
    const ui = setup({ authenticated: true, userAgent });
    const input = ui.nodes["#messageInput"];
    assert.equal(
      input.placeholder,
      userAgent === "Valve Steam" ? " " : "Say hello to the team…",
    );
    assert.equal(
      ui.nodes["#live-chat-panel"].hidden,
      userAgent === "Mozilla/5.0",
    );
    await input.emit("focus");
    let prevented = false;
    await input.emit("keydown", {
      key: " ",
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
    await input.emit("keydown", {
      key: "Enter",
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, userAgent === "Valve Steam");
    assert.equal(
      ui.calls.filter(({ options }) => options.method === "POST").length,
      0,
    );
    await ui.document.emit("astro:before-swap");
    assert.equal(input.listeners.get("keydown").size, 0);
  }
});

test("rich prompt tracks text, clearing, focus, drafts and successful send without affecting web", async () => {
  for (const userAgent of ["Valve Client", "Mozilla/5.0"]) {
    const ui = setup({
      authenticated: true,
      userAgent,
      post: async () => ({ ok: true }),
    });
    const game = userAgent === "Valve Client";
    const input = ui.nodes["#messageInput"];
    const prompt = ui.nodes["#chat-game-prompt"];
    assert.equal(prompt.hidden, !game);
    assert.equal(ui.nodes["#chat-game-instruction"].hidden, !game);
    assert.equal(ui.nodes[".chat-input-wrap"].dataset.richPrompt, String(game));
    if (game) assert.equal(input["aria-describedby"], "chat-game-instruction");
    input.focus();
    assert.equal(
      prompt.hidden,
      !game,
      "empty focused input retains instruction",
    );
    input.value = " ";
    await input.emit("input");
    assert.equal(prompt.hidden, true, "even a typed space hides the overlay");
    input.value = "";
    await input.emit("input");
    assert.equal(prompt.hidden, !game);
    input.value = "Draft";
    await input.emit("change");
    await ui.document.emit("astro:before-swap");
    await ui.document.emit("astro:page-load");
    assert.equal(input.value, "Draft");
    assert.equal(
      prompt.hidden,
      true,
      "persisted drafts never overlap the prompt",
    );
    for (const click of ui.nodes["#sendButton"].listeners.get("click"))
      click({ detail: 1 });
    await ui.nodes["#shoutboxForm"].emit("submit", { preventDefault() {} });
    assert.equal(input.value, "");
    assert.equal(
      prompt.hidden,
      !game,
      "successful send restores the game prompt only",
    );
    if (!game) assert.equal(input.placeholder, "Say hello to the team…");
    await ui.document.emit("astro:before-swap");
    assert.equal(input.listeners.get("input").size, 0);
  }
});

test("Valve blocks Enter/Space on Send and implicit submission, while click sends; navigation cleans listeners", async () => {
  const ui = setup({
    authenticated: true,
    userAgent: "Valve Steam",
    post: async () => ({ ok: true }),
  });
  const send = ui.nodes["#sendButton"];
  ui.nodes["#messageInput"].value = "Hello world";
  for (const key of ["Enter", " ", "Spacebar"]) {
    let prevented = false;
    await send.emit("keydown", {
      key,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
  await ui.nodes["#shoutboxForm"].emit("submit", { preventDefault() {} });
  assert.equal(ui.calls.filter((c) => c.options.method === "POST").length, 0);
  // Browser dispatches click's default form submission before microtasks.
  for (const click of send.listeners.get("click")) click({ detail: 1 });
  await ui.nodes["#shoutboxForm"].emit("submit", { preventDefault() {} });
  assert.equal(ui.calls.filter((c) => c.options.method === "POST").length, 1);
  await ui.nodes[".chat-close"].emit("click");
  await ui.document.emit("astro:before-swap");
  await ui.document.emit("astro:page-load");
  assert.equal(ui.nodes["#live-chat-panel"].hidden, true);
  await ui.document.emit("astro:before-swap");
  assert.equal(send.listeners.get("keydown").size, 0);
  assert.equal(send.listeners.get("click").size, 0);
});

test(
  "rendered rich prompt fits small MOTDs, clicks through and disappears while typing; web remains plain",
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
    try {
      for (const userAgent of ["Valve Client", "Mozilla/5.0 Chromium"]) {
        const context = await browser.newContext({ userAgent });
        const page = await context.newPage();
        let posts = 0;
        await page.route("**/api/shoutbox", (route) => {
          if (route.request().method() === "POST") posts++;
          return route.fulfill({ json: [] });
        });
        for (const width of [390, 700, 1920]) {
          await page.setViewportSize({
            width,
            height: width === 700 ? 400 : 1080,
          });
          await page.goto(
            `${process.env.LAMATEAM_UI_URL}/?communityid=76561197960265729&name=PromptFixture`,
          );
          if (await page.locator("#chat-launcher").isVisible())
            await page.locator("#chat-launcher").click();
          const input = page.locator("#messageInput");
          const prompt = page.locator("#chat-game-prompt");
          if (userAgent === "Valve Client") {
            await prompt.waitFor({ state: "visible" });
            assert.equal(
              (await prompt.textContent()).replace(/\s+/g, " ").trim(),
              "Click Send to chat not Enter",
            );
            assert.equal(await prompt.locator("b").textContent(), "Send");
            assert.equal(
              await prompt.locator(".text-red-500 kbd").textContent(),
              "Enter",
            );
            assert.equal(
              await input.getAttribute("aria-describedby"),
              "chat-game-instruction",
            );
            const geometry = await prompt.evaluate((node) => {
              const box = node.getBoundingClientRect();
              const input = document
                .querySelector("#messageInput")
                .getBoundingClientRect();
              return {
                fits:
                  box.left >= input.left &&
                  box.right <= input.right + 1 &&
                  box.top >= input.top &&
                  box.bottom <= input.bottom + 1,
                pointerEvents: getComputedStyle(node).pointerEvents,
                available: (() => {
                  const form = node.closest("form");
                  const css = getComputedStyle(form);
                  const width =
                    form.getBoundingClientRect().width -
                    parseFloat(css.paddingLeft) -
                    parseFloat(css.paddingRight) -
                    parseFloat(css.columnGap) -
                    document
                      .querySelector("#sendButton")
                      .getBoundingClientRect().width;
                  return Math.abs(input.width - width) < 2;
                })(),
                red: getComputedStyle(node.querySelector(".text-red-500"))
                  .color,
              };
            });
            assert.equal(geometry.fits, true);
            assert.equal(geometry.available, true);
            assert.equal(geometry.pointerEvents, "none");
            assert.equal(geometry.red, "rgb(239, 68, 68)");
            const box = await prompt.boundingBox();
            await page.mouse.click(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            assert.equal(
              await input.evaluate((node) => node === document.activeElement),
              true,
            );
            await input.fill("Hello world");
            assert.equal(await prompt.isVisible(), false);
            const before = posts;
            await input.press("Enter");
            assert.equal(posts, before);
            await page.locator("#sendButton").click();
            await page.waitForFunction(
              () => document.querySelector("#messageInput").value === "",
            );
            await prompt.waitFor({ state: "visible" });
            assert.equal(posts, before + 1);
          } else {
            assert.equal(await prompt.isVisible(), false);
            assert.equal(
              await input.getAttribute("placeholder"),
              "Sign in with Steam to chat",
            );
            assert.equal(await input.getAttribute("aria-describedby"), null);
            assert.equal(await input.isDisabled(), true);
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
