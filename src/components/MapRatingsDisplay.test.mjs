import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./MapRatings.astro");
const section = (start, end) =>
  source.slice(
    source.indexOf(start),
    source.indexOf(end, source.indexOf(start)),
  );
const compile = (args, code) =>
  new Function(
    `return ${stripTypeScriptTypes(`function evaluate(${args.join(",")}) { ${code} }`, { mode: "transform" })}`,
  )();
const tc = (key, params = {}) =>
  key.replace(/\{(\w+)\}/g, (_, key) => params[key]);

function fixture() {
  class Element {
    closest(selector) {
      return selector === "[data-star]" ? this : this.card;
    }
    contains(node) {
      return node === this;
    }
  }
  const stars = [1, 2, 3, 4, 5].map((value) => {
    const star = new Element();
    star.dataset = { star: String(value) };
    star.symbol = {
      style: {
        setProperty(key, value) {
          this[key] = value;
        },
      },
    };
    star.querySelector = () => star.symbol;
    return star;
  });
  const inputs = stars.map((star) => ({
    value: star.dataset.star,
    checked: false,
  }));
  const parts = Object.fromEntries(
    [
      ".rating-stars",
      "[data-rating-summary]",
      "[data-rating-count]",
      "[data-community-summary]",
      "fieldset",
    ].map((key) => [key, { dataset: {} }]),
  );
  const card = {
    dataset: { mapRating: "de_dust2" },
    querySelector: (key) => parts[key],
    querySelectorAll: (key) => (key === "[data-star]" ? stars : inputs),
  };
  stars.forEach((star) => (star.card = card));
  const states = new Map();
  const display = compile(
    ["tc", "controls"],
    `${section("const showStars =", "let loading = false;")} return { showStars, render };`,
  )(tc, () => {});
  const preview = compile(
    ["Element", "Node", "states", "showStars"],
    `${section("const previewStars =", "for (const type of")} return previewStars;`,
  )(Element, Element, states, display.showStars);
  const rating = { map: "de_dust2", average: 3.5, count: 12, userRating: 1 };
  states.set(rating.map, rating);
  return { ...display, preview, stars, inputs, parts, card, rating, states };
}

test("idle stars display fractional community average, not the checked personal vote", () => {
  const ui = fixture();
  ui.render(ui.card, ui.rating);
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "3.5");
  assert.deepEqual(
    ui.stars.map((star) => star.symbol.style["--star-fill"]),
    ["100%", "100%", "100%", "50%", "0%"],
  );
  assert.deepEqual(
    ui.inputs.map((input) => input.checked),
    [true, false, false, false, false],
  );
  assert.equal(
    ui.parts["[data-rating-summary]"].textContent,
    "Your rating · 1 / 5",
  );
  assert.equal(ui.parts["[data-rating-count]"].textContent, "12 ratings");
  assert.equal(
    ui.parts["[data-community-summary]"].textContent,
    " · Community rating · 3.5 / 5",
  );
});

test("pointer and keyboard previews restore aggregate; saving selection is not overridden", () => {
  const ui = fixture();
  ui.render(ui.card, ui.rating);
  for (const [enter, leave] of [
    ["pointerover", "pointerout"],
    ["focusin", "focusout"],
  ]) {
    ui.preview({ type: enter, target: ui.stars[4] });
    assert.equal(ui.parts[".rating-stars"].dataset.stars, "5");
    assert.equal(
      ui.parts["[data-rating-summary]"].textContent,
      "Your rating · 1 / 5",
    );
    ui.preview({
      type: leave,
      target: ui.stars[4],
      relatedTarget: ui.stars[4],
    });
    assert.equal(ui.parts[".rating-stars"].dataset.stars, "5");
    ui.preview({ type: leave, target: ui.stars[4], relatedTarget: null });
    assert.equal(ui.parts[".rating-stars"].dataset.stars, "3.5");
  }
  ui.showStars(ui.card, 2);
  ui.parts.fieldset.disabled = true;
  ui.preview({ type: "pointerout", target: ui.stars[1], relatedTarget: null });
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "2");
  const change = section("'change',", "const previewStars =");
  assert.match(change, /showStars\(card, Number\(event.target.value\)\)/);
  assert.match(change, /void saveRating/);
  ui.render(ui.card, { ...ui.rating, userRating: 2, average: 3.25, count: 13 });
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "3.25");
  assert.equal(
    ui.parts["[data-rating-summary]"].textContent,
    "Your rating · 2 / 5",
  );
  assert.equal(ui.parts["[data-rating-count]"].textContent, "13 ratings");
});

