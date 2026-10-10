import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./MapRatings.astro");
const evaluate = (context, start, end, name) =>
  vm.runInContext(
    stripTypeScriptTypes(
      source
        .slice(
          source.indexOf(start),
          source.indexOf(end, source.indexOf(start)),
        )
        .replace(`const ${name}`, `globalThis.${name}`),
      { mode: "transform" },
    ),
    context,
  );
const rating = (map, userRating = null) => ({
  map,
  userRating,
  average: 4,
  count: 20,
  authenticated: true,
  canRate: true,
});

function fixture({ unratedOnly = true, loaded = false } = {}) {
  class Form {
    append() {}
    closest() {
      return this.card;
    }
    querySelector(selector) {
      return selector === "input:checked"
        ? { value: "4" }
        : this.card.querySelector(selector);
    }
  }
  const makeCard = (map) => {
    const form = new Form();
    const parts = {
      form,
      legend: { classList: { add() {} } },
      ".map-name": { setAttribute() {} },
      "[data-rating-feedback]": { textContent: "", classList: { add() {} } },
      "[data-rating-summary]": {},
      img: {},
    };
    const card = {
      dataset: { mapRating: map },
      querySelector: (selector) => parts[selector],
      cloneNode: () => makeCard(map),
      contains: () => false,
    };
    form.card = card;
    return card;
  };
  const cards = ["rated", "first", "second"].map(makeCard);
  const context = vm.createContext({
    unratedOnly,
    ratingsReady: loaded,
    loading: false,
    cards,
    pool: [...cards],
    previousMap: undefined,
    states: new Map(),
    busy: new Set(),
    thankingMap: undefined,
    advanceTimer: undefined,
    randomPreview: {
      replaceChildren(card) {
        this.card = card;
      },
      contains(card) {
        return card === this.card;
      },
      querySelector() {
        return null;
      },
    },
    randomTitle: { textContent: "", focus() {} },
    randomAnnouncement: { textContent: "" },
    randomSkip: {},
    status: {},
    retry: {},
    inMotd: false,
    bindings: { signal: { aborted: false } },
    controls() {},
    render() {},
    canRate: (r) => r?.canRate === true && r?.authenticated === true,
    validRating: (r) =>
      r &&
      typeof r.map === "string" &&
      (r.userRating === null || Number.isInteger(r.userRating)),
    tc: (key, params = {}) => key.replace("{map}", params.map),
    HTMLFormElement: Form,
    document: { activeElement: null },
    window: {
      setTimeout(fn) {
        context.advance = fn;
        return 1;
      },
    },
  });
  context.allCards = () => [
    ...cards,
    ...(context.randomPreview.card ? [context.randomPreview.card] : []),
  ];
  context.matchingCards = (map) =>
    context.allCards().filter((card) => card.dataset.mapRating === map);
  evaluate(
    context,
    "const chooseRandomMap = () => {",
    "randomSkip?.addEventListener('click'",
    "chooseRandomMap",
  );
  evaluate(
    context,
    "const load = async () => {",
    "(root ?? grid).addEventListener(",
    "load",
  );
  evaluate(
    context,
    "const saveRating = async (event:",
    "(root ?? grid).addEventListener('submit'",
    "saveRating",
  );
  return context;
}

test("only desktop homepage explicitly opts in; no selection before a complete load", async () => {
  const home = read("../pages/index.astro");
  assert.equal(
    (home.match(/<MapRatings compact unratedOnly locale=\{locale\}/g) || [])
      .length,
    1,
  );
  assert.match(
    source,
    /compact && !motdPrompt && Astro.props.unratedOnly === true/,
  );
  assert.match(source, /if \(!unratedOnly\) chooseRandomMap\(\)/);
  const ui = fixture();
  ui.chooseRandomMap();
  assert.equal(ui.randomPreview.card, undefined);
  ui.request = async () => ({
    ok: true,
    data: {
      authenticated: true,
      canRate: true,
      ratings: [rating("rated", 5), rating("first"), rating("second")],
    },
  });
  await ui.load();
  assert.equal(ui.ratingsReady, true);
  assert.ok(["first", "second"].includes(ui.previousMap));
  assert.notEqual(ui.previousMap, "rated");
});

test("unrated candidates cycle without repeats; community counts never exclude them", () => {
  const ui = fixture({ loaded: true });
  ui.states = new Map([
    ["rated", rating("rated", 5)],
    ["first", rating("first")],
    ["second", rating("second")],
  ]);
  ui.chooseRandomMap();
  const first = ui.previousMap;
  ui.chooseRandomMap();
  assert.notEqual(ui.previousMap, first);
  ui.chooseRandomMap();
  assert.equal(ui.previousMap, first);
});

