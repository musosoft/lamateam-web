import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleTranslationRequest } from "../../lib/deepl";

// Runtime bindings support deployed secrets without build-time env validation.
// handleTranslationRequest still guards missing/misconfigured runtime secrets.
const translationEnv = env as typeof env & Cloudflare.Env;

export const prerender = false;

export const ALL: APIRoute = ({ request }) =>
  handleTranslationRequest(request, translationEnv.DEEPL_API_KEY, {
    rateLimiter: translationEnv.TRANSLATION_RATE_LIMITER,
    development: import.meta.env.DEV,
  });
