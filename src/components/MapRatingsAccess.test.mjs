import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./MapRatings.astro");
const home = read("../pages/index.astro");
const access = source.slice(
  source.indexOf("const inMotd ="),
  source.indexOf("const randomTitle ="),
);
const controls = source.slice(
  source.indexOf("const controls ="),
  source.indexOf("const render ="),
);
const evaluate = new Function(
  "root",
  stripTypeScriptTypes(
    `${access}
  const busy = new Set();
  const thankingMap = undefined;
  const randomPreview = null;
  const randomSkip = null;
  ${controls}`,
    { mode: "transform" },
  ) + "\nreturn { endpoint, canRate, controls };",
);
const setup = (motd, id = "") =>
  evaluate({ hasAttribute: () => motd, dataset: { motdCommunityId: id } });

test("only the game instance passes community ID; both request methods share an encoded endpoint without names", () => {
  assert.match(
    home,
    /<MapRatings\s+compact\s+motdPrompt\s+locale=\{locale\}\s+communityId=\{rawCommunityId.length <= 32 \? rawCommunityId : ''\}/,
  );
  assert.ok(
    home.includes("<MapRatings compact unratedOnly locale={locale} />"),
  );
  for (const id of ["76561197960265729", "[U:1:12345]", "a&name=Injected"]) {
    const endpoint = new URL(setup(true, id).endpoint, "https://example.test");
    assert.equal(endpoint.searchParams.get("communityid"), id);
    assert.deepEqual([...endpoint.searchParams.keys()], ["communityid"]);
    assert.equal(setup(false, id).endpoint, "/api/map-ratings");
  }
  assert.equal(setup(true).endpoint, "/api/map-ratings");
  assert.match(source, /fetch\(endpoint, \{/);
  assert.match(source, /body: JSON.stringify\(\{ map, stars \}\)/);
  assert.doesNotMatch(access, /playerName|searchParams|navigator/);
  assert.doesNotMatch(source, /authenticated: true/);
  assert.match(source, /typeof data.canRate !== 'boolean'/);
  assert.match(source, /\{ \.\.\.rating, authenticated, canRate: allowed \}/);
  assert.match(source, /previous.canRate = false/);
  assert.match(
    source,
    /feedback.textContent = inMotd\s*\? tc\('Ratings unavailable\.'\)/,
  );
});

test("MOTD permission is explicit and unverified; desktop remains verified-only with its sign-in affordance", () => {
  for (const [motd, id, rating, enabled, signInVisible] of [
    [
      true,
      "76561197960265729",
      { authenticated: false, canRate: true },
      true,
      false,
    ],
    [true, "[U:1:12345]", { authenticated: false, canRate: true }, true, false],
    [true, "", { authenticated: false, canRate: true }, false, false],
    [true, "", { authenticated: true, canRate: true }, false, false],
    [true, "invalid", { authenticated: false, canRate: false }, false, false],
    [true, "76561197960265729", { authenticated: true }, false, false],
    [true, "76561197960265729", undefined, false, false],
    [
      false,
      "76561197960265729",
      { authenticated: false, canRate: true },
      false,
      true,
    ],
    [false, "", { authenticated: false, canRate: false }, false, true],
    [false, "", { authenticated: true, canRate: true }, true, false],
    [false, "", { authenticated: true, canRate: false }, false, false],
    [false, "", { canRate: true, userRating: 4 }, false, true],
  ]) {
    const ui = setup(motd, id);
    const fieldset = {};
    const signIn = {};
    const form = { setAttribute() {} };
    const card = {
      dataset: { mapRating: "de_rush_fix" },
      querySelector: (selector) =>
        selector === "fieldset"
          ? fieldset
          : selector === "form"
            ? form
            : signIn,
    };
    assert.equal(ui.canRate(rating), enabled);
    ui.controls(card, rating);
    assert.equal(fieldset.disabled, !enabled);
    assert.equal(signIn.hidden, !signInVisible);
    if (rating?.authenticated === false)
      assert.equal(rating.authenticated, false);
  }
  const save = source.slice(source.indexOf("const saveRating ="));
  assert.match(save, /if \(\s*!rating \|\|\s*!canRate\(rating\)/);
  assert.match(
    save,
    /!validRating\(updated\) \|\|\s*typeof updated.authenticated !== 'boolean' \|\|\s*!canRate\(updated\)/,
  );
});