test("unrated personal state and empty community state are independent", () => {
  const ui = fixture();
  ui.render(ui.card, { ...ui.rating, userRating: null });
  assert.equal(
    ui.parts["[data-rating-summary]"].textContent,
    "Your rating · Not rated yet.",
  );
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "3.5");
  assert.equal(
    ui.inputs.some((input) => input.checked),
    false,
  );
  ui.render(ui.card, {
    ...ui.rating,
    userRating: null,
    average: null,
    count: 0,
  });
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "0");
  assert.ok(
    ui.stars.every((star) => star.symbol.style["--star-fill"] === "0%"),
  );
  assert.equal(ui.parts["[data-rating-count]"].textContent, "No ratings yet.");
  assert.equal(
    ui.parts["[data-community-summary]"].textContent,
    " · No ratings yet.",
  );
});

test("radio change previews the selected input and submits the same form for saving", () => {
  const ui = fixture();
  let listener;
  let submitted;
  const root = {
    addEventListener(type, callback) {
      assert.equal(type, "change");
      listener = callback;
    },
  };
  class Input {
    value = "2";
    closest(selector) {
      return selector === "form" ? form : ui.card;
    }
  }
  const form = {};
  const change = source.slice(
    source.lastIndexOf(
      "(root ?? grid).addEventListener(",
      source.indexOf("const previewStars ="),
    ),
    source.indexOf("const previewStars ="),
  );
  compile(
    ["root", "grid", "bindings", "HTMLInputElement", "showStars", "saveRating"],
    change,
  )(root, null, { signal: {} }, Input, ui.showStars, (event) => {
    submitted = event.target;
  });
  listener({ target: new Input() });
  assert.equal(ui.parts[".rating-stars"].dataset.stars, "2");
  assert.deepEqual(
    ui.stars.map((star) => star.symbol.style["--star-fill"]),
    ["100%", "100%", "0%", "0%", "0%"],
  );
  assert.equal(submitted, form);
});

test("five accessible controls precede community count, with no visible rate helper or speed attribution", () => {
  assert.match(
    source,
    /<legend class="sr-only">[\s\S]*?data-community-summary/,
  );
  assert.match(
    source,
    /<div class="rating-stars"[\s\S]*?\{\[1, 2, 3, 4, 5\][\s\S]*?<span class="sr-only">[\s\S]*?\{t\('\{count\} stars'\)/,
  );
  assert.ok(
    source.indexOf("data-rating-count\n") >
      source.indexOf('class="rating-stars"'),
  );
  assert.doesNotMatch(source, /1–5 ★|input:checked \+ \.star-symbol/);
  assert.doesNotMatch(
    read("../pages/speed.astro"),
    /StrategyWiki|© Valve|weapon-source/,
  );
  const manifest = JSON.parse(read("../assets/weapons/sources.json"));
  assert.ok(
    manifest.assets.every((asset) =>
      asset.source.startsWith("https://strategywiki.org/"),
    ),
  );
});

test("all locales supply personal, community and count copy with intact tokens", () => {
  for (const locale of ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"]) {
    const copy = JSON.parse(read(`../lib/i18n/${locale}.json`));
    for (const key of [
      "Your rating · {rating} / 5",
      "Your rating · Not rated yet.",
      "{count} ratings",
      "Community rating · {average} / 5",
      "No ratings yet.",
    ]) {
      assert.ok(copy[key]?.trim(), `${locale}: ${key}`);
      assert.deepEqual(copy[key].match(/\{\w+\}/g), key.match(/\{\w+\}/g));
    }
  }
});
