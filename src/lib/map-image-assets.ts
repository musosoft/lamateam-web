import type { ImageMetadata } from "astro";

// Eager default imports give Astro the true dimensions/format, including cached
// PNG data historically saved under a .jpg filename. No public originals.
const assets = import.meta.glob<ImageMetadata>(
  "../assets/map-cache/*.{jpg,jpeg,png,webp,avif}",
  { eager: true, import: "default" },
);

const mapImages = new Map<string, ImageMetadata>(
  Object.entries(assets).map(([path, image]) => [
    path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""),
    image,
  ]),
);

/** Exact, case-sensitive map basename. Missing images retain the UI fallback. */
export function getMapImage(mapName: string): ImageMetadata | undefined {
  return mapImages.get(mapName);
}

/** Enough for thumbnail DPR variants without delivering full-size screenshots. */
export const MAP_IMAGE_MAX_WIDTH = 640;
const thumbnailWidths = [160, 240, 320, 480, MAP_IMAGE_MAX_WIDTH];

/** Astro Image widths, capped to the source size: never upscale small originals. */
export function getMapImageWidths(image: ImageMetadata): number[] {
  const maxWidth = Math.min(image.width, MAP_IMAGE_MAX_WIDTH);
  return [
    ...new Set([
      ...thumbnailWidths.filter((width) => width < maxWidth),
      maxWidth,
    ]),
  ];
}
