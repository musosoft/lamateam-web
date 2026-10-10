import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const catalog = JSON.parse(
  readFileSync(new URL("src/data/maps.generated.json", root), "utf8"),
);
const source = readFileSync(
  new URL("./map-image-assets.ts", import.meta.url),
  "utf8",
);
const assetDirectory = new URL("src/assets/map-cache/", root);

test("catalog assets retain identical public originals and optimized source imports", () => {
  const files = readdirSync(assetDirectory);
  const cached = catalog.items.filter((item) => item.source !== "placeholder");
  assert.equal(cached.length, 98);
  assert.equal(catalog.items.length - cached.length, 1);
  assert.ok(files.length >= cached.length);
  for (const item of catalog.items) {
    const filename = `${item.map}.jpg`;
    assert.equal(
      files.includes(filename),
      item.source !== "placeholder",
      item.map,
    );
    if (item.source !== "placeholder") {
      assert.equal(item.image, `/assets/map-cache/${filename}`);
      assert.ok(readFileSync(new URL(filename, assetDirectory)).length > 512);
    }
  }
  for (const filename of files) {
    assert.deepEqual(
      readFileSync(new URL(`public/assets/map-cache/${filename}`, root)),
      readFileSync(new URL(filename, assetDirectory)),
    );
  }
  assert.match(source, /import\.meta\.glob<ImageMetadata>/);
  assert.match(source, /eager: true, import: "default"/);
});

test("registry resolves exact basenames and responsive widths respect source dimensions", async () => {
  // Node has no Vite glob transform. Supply its default-import output while
  // exercising the actual helper implementation (Astro check/build covers Vite).
  const image = {
    src: "/_astro/de_dust2.hash.jpg",
    width: 1920,
    height: 1080,
    format: "jpg",
  };
  const tiny = {
    src: "/_astro/tiny.hash.png",
    width: 200,
    height: 100,
    format: "png",
  };
  const compiled = stripTypeScriptTypes(source).replace(
    /import\.meta\.glob\s*\([\s\S]*?\);/,
    `${JSON.stringify({ "../assets/map-cache/de_dust2.jpg": image, "../assets/map-cache/$2000$.jpg": tiny })};`,
  );
  assert.equal(compiled.includes("import.meta.glob"), false);
  const helper = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  assert.deepEqual(helper.getMapImage("de_dust2"), image);
  assert.deepEqual(helper.getMapImage("$2000$"), tiny);
  for (const name of [
    "DE_DUST2",
    "de_dust2.jpg",
    "../de_dust2",
    "toString",
    "de_grit3",
  ])
    assert.equal(helper.getMapImage(name), undefined);
  assert.deepEqual(helper.getMapImageWidths(image), [160, 240, 320, 480, 640]);
  assert.deepEqual(helper.getMapImageWidths(tiny), [132]);
  assert.deepEqual(helper.getMapImageWidths({ ...tiny, width: 80 }), [80]);
  assert.deepEqual(helper.getMapImageWidths({ ...tiny, width: 320 }), [132]);
  for (const [width, height] of [
    [640, 480],
    [872, 656],
    [218, 164],
    [5760, 3600],
    [5120, 4336],
    [200, 100],
    [100, 200],
  ]) {
    const input = { ...image, width, height };
    const target = helper.getMapImageDimensions(input);
    assert.ok(target.width <= width && target.height <= height);
    assert.ok(target.width <= 640 && target.height <= 480);
    assert.equal(target.width / target.height, 4 / 3);
    for (const candidate of helper.getMapImageWidths(input)) {
      assert.equal(candidate % 4, 0);
      assert.ok(candidate <= target.width);
      assert.ok((candidate * 3) / 4 <= height);
    }
  }
  assert.deepEqual(
    helper.getMapImageDimensions({ ...image, width: 218, height: 164 }),
    { width: 216, height: 162 },
  );
});

test("cache script writes fresh sources to src, keeps catalog contract and preserves cache hits", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "map-image-cache-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cache = path.join(dir, "src/assets/map-cache");
  mkdirSync(cache, { recursive: true });
  const original = Buffer.alloc(600, 1);
  writeFileSync(path.join(cache, "cached.jpg"), original);
  const setup = path.join(dir, "mock-fetch.mjs");
  writeFileSync(
    setup,
    `globalThis.fetch = async (url) => {
    if (url.includes('spreadsheets')) return new Response('MAPA\\ncached\\nfresh\\nmissing');
    if (url.endsWith('/fresh.jpg')) return new Response(new Uint8Array(700).fill(2), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('', { status: 404 });
  };`,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", setup, new URL("scripts/cache-map-images.mjs", root).pathname],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(path.join(cache, "cached.jpg")), original);
  assert.equal(readFileSync(path.join(cache, "fresh.jpg")).length, 700);
  assert.equal(existsSync(path.join(cache, "missing.jpg")), false);
  const publicCache = path.join(dir, "public/assets/map-cache");
  assert.deepEqual(
    readFileSync(path.join(publicCache, "cached.jpg")),
    original,
  );
  assert.deepEqual(
    readFileSync(path.join(publicCache, "fresh.jpg")),
    readFileSync(path.join(cache, "fresh.jpg")),
  );
  assert.equal(existsSync(path.join(publicCache, "missing.jpg")), false);
  const generated = JSON.parse(
    readFileSync(path.join(dir, "src/data/maps.generated.json"), "utf8"),
  );
  assert.equal(generated.total, 3);
  assert.equal(generated.ok, 2);
  assert.deepEqual(
    generated.items.map(({ map, image }) => ({ map, image })),
    [
      { map: "cached", image: "/assets/map-cache/cached.jpg" },
      { map: "fresh", image: "/assets/map-cache/fresh.jpg" },
      { map: "missing", image: "/assets/map-placeholder.svg" },
    ],
  );

  // Newly supplied public images replace stale imported copies, without
  // deleting public assets absent from the spreadsheet or downloading again.
  const replacement = Buffer.alloc(750, 3);
  writeFileSync(path.join(publicCache, "cached.jpg"), replacement);
  writeFileSync(path.join(publicCache, "retired.jpg"), original);
  const rerun = spawnSync(
    process.execPath,
    ["--import", setup, new URL("scripts/cache-map-images.mjs", root).pathname],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.deepEqual(readFileSync(path.join(cache, "cached.jpg")), replacement);
  assert.deepEqual(
    readFileSync(path.join(publicCache, "cached.jpg")),
    replacement,
  );
  assert.deepEqual(
    readFileSync(path.join(publicCache, "retired.jpg")),
    original,
  );
});
