import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { clientTranslator } from "../lib/client-copy.ts";
import { clientCopy } from "../lib/page-copy.ts";

const source = readFileSync(
  new URL("../components/MapRatings.astro", import.meta.url),
  "utf8",
);
const mapsPage = readFileSync(new URL("./maps.astro", import.meta.url), "utf8");
const script = stripTypeScriptTypes(
  source
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import \{ clientTranslator \} from '[^']+';/, ""),
  { mode: "transform" },
);
class Element {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.classList = new Set();
    this.attributes = new Set();
    this.attributeValues = new Map();
  }
  addEventListener(name, callback, options = {}) {
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
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  insertBefore(node, reference) {
    const index =
      reference === null
        ? this.children.length
        : this.children.indexOf(reference);
    if (index < 0) throw new Error("Insertion reference is not a child");
    this.children.splice(index, 0, node);
    return node;
  }
  setAttribute(name, value) {
    this.attributes.add(name);
    this.attributeValues.set(name, String(value));
  }
  contains(node) {
    return this.children.includes(node);
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  querySelectorAll() {
    return this.children.filter((node) => node.dataset.mapRating);
  }
  querySelector() {
    return this.querySelectorAll()[0];
  }
}
class Input extends Element {}
class Form extends Element {}
function createCard(map) {
  const card = new Element();
  card.dataset.mapRating = map;
  const form = new Form();
  form.closest = () => card;
  const inputs = [1, 2, 3, 4, 5].map((value) => {
    const input = new Input();
    input.value = String(value);
    input.checked = false;
    input.closest = (selector) => (selector === "form" ? form : card);
    return input;
  });
  const stars = [1, 2, 3, 4, 5].map((value) => {
    const star = new Element();
    star.dataset.star = String(value);
    const symbol = new Element();
    symbol.style = {
      setProperty(name, fill) {
        this[name] = fill;
      },
    };
    star.querySelector = (selector) =>
      selector === ".star-symbol" ? symbol : null;
    return star;
  });
  const fields = Object.fromEntries(
    [
      "fieldset",
      ".rating-save",
      "[data-rating-sign-in]",
      "[data-rating-summary]",
      "[data-rating-count]",
      "[data-community-summary]",
      ".rating-stars",
      "[data-rating-feedback]",
      "img",
    ].map((selector) => [selector, new Element()]),
  );
  fields.form = form;
  form.append(fields.fieldset);
  form.setAttribute = (name, value) => {
    form[name] = value;
  };
  card.querySelector = (selector) =>
    selector === "input:checked"
      ? (inputs.find((input) => input.checked) ?? null)
      : selector === ".random-community-rating"
        ? form.children.find(
            (node) => node.className === "random-community-rating",
          )
        : fields[selector];
  card.querySelectorAll = (selector) =>
    selector === "[data-star]" ? stars : inputs;
  form.querySelector = card.querySelector;
  card.form = form;
  card.inputs = inputs;
  card.fields = fields;
  card.cloneNode = () => createCard(map);
  return card;
}
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("maps page passes community identity only to the in-game rating UI", () => {
  assert.match(
    mapsPage,
    /isGameUserAgent\(Astro\.request\.headers\.get\('user-agent'\)\)/,
  );
  assert.match(mapsPage, /Astro\.url\.searchParams\.get\('communityid'\)/);
  assert.match(mapsPage, /Astro\.cookies\.get\('communityid'\)\?\.value/);
  assert.match(
    mapsPage,
    /const communityId = isGame \? rawCommunityId\.slice\(0, 32\) : ''/,
  );
  assert.match(mapsPage, /motdPrompt=\{isGame\}/);
  assert.match(mapsPage, /communityId=\{communityId\}/);
  assert.doesNotMatch(mapsPage, /<MapRatings[^>]*compact|unratedOnly/s);
});

function setup({ authenticated = true, unavailable = false, post } = {}) {
  const root = new Element();
  root.dataset.copy = JSON.stringify({
    ...clientCopy("en"),
    Rate: "Rate",
    "Thanks for rating!": "Thanks for rating!",
    "Your rating · {rating} / 5": "Your rating · {rating} / 5",
    "Your rating · Not rated yet.": "Your rating · Not rated yet.",
    "{count} ratings": "{count} ratings",
    "Community rating · {average} / 5": "Community rating · {average} / 5",
  });
  const grid = new Element();
  const preview = new Element();
  const skip = new Element();
  const next = new Element();
  const status = new Element();
  const retry = new Element();
  const announcement = new Element();
  const cards = ["de_dust2", "de_nuke", "cs_office"].map(createCard);
  grid.children = cards;
  const selectors = {
    "#map-ratings-root": root,
    "#rated-map-grid": grid,
    "#random-map-preview": preview,
    "#random-map-skip": skip,
    "#random-map-next": next,
    "#map-ratings-status": status,
    "#map-ratings-retry": retry,
    "#random-map-announcement": announcement,
  };
  const document = new Element();
  document.createElement = (tag) => {
    const element = new Element();
    element.tagName = tag.toUpperCase();
    return element;
  };
  document.querySelector = (selector) => selectors[selector];
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const ratings = cards.map((card) => ({
    map: card.dataset.mapRating,
    average: 3.5,
    count: 10,
    userRating: null,
  }));
  vm.runInNewContext(script, {
    clientTranslator,
    document,
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLFormElement: Form,
    AbortController,
    window: {
      setTimeout(callback, delay) {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      addEventListener() {},
    },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return options.method === "POST"
        ? await post(options)
        : unavailable
          ? response(null, 503)
          : response({ authenticated, canRate: authenticated, ratings });
    },
  });
  return {
    root,
    cards,
    preview,
    skip,
    next,
    status,
    calls,
    document,
    advance() {
      for (const [id, timer] of timers) {
        if (timer.delay !== 1100) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    timers,
    choose(card, stars) {
      card.inputs.forEach(
        (input) => (input.checked = Number(input.value) === stars),
      );
      return root.emit("change", { target: card.inputs[stars - 1] });
    },
    submit(card) {
      return root.emit("submit", { target: card.form, preventDefault() {} });
    },
  };
}

test("random-map skip exhausts the pool without repeat or a vote", async () => {
  const ui = setup();
  const card = ui.preview.children[0];
  const label = card.querySelector(".random-community-rating");
  assert.equal(label.tagName, "P");
  assert.equal(label.attributeValues.get("translate"), "no");
  assert.equal(label.attributeValues.get("data-no-translate"), "");
  assert.ok(
    card.form.children.indexOf(label) <
      card.form.children.indexOf(card.fields.fieldset),
  );
  await flush();
  const selected = [];
  for (let i = 0; i < 3; i++) {
    selected.push(ui.preview.children[0].dataset.mapRating);
    await ui.skip.emit("click");
  }
  assert.equal(new Set(selected).size, 3);
  assert.notEqual(ui.preview.children[0].dataset.mapRating, selected.at(-1));
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    0,
  );
});

test("random-map save shares the gallery flow and locks duplicate/skip actions", async () => {
  let finish;
  const ui = setup({
    post: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await flush();
  const random = ui.preview.children[0];
  const map = random.dataset.mapRating;
  const gallery = ui.cards.find((card) => card.dataset.mapRating === map);
  await ui.choose(random, 5);
  assert.doesNotMatch(
    random.fields["[data-rating-feedback]"].textContent,
    /Thanks/,
  );
  ui.advance();
  assert.equal(ui.preview.children[0], random);
  const pending = ui.submit(random);
  await flush();
  assert.equal(ui.skip.disabled, true);
  assert.equal(gallery.fields.fieldset.disabled, true);
  await ui.skip.emit("click");
  await ui.submit(random);
  assert.equal(ui.preview.children[0], random);
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    1,
  );
  const options = ui.calls.find(
    ({ options }) => options.method === "POST",
  ).options;
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { map, stars: 5 });
  finish(
    response({
      map,
      average: 3.6,
      count: 11,
      userRating: 5,
      authenticated: true,
      canRate: true,
    }),
  );
  await pending;
  await flush();
  assert.equal(
    random.fields["[data-rating-summary]"].textContent,
    gallery.fields["[data-rating-summary]"].textContent,
  );
  assert.match(random.fields["[data-rating-count]"].textContent, /11 ratings/);
  assert.equal(gallery.inputs[4].checked, true);
  assert.equal(random.fields.fieldset.disabled, true);
  assert.equal(ui.skip.disabled, true);
  assert.match(
    random.fields["[data-rating-feedback]"].textContent,
    /Thanks for rating/,
  );
  assert.ok(
    random.fields["[data-rating-feedback]"].classList.has("rating-thanks"),
  );
  assert.equal(ui.preview.children[0], random);
  await ui.skip.emit("click");
  assert.equal(ui.preview.children[0], random);
  ui.advance();
  assert.notEqual(ui.preview.children[0].dataset.mapRating, map);
  assert.equal(ui.preview.children[0].fields.fieldset.disabled, false);
  assert.equal(gallery.fields.fieldset.disabled, false);
  assert.equal(ui.skip.disabled, false);
});

test("homepage and maps share the widget; metadata never enters its pool", () => {
  for (const page of ["index", "maps"]) {
    const markup = readFileSync(
      new URL(`./${page}.astro`, import.meta.url),
      "utf8",
    );
    assert.match(markup, /<MapRatings/);
  }
  assert.match(source, /item\.map !== ['"]min_players['"]/);
  assert.doesNotMatch(source, /class="rating-save"/);
});

test("choosing a star saves immediately and choosing the saved value does not vote twice", async () => {
  let posts = 0;
  const ui = setup({
    post: async (options) => {
      posts++;
      const { map, stars } = JSON.parse(options.body);
      return response({
        map,
        average: stars,
        count: 1,
        userRating: stars,
        authenticated: true,
        canRate: true,
      });
    },
  });
  await flush();
  const card = ui.preview.children[0];
  await ui.choose(card, 4);
  await flush();
  assert.equal(posts, 1);
  assert.equal(card.inputs[3].checked, true);
  await ui.choose(card, 4);
  await flush();
  assert.equal(posts, 1);
});

test("random widget preserves gallery unauthenticated and unavailable states", async () => {
  let ui = setup({ authenticated: false });
  await flush();
  let card = ui.preview.children[0];
  assert.equal(card.fields.fieldset.disabled, true);
  assert.equal(card.fields["[data-rating-sign-in]"].hidden, false);
  await ui.choose(card, 4);
  await ui.submit(card);
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    0,
  );
  ui = setup({ unavailable: true });
  await flush();
  card = ui.preview.children[0];
  assert.equal(card.fields.fieldset.disabled, true);
  assert.equal(
    card.fields["[data-rating-summary]"].textContent,
    "Ratings unavailable.",
  );
  assert.equal(card.fields["[data-rating-summary]"].hidden, true);
  await ui.skip.emit("click");
  assert.equal(ui.preview.children[0].fields.fieldset.disabled, true);
  assert.equal(
    ui.preview.children[0].fields["[data-rating-summary]"].hidden,
    true,
  );
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    0,
  );
});

test("random map copy stays concise and skip follows the preview", () => {
  const markup = source.split("<style>")[0];
  for (const removed of [
    "Rate a random map if you know it.",
    "Never played it? Skip",
    "Another map",
    "Selected map:",
  ])
    assert.ok(!markup.includes(removed));
  assert.ok(
    markup.indexOf('id="random-map-skip"') >
      markup.indexOf('id="random-map-preview"'),
  );
  assert.ok(markup.includes("t('Never played')"));
  assert.ok(!source.includes("retry.hidden = false"));
  assert.ok(markup.includes("hidden={!compact || mapCards.length === 0}"));
  assert.match(markup, /type="button" id="random-map-skip"/);
  assert.ok(source.includes(".map-ratings-panel > :not(.sr-only)"));
});

test("the decision row places skip beside, not inside, the disabled rating fieldset", async () => {
  const ui = setup({ authenticated: false });
  await flush();
  const card = ui.preview.children[0];
  assert.ok(card.form.children.includes(ui.skip));
  assert.equal(card.fields.fieldset.disabled, true);
  assert.equal(ui.skip.disabled, false);
  await ui.skip.emit("click");
  assert.ok(ui.preview.children[0].form.children.includes(ui.skip));
  assert.equal(
    ui.calls.filter(({ options }) => options.method === "POST").length,
    0,
  );
});

test("a failed direct save rolls back selection so the same star can retry", async () => {
  let posts = 0;
  const ui = setup({
    post: async (options) => {
      posts++;
      if (posts === 1) return response(null, 503);
      const { map, stars } = JSON.parse(options.body);
      return response({
        map,
        average: stars,
        count: 1,
        userRating: stars,
        authenticated: true,
        canRate: true,
      });
    },
  });
  await flush();
  const card = ui.preview.children[0];
  await ui.choose(card, 4);
  await flush();
  assert.ok(card.inputs.every((input) => !input.checked));
  assert.match(
    card.fields["[data-rating-feedback]"].textContent,
    /Could not confirm/,
  );
  assert.equal(card.fields.fieldset.disabled, false);
  assert.equal(ui.skip.disabled, false);
  ui.advance();
  assert.equal(ui.preview.children[0], card);
  assert.doesNotMatch(
    card.fields["[data-rating-feedback]"].textContent,
    /Thanks/,
  );
  await ui.choose(card, 4);
  await flush();
  assert.equal(posts, 2);
  assert.equal(card.inputs[3].checked, true);
});

test("navigation cleanup cancels pending thank-you advancement", async () => {
  const ui = setup({
    post: async (options) => {
      const { map, stars } = JSON.parse(options.body);
      return response({
        map,
        average: stars,
        count: 1,
        userRating: stars,
        authenticated: true,
        canRate: true,
      });
    },
  });
  await flush();
  const card = ui.preview.children[0];
  await ui.choose(card, 5);
  await flush();
  await ui.document.emit("astro:before-swap");
  assert.equal(ui.timers.size, 0);
  ui.advance();
  assert.equal(ui.preview.children[0], card);
});
