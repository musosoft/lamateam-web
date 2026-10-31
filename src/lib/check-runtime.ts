import { env } from "cloudflare:workers";
import { createCheckHandlers } from "./check";

const bindings = env as typeof env & Cloudflare.Env;
export const checkHandlers = createCheckHandlers({
  kv: bindings.SESSION,
  ingestSecret: bindings.CHECK_ROSTER_INGEST_SECRET,
  sourceIngestToken: bindings.CHECK_SOURCE_INGEST_TOKEN,
  authSecret: bindings.CHECK_AUTH_SECRET,
  mizanKey: bindings.MIZAN_API_KEY,
  rateLimiter: bindings.CHECK_RATE_LIMITER,
});
