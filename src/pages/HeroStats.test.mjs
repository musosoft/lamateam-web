import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./index.astro", import.meta.url), "utf8");
const script = source.match(
  /<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/,
)[1];
const stats = {
  rank: 12,
  skill: 1800,
  kills: 80,
  deaths: 40,
  kpd: 2,
  headshots: 20,
  accuracy: 32.5,
};

class Element {
  children = [];
  dataset = {};
  style = {};
  hidden = true;
  textContent = "";
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute(key, value) {
    this[key] = value;
  }
}

async function setup(
  response,
  { lang = "en", present = true, pending = false } = {},
) {
  const root = new Element();
  const title = new Element();
  const list = new Element();
  root.querySelector = (selector) => (selector === "dl" ? list : title);
  const listeners = new Map();
  let requests = 0;
  let request;
  let disconnected = false;
  let resolve;
  const document = {
    documentElement: { lang },
    querySelector: () => (present ? root : null),
    createElement: () => new Element(),
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: (key) => listeners.delete(key),
  };
  const context = {
    document,
    Intl,
    AbortController,
    MutationObserver: class {
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    fetch: async (url, options) => {
      requests++;
      request = { url, options };
      if (pending)
        return new Promise((done) => {
          resolve = done;
        });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  runInNewContext(script, context);
  await new Promise(setImmediate);
  return {
    root,
    title,
    list,
    listeners,
    context,
    get requests() {
      return requests;
    },
    get request() {
      return request;
    },
    get disconnected() {
      return disconnected;
    },
    resolve: () => resolve(response),
  };
}
const ok = (values = stats) => ({
  status: 200,
  json: async () => ({
    available: true,
    stats: values,
    identity: "<img onerror=alert(1)>",
  }),
});

test("snapshot renders real same-unit bars, accessible labels and percentage points only", async () => {
  const ui = await setup(ok());
  assert.equal(ui.root.hidden, false);
  assert.equal(ui.list.children.length, 7);
  assert.equal(ui.list.children[0].children[1].textContent, "80");
  assert.equal(ui.list.children[0].children[1].children[0].style.width, "100%");
  assert.equal(ui.list.children[1].children[1].children[0].style.width, "50%");
  assert.equal(
    ui.list.children[1].children[1].children[0]["aria-hidden"],
    "true",
  );
  assert.equal(ui.list.children[5].children[1].textContent, "32.5%");
  assert.equal(ui.list.children[2].children[1].children.length, 0);
  assert.ok(!JSON.stringify(ui.root).includes("onerror"));
  assert.equal(ui.request.url, "/api/stats/me");
  assert.equal(ui.request.options.method, "GET");
  assert.equal(ui.request.options.credentials, "same-origin");
  assert.equal(ui.request.options.cache, "no-store");
  assert.ok(!JSON.stringify(ui.request).includes("identity"));
});

test("failures and untrusted/non-numeric values never invent or inject stats", async () => {
  for (const response of [
    ...[401, 404, 503].map((status) => ({
      status,
      json: () => assert.fail("must not parse failures"),
    })),
    new Error("offline"),
    { status: 200, json: async () => ({ available: false, stats }) },
    {
      status: 200,
      json: async () => {
        throw new Error("invalid JSON");
      },
    },
    ok({ ...stats, kills: "<img onerror=alert(1)>" }),
    ok({ ...stats, accuracy: 101 }),
    ok({ ...stats, skill: Infinity }),
    ok(Object.fromEntries(Object.keys(stats).map((key) => [key, null]))),
  ]) {
    const ui = await setup(response);
    assert.equal(ui.root.hidden, true);
    assert.equal(ui.list.children.length, 0);
  }
});

test("null values are omitted, real zeros remain zero, missing pair has no bar", async () => {
  const ui = await setup(ok({ ...stats, kills: 0, deaths: null }));
  assert.equal(ui.list.children.length, 6);
  assert.equal(ui.list.children[0].children[1].textContent, "0");
  assert.equal(ui.list.children[0].children[1].children.length, 0);
});

test("one fetch per hero, no anonymous fetch, swap aborts and removes observers/listeners", async () => {
  const anonymous = await setup(ok(), { present: false });
  assert.equal(anonymous.requests, 0);
  const ui = await setup(ok(), { pending: true });
  runInNewContext(script, ui.context);
  assert.equal(ui.requests, 1);
  ui.listeners.get("astro:before-swap")();
  assert.equal(ui.request.options.signal.aborted, true);
  assert.equal(ui.disconnected, true);
  assert.equal(ui.listeners.size, 0);
  ui.resolve();
  await new Promise(setImmediate);
  assert.equal(ui.root.hidden, true);
});

test("all eight locales have labels; static visualization needs no motion exception", async () => {
  for (const lang of ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"]) {
    const ui = await setup(ok(), { lang });
    assert.ok(ui.title.textContent.includes("HLstatsX"));
    assert.ok(ui.list.children.every((row) => row.children[0].textContent));
  }
  assert.match(source, /<dl class="hero-stats-values"/);
  assert.match(source, /max-width: 24rem/);
  assert.ok(!script.includes("innerHTML") && !script.includes("setInterval"));
  const css = source.slice(
    source.indexOf(".hero-stats[hidden]"),
    source.indexOf(".hero-connect {"),
  );
  assert.ok(!/animation|transition/.test(css));
});