test("successful save keeps thanks transition, then excludes saved map and exhausts accessibly", async () => {
  const ui = fixture({ loaded: true });
  ui.states = new Map([
    ["rated", rating("rated", 5)],
    ["first", rating("first", 3)],
    ["second", rating("second")],
  ]);
  ui.chooseRandomMap();
  const card = ui.randomPreview.card;
  ui.request = async () => ({
    ok: true,
    status: 200,
    data: rating("second", 4),
  });
  await ui.saveRating({
    target: card.querySelector("form"),
    preventDefault() {},
  });
  assert.equal(ui.previousMap, "second");
  assert.equal(ui.thankingMap, "second");
  ui.advance();
  assert.equal(ui.randomPreview.card, undefined);
  assert.equal(ui.randomTitle.textContent, "All maps rated. Thanks!");
  assert.equal(ui.randomAnnouncement.textContent, "All maps rated. Thanks!");
  assert.equal(ui.randomSkip.hidden, true);
  ui.chooseRandomMap();
  assert.equal(ui.randomPreview.card, undefined);
  assert.match(
    source,
    /id="random-map-announcement"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
  );
});

test("save failures retain current candidate and allow retry; success advances to another unrated map", async () => {
  const ui = fixture({ loaded: true });
  ui.states = new Map([
    ["rated", rating("rated", 5)],
    ["first", rating("first")],
    ["second", rating("second")],
  ]);
  ui.chooseRandomMap();
  const map = ui.previousMap;
  const card = ui.randomPreview.card;
  const submit = () =>
    ui.saveRating({ target: card.querySelector("form"), preventDefault() {} });
  for (const response of [
    { ok: false, status: 500 },
    { ok: true, status: 200, data: rating("wrong-map", 4) },
  ]) {
    ui.request = async () => response;
    await submit();
    assert.equal(ui.previousMap, map);
    assert.equal(ui.states.get(map).userRating, null);
    assert.equal(ui.advance, undefined);
    assert.equal(ui.busy.size, 0);
  }
  ui.request = async () => ({ ok: true, status: 200, data: rating(map, 4) });
  await submit();
  ui.advance();
  assert.notEqual(ui.previousMap, map);
  assert.notEqual(ui.previousMap, "rated");
});

test("load failure shows retry without a preview; guests load safely and MOTD keeps the full pool", async () => {
  const ui = fixture();
  ui.request = async () => ({ ok: false });
  await ui.load();
  ui.chooseRandomMap();
  assert.equal(ui.randomPreview.card, undefined);
  assert.equal(ui.randomPreview.textContent, "Ratings unavailable.");
  assert.equal(ui.retry.hidden, false);
  assert.equal(ui.ratingsReady, false);
  ui.request = async () => ({
    ok: true,
    data: {
      authenticated: false,
      canRate: false,
      ratings: ui.cards.map((card) => rating(card.dataset.mapRating)),
    },
  });
  await ui.load();
  assert.ok(ui.randomPreview.card);
  assert.equal(ui.canRate(ui.states.get(ui.previousMap)), false);
  const motd = fixture({ unratedOnly: false });
  motd.pool = [motd.cards[0]];
  motd.states.set("rated", rating("rated", 5));
  motd.chooseRandomMap();
  assert.equal(motd.previousMap, "rated");
});

test("expired verified session preserves the candidate without treating it as rated", async () => {
  const ui = fixture({ loaded: true });
  ui.states = new Map(
    ui.cards.map((card) => [
      card.dataset.mapRating,
      rating(card.dataset.mapRating),
    ]),
  );
  ui.chooseRandomMap();
  const map = ui.previousMap;
  ui.request = async () => ({ ok: false, status: 401 });
  await ui.saveRating({
    target: ui.randomPreview.card.querySelector("form"),
    preventDefault() {},
  });
  assert.equal(ui.previousMap, map);
  assert.equal(ui.states.get(map).userRating, null);
  assert.equal(ui.canRate(ui.states.get(map)), false);
  assert.equal(ui.advance, undefined);
});

test("initial all-rated load never displays a map, and an incomplete response cannot select one", async () => {
  const ui = fixture();
  ui.request = async () => ({
    ok: true,
    data: { authenticated: true, canRate: true, ratings: [rating("rated", 5)] },
  });
  await ui.load();
  assert.equal(ui.ratingsReady, false);
  assert.equal(ui.randomPreview.card, undefined);
  ui.request = async () => ({
    ok: true,
    data: {
      authenticated: true,
      canRate: true,
      ratings: ui.cards.map((card) => rating(card.dataset.mapRating, 5)),
    },
  });
  await ui.load();
  assert.equal(ui.ratingsReady, true);
  assert.equal(ui.randomPreview.card, undefined);
  assert.equal(ui.randomTitle.textContent, "All maps rated. Thanks!");
  assert.equal(ui.randomSkip.hidden, true);
});

test("all locales provide a readable all-rated state", () => {
  for (const locale of ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"])
    assert.ok(
      JSON.parse(read(`../lib/i18n/${locale}.json`))[
        "All maps rated. Thanks!"
      ]?.trim(),
      locale,
    );
});
