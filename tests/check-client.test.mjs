import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/scripts/check/client.ts", import.meta.url),
  "utf8",
);
const id = (n) => String(76561198000000000n + BigInt(n));
const settle = () => new Promise((resolve) => setImmediate(resolve));

function element(tagName = "div") {
  return {
    tagName,
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    attributes: {},
    events: {},
    addEventListener(name, handler) {
      this.events[name] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    focus() {},
  };
}

function mount(respond) {
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const root = element();
  root.querySelector = get;
  root.querySelectorAll = () =>
    get("[data-check-players]").children.flatMap((row) =>
      row.children.filter((child) => child.tagName === "button"),
    );
  const events = {};
  const calls = [];
  let tick;
  const context = {
    exports: {},
    AbortController,
    AbortSignal,
    Date,
    fetch: async (path, options) => {
      calls.push({ path, ...options });
      return respond(path, options);
    },
    window: {
      setInterval: (handler) => {
        tick = handler;
        return 1;
      },
      clearInterval() {},
    },
    document: {
      documentElement: { lang: "en" },
      querySelector: () => root,
      createElement: element,
      addEventListener: (name, handler) => {
        events[name] = handler;
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    context,
  );
  events["astro:page-load"]();
  return {
    get,
    calls,
    buttons: () => root.querySelectorAll(),
    events,
    tick: () => tick(),
  };
}
const ok = (value) => ({ ok: true, json: async () => value });
const snapshot = (players) => ({ observedAt: Date.now(), players });

test("public Steam display names remain text and keep the canonical ID visible", async () => {
  const page = mount(() =>
    ok(
      snapshot([
        {
          communityId: id(1),
          displayName: "<img src=x onerror=alert(1)>",
          lastSeen: Date.now(),
        },
      ]),
    ),
  );
  await settle();
  const info = page.get("[data-check-players]").children[0].children[0];
  assert.equal(info.children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(info.children[1].textContent, id(1));
  assert.equal(page.calls.length, 1);
});

test("loads only the latest 30 API identities, newest first, without lookups or raw fields", async () => {
  const page = mount(() =>
    ok(
      snapshot(
        Array.from({ length: 35 }, (_, n) => ({
          communityId: id(n),
          lastSeen: Date.now() - (35 - n) * 1000,
          name: "DO NOT DISPLAY",
          raw: "private log",
        })),
      ),
    ),
  );
  await settle();
  assert.deepEqual(
    page.calls.map((call) => call.path),
    ["/api/check/players"],
  );
  const rows = page.get("[data-check-players]").children;
  assert.equal(rows.length, 30);
  assert.equal(rows[0].children[0].children[0].textContent, id(34));
  assert.equal(rows[29].children[0].children[0].textContent, id(5));
  assert.doesNotMatch(JSON.stringify(rows), /DO NOT DISPLAY|private log/);
  assert.ok(rows.every((row) => row.children.length === 1));
  assert.equal(page.calls[0].method, "GET");
  assert.equal(page.calls[0].body, undefined);
});

test("refresh suppresses concurrent list requests and never submits data", async () => {
  let finish;
  const page = mount(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await settle();
  page.get("[data-check-refresh]").events.click();
  page.get("[data-check-refresh]").events.click();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].path, "/api/check/players");
  assert.equal(page.calls[0].body, undefined);
  assert.equal(page.get("[data-check-refresh]").disabled, true);
  finish({ ok: false, status: 429 });
  await settle();
  assert.match(
    page.get("[data-check-players-status]").textContent,
    /Too many requests/,
  );
  assert.equal(page.get("[data-check-refresh]").disabled, false);
});

test("handles empty, malformed, failed and rate-limited list responses", async () => {
  for (const [response, expected] of [
    [ok(snapshot([])), /No recent players/],
    [
      ok(snapshot([{ communityId: "invalid", lastSeen: Date.now() }])),
      /Could not load/,
    ],
    [{ ok: false, status: 503 }, /Could not load/],
    [{ ok: false, status: 429 }, /Too many requests/],
  ]) {
    const page = mount(() => response);
    assert.match(
      page.get("[data-check-players-status]").textContent,
      /Loading/,
    );
    await settle();
    assert.match(page.get("[data-check-players-status]").textContent, expected);
    assert.equal(page.get("[data-check-refresh]").disabled, false);
    assert.equal(
      page.get("[data-check-players]").attributes["aria-busy"],
      "false",
    );
    assert.equal(page.buttons().length, 0);
  }
});

test("null observedAt is an empty state only when the backend players list is empty", async () => {
  const page = mount(() => ok({ observedAt: null, players: [] }));
  await settle();
  assert.match(
    page.get("[data-check-players-status]").textContent,
    /No recent players/,
  );
  assert.equal(
    page.get("[data-check-observed]").textContent,
    "No recent observations available.",
  );
  assert.equal(page.get("[data-check-stale]").hidden, true);
  assert.equal(page.get("[data-check-refresh]").disabled, false);
  assert.equal(page.buttons().length, 0);
  assert.equal(page.calls.length, 1);

  const invalid = mount(() =>
    ok({
      observedAt: null,
      players: [{ communityId: id(1), lastSeen: Date.now() }],
    }),
  );
  await settle();
  assert.match(
    invalid.get("[data-check-players-status]").textContent,
    /Could not load/,
  );
  assert.equal(invalid.buttons().length, 0);
});

test("failed refresh keeps the last list with a stale warning and never searches", async () => {
  let fail = false;
  const page = mount(() =>
    fail
      ? { ok: false, status: 503 }
      : ok(snapshot([{ communityId: id(1), lastSeen: Date.now() }])),
  );
  await settle();
  fail = true;
  page.get("[data-check-refresh]").events.click();
  await settle();
  assert.equal(page.get("[data-check-players]").children.length, 1);
  assert.equal(page.buttons().length, 0);
  assert.equal(page.get("[data-check-stale]").hidden, false);
  assert.ok(page.calls.every((call) => call.path === "/api/check/players"));
});

test("stale lists refresh manually, clear their stale state and never poll", async () => {
  let observedAt = Date.now() - 121_000;
  const page = mount(() =>
    ok({ observedAt, players: [{ communityId: id(1), lastSeen: observedAt }] }),
  );
  await settle();
  assert.equal(page.get("[data-check-stale]").hidden, false);
  page.tick();
  assert.equal(page.calls.length, 1);
  observedAt = Date.now();
  page.get("[data-check-refresh]").events.click();
  await settle();
  assert.equal(page.get("[data-check-stale]").hidden, true);
  assert.match(page.get("[data-check-observed]").textContent, /Last updated:/);
  assert.equal(page.calls.length, 2);
  page.events["astro:page-load"]();
  assert.equal(page.calls.length, 2);
  page.events["astro:before-swap"]();
  assert.equal(page.calls[0].signal.aborted, true);
  page.get("[data-check-refresh]").events.click();
  assert.equal(page.calls.length, 2);
});
