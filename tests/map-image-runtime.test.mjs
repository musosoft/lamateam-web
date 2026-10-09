import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("SSR images use the Worker Images binding, not zone resizing or passthrough", () => {
  const astro = readFileSync(new URL("astro.config.mjs", root), "utf8");
  const wrangler = readFileSync(new URL("wrangler.jsonc", root), "utf8");
  assert.match(astro, /imageService:\s*"cloudflare-binding"/);
  assert.match(wrangler, /"images":\s*\{\s*"binding":\s*"IMAGES"\s*\}/);
});

// Run against the built Worker with MAP_IMAGE_PREVIEW_URL=http://127.0.0.1:PORT.
// Deliberately test rendered markup and every candidate for one real map:
// source-only checks cannot detect missing bindings or oversized passthrough.
test(
  "built Worker serves bounded WebP map thumbnails",
  {
    skip: !process.env.MAP_IMAGE_PREVIEW_URL,
  },
  async () => {
    const origin = process.env.MAP_IMAGE_PREVIEW_URL;
    const original = await fetch(
      new URL("/assets/map-cache/$2000$.jpg", origin),
    );
    assert.equal(
      original.status,
      200,
      "legacy public map image must remain available",
    );
    assert.ok(original.headers.get("content-type")?.startsWith("image/"));
    const page = await fetch(new URL("/de/karten/", origin));
    assert.equal(page.status, 200);
    const html = await page.text();
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    const thumbnail = images.find((image) => image.includes("_2000_"));
    assert.ok(thumbnail, "real $2000$ map thumbnail must be rendered");
    assert.ok(!thumbnail.includes("/cdn-cgi/image/"), thumbnail);
    assert.ok(!thumbnail.includes("/assets/map-cache/"), thumbnail);
    const attributes = Object.fromEntries(
      [...thumbnail.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
        key,
        value.replaceAll("&amp;", "&"),
      ]),
    );
    const candidates = [
      attributes.src,
      ...attributes.srcset
        .split(", ")
        .map((candidate) => candidate.replace(/\s+\d+w$/, "")),
    ];
    for (const candidate of new Set(candidates)) {
      const url = new URL(candidate, origin);
      assert.equal(url.pathname, "/_image");
      const requestedWidth = Number(url.searchParams.get("w"));
      assert.ok(requestedWidth > 0 && requestedWidth <= 640, url.href);
      const image = await fetch(url);
      assert.equal(image.status, 200, url.href);
      assert.equal(image.headers.get("content-type"), "image/webp");
      // Inspect the returned bytes, not merely HTML width attributes.
      const { imageMetadata } = await import("astro/assets/utils");
      const metadata = await imageMetadata(
        new Uint8Array(await image.arrayBuffer()),
        url.href,
      );
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, requestedWidth);
      assert.equal(metadata.height, Number(url.searchParams.get("h")));
      assert.ok(metadata.width <= 640);
    }
  },
);
