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
  assert.equal(ui.nodes["#messageInput"].placeholder, "Click Send to chat");
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

test("Valve uses the short placeholder; Enter is guarded but typed spaces and browser Enter are unchanged", async () => {
  for (const userAgent of ["Valve Steam", "Mozilla/5.0"]) {
    const ui = setup({ authenticated: true, userAgent });
    const input = ui.nodes["#messageInput"];
    assert.equal(
      input.placeholder,
      userAgent === "Valve Steam"
        ? "Click Send to chat"
        : "Say hello to the team…",
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
