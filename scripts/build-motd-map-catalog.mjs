import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharpService from "astro/assets/services/sharp";

// Run in Node before Astro builds. No image-service setup, URL generation or
// thumbnail transformation for this catalog is left to a cold Worker isolate.
const root = new URL("../", import.meta.url);
const maps = JSON.parse(
  await readFile(new URL("src/data/maps.generated.json", root), "utf8"),
);
const output = new URL("public/assets/motd-map-thumbnails/", root);
await mkdir(output, { recursive: true });
const catalog = [];
for (const { map: name, image } of maps.items) {
  if (name === "min_players") continue;
  if (image === "/assets/map-placeholder.svg") {
    catalog.push({ name, src: image });
    continue;
  }
  if (!image.startsWith("/assets/map-cache/") || image.includes("..")) {
    throw new Error(`Unexpected local map image: ${name}`);
  }
  const input = await readFile(new URL(`public${image}`, root));
  const transform = {
    src: image,
    width: 240,
    height: 180,
    fit: "cover",
    format: "webp",
    quality: 80,
  };
  const optimized = await sharpService.transform(
    input,
    transform,
    { service: { config: {} } },
    console,
  );
  if (optimized.format !== "webp")
    throw new Error(`MOTD thumbnail was not optimized: ${name}`);
  // Hash the output bytes so changed sources/encoders cannot reuse a stale URL.
  const hash = createHash("sha256")
    .update(optimized.data)
    .digest("hex")
    .slice(0, 20);
  const filename = `${hash}.webp`;
  await writeFile(new URL(filename, output), optimized.data);
  catalog.push({ name, src: `/assets/motd-map-thumbnails/${filename}` });
}
await writeFile(
  new URL("src/data/motd-map-catalog.generated.json", root),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
console.log(
  `[motd] generated ${catalog.length} static thumbnail catalog entries`,
);
