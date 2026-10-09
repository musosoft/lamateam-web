import type { APIRoute } from "astro";
import { createClient } from "@libsql/client/web";
import { env } from "cloudflare:workers";
import catalog from "../../data/maps.generated.json";
import { createMapRatingsHandler } from "../../lib/map-ratings";
import { readSteamSession } from "../../lib/steam-session";

const handle = createMapRatingsHandler({
  rateLimiter: (env as typeof env & Cloudflare.Env).TRANSLATION_RATE_LIMITER,
  maps: catalog.items.map((item) => item.map),
  database: () => {
    const url = import.meta.env.DEV
      ? import.meta.env.TURSO_DATABASE_URL
      : env.TURSO_DATABASE_URL;
    const authToken = import.meta.env.DEV
      ? import.meta.env.TURSO_AUTH_TOKEN
      : env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("Database configuration unavailable");
    return createClient({ url, authToken });
  },
  session: (request) =>
    readSteamSession(
      request,
      import.meta.env.DEV ? import.meta.env.STEAM_API_KEY : env.STEAM_API_KEY,
    ),
});

export const prerender = false;
export const GET: APIRoute = ({ request }) => handle(request);
export const POST: APIRoute = ({ request }) => handle(request);
