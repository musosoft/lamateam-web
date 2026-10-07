import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createSteamOpenIdHandlers } from "../../../lib/steam-openid";

const handlers = createSteamOpenIdHandlers({
  site: import.meta.env.SITE || undefined,
  secret: () =>
    import.meta.env.DEV ? import.meta.env.STEAM_API_KEY : env.STEAM_API_KEY,
  fetch,
});

export const GET: APIRoute = ({ request, cookies }) =>
  handlers.start(request, cookies);
