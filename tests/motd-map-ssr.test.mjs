import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const maps = JSON.parse(
  readFileSync(new URL("../src/data/maps.generated.json", import.meta.url)),
).items.filter(({ map }) => map !== "min_players");
test(
  "desktop gallery and compact unrated picker retain their full SSR catalog",
  {
    skip: !process.env.SSR_BASE_URL,
  },
  async () => {
    for (const path of ["/maps", "/"]) {
      const response = await fetch(new URL(path, process.env.SSR_BASE_URL), {
        headers: { "User-Agent": "Mozilla/5.0 Chromium" },
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.equal(
        (html.match(/data-map-rating=/g) || []).length,
        maps.length,
        path,
      );
      assert.doesNotMatch(html, /data-motd-map-catalog/);
    }
  },
);
test(
  "Valve MOTD SSR keeps one visible card and a lightweight skip catalog",
  {
    skip: !process.env.SSR_BASE_URL,
  },
  async () => {
    const response = await fetch(new URL("/", process.env.SSR_BASE_URL), {
      headers: { "User-Agent": "Valve Client" },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal((html.match(/data-map-rating=/g) || []).length, 1);
    assert.equal((html.match(/<img\b/g) || []).length, 2);
    assert.match(html, /data-ssr-preview/);
    assert.match(html, /id="rated-map-grid"[^>]*hidden[^>]*>\s*<\/div>/);
    const catalog = JSON.parse(
      html.match(
        /<script[^>]*data-motd-map-catalog[^>]*>([\s\S]*?)<\/script>/,
      )[1],
    );
    assert.deepEqual(
      catalog.map(({ name }) => name),
      maps.map(({ map }) => map),
    );
    assert.ok(
      catalog.every(
        ({ src }) =>
          /^\/assets\/motd-map-thumbnails\/[a-f0-9]{20}\.webp$/.test(src) ||
          src === "/assets/map-placeholder.svg",
      ),
    );
    assert.ok(
      Buffer.byteLength(html) < 150_000,
      "MOTD must not serialize the hidden gallery",
    );
    console.log(
      `Valve MOTD SSR: ${Buffer.byteLength(html)} bytes, 1 map card, 2 images, ${catalog.length} catalog entries`,
    );
  },
);
