import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const speed = read("src/pages/speed.astro");
const ratings = read("src/components/MapRatings.astro");
const runTS = (source, context = {}) => {
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }).outputText,
    context,
  );
  return context;
};

test("all speed groups retain values and use complete local weapon assets", () => {
  const source = speed.slice(
    speed.indexOf("const speedRows ="),
    speed.indexOf("---", speed.indexOf("const speedRows =")),
  );
  const { rows, fills } = runTS(
    `${source}\nglobalThis.rows = speedRows; globalThis.fills = speedRows.map(({speed}) => relativeFill(speed));`,
  );
  assert.deepEqual(
    Array.from(rows, (row) => row.speed),
    [260, 250, 245, 240, 235, 230, 221, 220, 215, 210],
  );
  assert.equal(fills[0], 100);
  assert.equal(fills.at(-1), 2);
  assert.ok(fills.every((value, index) => !index || value < fills[index - 1]));
  const manifest = JSON.parse(read("src/assets/weapons/sources.json"));
  assert.equal(rows.flatMap((row) => row.weapons).length, 29);
  for (const [id, name] of rows.flatMap((row) => row.weapons)) {
    assert.ok(name.trim());
    const file = `Css_${id}.png`;
    const png = readFileSync(
      new URL(`../src/assets/weapons/${file}`, import.meta.url),
    );
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(
      manifest.assets.some(
        (asset) =>
          asset.file === file &&
          asset.source.startsWith("https://strategywiki.org/wiki/File:"),
      ),
    );
  }
  assert.match(
    speed,
    /<Image[\s\S]*?alt=\{`\$\{t\('Weapon'\)\}: \$\{name\}`\}/,
  );
  assert.match(speed, /<td\s+class="speed-value"[\s\S]*?\{speed\}/);
  assert.match(speed, /background-image: linear-gradient/);
  assert.match(speed, /forced-colors: active/);
  assert.doesNotMatch(speed, /<img[^>]+src="https?:/);
});

test("every locale has a map-specific prompt with a single intact map token", () => {
  for (const file of readdirSync(
    new URL("../src/lib/i18n/", import.meta.url),
  )) {
    if (!file.endsWith(".json")) continue;
    const prompt = JSON.parse(read(`src/lib/i18n/${file}`))[
      "Know {map}? Rate it."
    ];
    assert.ok(prompt?.trim(), file);
    assert.equal(prompt.match(/\{map\}/g)?.length, 1, file);
  }
});

test("selection updates the safe title and hides only the cloned map label", () => {
  const makeCard = (map) => {
    const parts = {
      form: { append() {} },
      legend: { classList: { add() {} } },
      ".map-name": {
        hidden: false,
        setAttribute() {
          this.hidden = true;
        },
      },
      "[data-rating-feedback]": { textContent: "" },
      "[data-rating-summary]": { hidden: false },
      img: {},
    };
    return {
      dataset: { mapRating: map },
      querySelector: (selector) => parts[selector],
      cloneNode: () => makeCard(map),
    };
  };
  const cards = [
    makeCard("fun_matrix_trilogie"),
    makeCard("<img src=x onerror=alert(1)>"),
  ];
  const context = {
    cards,
    pool: [...cards],
    previousMap: undefined,
    busy: new Set(),
    thankingMap: undefined,
    loading: false,
    unratedOnly: false,
    ratingsReady: false,
    randomPreview: {
      replaceChildren(card) {
        this.card = card;
      },
    },
    randomAnnouncement: { textContent: "" },
    randomTitle: { textContent: "" },
    randomSkip: {},
    states: new Map(),
    controls() {},
    render() {},
    tc: (key, { map }) => key.replace("{map}", map),
  };
  const start = ratings.indexOf("const chooseRandomMap = () => {");
  const end = ratings.indexOf("randomSkip?.addEventListener('click'", start);
  runTS(
    ratings
      .slice(start, end)
      .replace("const chooseRandomMap", "globalThis.chooseRandomMap"),
    context,
  );
  context.chooseRandomMap();
  assert.equal(
    context.randomTitle.textContent,
    "Know <img src=x onerror=alert(1)>? Rate it.",
  );
  assert.equal(
    context.randomPreview.card.querySelector(".map-name").hidden,
    true,
  );
  assert.equal(cards[1].querySelector(".map-name").hidden, false);
  context.chooseRandomMap();
  assert.equal(
    context.randomTitle.textContent,
    "Know fun_matrix_trilogie? Rate it.",
  );
  assert.equal(context.randomAnnouncement.textContent, "fun_matrix_trilogie");
  assert.match(
    ratings,
    /randomSkip\?\.addEventListener\('click', chooseRandomMap/,
  );
  assert.match(ratings, /if \(!unratedOnly\) chooseRandomMap\(\)/);
  assert.match(ratings, /const restoreFocus[\s\S]*?chooseRandomMap\(\)/);
});

test("gallery fieldset context is screen-reader-only and map IDs stay canonical", () => {
  assert.match(
    ratings,
    /<legend class="sr-only">[\s\S]*?\{t\('Rate'\)\}[\s\S]*?\{map.name\}/,
  );
  assert.match(ratings, /<h2 class="map-name"[^>]*>[\s\S]*?\{map.name\}/);
  assert.match(ratings, /body: JSON.stringify\(\{ map, stars \}\)/);
  assert.match(ratings, /getMapImage\(item.map\)/);
  assert.match(ratings, /widths: getMapImageWidths\(image\)/);
  assert.match(ratings, /\.\.\.map.imageProps/);
  assert.match(ratings, /data-motd-community-id=\{motdPrompt \? communityId/);
  assert.match(
    ratings,
    /inMotd \? !!communityId : rating.authenticated === true/,
  );
});
