import type { APIRoute } from "astro";
import {
  routeManifest,
  untranslatedPublicRoutes,
  siteUrl,
} from "../lib/localized-content.ts";

const routes = [
  ...routeManifest.map(({ path }) => path),
  ...untranslatedPublicRoutes,
];

export const GET: APIRoute = () => {
  const baseUrl = siteUrl();
  const items = routes
    .map((path) => {
      const loc = new URL(path, baseUrl).href
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
      return `<url><loc>${loc}</loc></url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
