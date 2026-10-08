import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { loadHlstatsMyStats } from "../../../lib/hlstats";
import { createHlstatsMotdHandler } from "../../../lib/hlstats-motd";

const statsEnv = env as typeof env &
  Cloudflare.Env & {
    HLSTATS_WAF_BYPASS_TOKEN?: string;
  };
const handle = createHlstatsMotdHandler({
  rateLimiter: statsEnv.TRANSLATION_RATE_LIMITER,
  development: import.meta.env.DEV,
  load: (steamID) =>
    loadHlstatsMyStats(steamID, {
      bypassToken: import.meta.env.DEV
        ? import.meta.env.HLSTATS_WAF_BYPASS_TOKEN
        : statsEnv.HLSTATS_WAF_BYPASS_TOKEN,
    }),
});

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handle(request);
