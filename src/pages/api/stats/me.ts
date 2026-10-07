import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  createHlstatsMeHandler,
  loadHlstatsMyStats,
} from "../../../lib/hlstats";
import { readSteamSession } from "../../../lib/steam-session";

const statsEnv = env as typeof env & { HLSTATS_WAF_BYPASS_TOKEN?: string };
const handle = createHlstatsMeHandler({
  session: (request) =>
    readSteamSession(
      request,
      import.meta.env.DEV ? import.meta.env.STEAM_API_KEY : env.STEAM_API_KEY,
    ),
  load: (steamID) =>
    loadHlstatsMyStats(steamID, {
      bypassToken: import.meta.env.DEV
        ? import.meta.env.HLSTATS_WAF_BYPASS_TOKEN
        : statsEnv.HLSTATS_WAF_BYPASS_TOKEN,
    }),
});

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handle(request);
