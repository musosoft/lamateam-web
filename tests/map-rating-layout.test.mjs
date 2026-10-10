import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/MapRatings.astro", import.meta.url),
  "utf8",
);
const markup = source.slice(0, source.indexOf("<style>"));
const styles = source.slice(
  source.indexOf("<style>"),
  source.indexOf("<script>"),
);

test("sign-in and personal rating share a left-aligned group before the stars", () => {
  assert.match(
    markup,
    /<form class="map-rating-form"[^>]*>\s*<div class="rating-details">[\s\S]*?data-rating-sign-in[\s\S]*?data-rating-summary[\s\S]*?<fieldset disabled>/,
  );
  assert.equal(markup.match(/data-rating-summary/g)?.length, 1);
  assert.equal(markup.match(/data-rating-sign-in/g)?.length, 1);
  assert.match(styles, /\.rating-details\s*\{[^}]*text-align: left;/);
});

test("desktop picker adapts to the sidebar width without shrinking mobile targets", () => {
  assert.match(styles, /container: rating-content \/ inline-size;/);
  assert.match(
    styles,
    /@container rating-content \(min-width: 300px\)\s*\{\s*@media \(min-width: 751px\)/,
  );
  const desktop = styles.slice(
    styles.indexOf("@container rating-content"),
    styles.indexOf("@media (max-width: 750px)"),
  );
  assert.match(
    desktop,
    /:global\(\.rating-details\)\s*\{\s*grid-column: 1;\s*grid-row: 1;/,
  );
  assert.match(
    desktop,
    /:global\(fieldset\)\s*\{\s*grid-column: 2;\s*grid-row: 1;/,
  );
  assert.match(
    styles,
    /\.rating-star\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/,
  );
});

test("gallery does not reserve an empty feedback row but keeps live feedback semantics", () => {
  assert.match(styles, /\.rating-feedback:empty\s*\{\s*margin: 0;/);
  assert.match(
    markup,
    /data-rating-feedback\s+role="status"\s+aria-live="polite"/,
  );
  assert.match(markup, /<legend class="sr-only">/);
  assert.match(markup, /href="\/api\/auth\/steam"\s+data-astro-reload/);
});
