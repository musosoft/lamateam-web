import type { ImageMetadata } from "astro";

// Eager default imports give Astro the true dimensions/format, including cached
// PNG data historically saved under a .jpg filename. Public originals remain
// available for legacy URLs; rendered thumbnails use the optimized service.
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
export const MAP_IMAGE_MAX_HEIGHT = 480;
const thumbnailWidths = [160, 240, 320, 480, MAP_IMAGE_MAX_WIDTH];

/** Largest exact 4:3 crop that fits both source axes, without upscaling. */
export function getMapImageDimensions(image: ImageMetadata): {
  width: number;
  height: number;
} {
  const width =
    Math.floor(
      Math.min(image.width, (image.height * 4) / 3, MAP_IMAGE_MAX_WIDTH) / 4,
    ) * 4;
  return { width, height: (width * 3) / 4 };
}

/** Astro derives each candidate height from the same exact 4:3 target ratio. */
export function getMapImageWidths(image: ImageMetadata): number[] {
  const { width: maxWidth } = getMapImageDimensions(image);
  return [
    ...new Set([
      ...thumbnailWidths.filter((width) => width < maxWidth),
      maxWidth,
    ]),
  ];
}
