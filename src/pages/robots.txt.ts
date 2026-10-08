import type { APIRoute } from "astro";
import { siteUrl } from "../lib/localized-content.ts";

export const GET: APIRoute = () => {
  const body = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${new URL("/sitemap.xml", siteUrl()).href}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
