import { hlstatsUniqueId, type HlstatsMyResult } from "./hlstats.ts";
import { isGameUserAgent } from "./motd-locale.ts";

/** SourceMod communityid is a lookup hint, never authentication. Name is ignored.
 * Normalize supported Steam64/Steam3/Steam2 forms, then reuse the public-account
 * validator used by the existing HLstats adapter. */
export function normalizeMotdCommunityId(value: string): string | null {
  if (value.length > 32) return null;
  let steamID = value;
  const steam3 = /^\[U:1:(\d{1,10})\]$/.exec(value);
  const steam2 = /^STEAM_[01]:([01]):(\d{1,10})$/.exec(value);
  if (steam3 || steam2) {
    const account = steam3
      ? BigInt(steam3[1]!)
      : BigInt(steam2![2]!) * 2n + BigInt(steam2![1]!);
    if (account <= 0n || account > 4294967295n) return null;
    steamID = (76561197960265728n + account).toString();
  }
  return hlstatsUniqueId(steamID) ? steamID : null;
}

type MotdResult =
  HlstatsMyResult | { available: false; reason: "rate_limited" };

/** Public aggregates only. Bounded per-isolate state, no database writes or
 * persistent identity cache. Coalesce identical accounts (including normalized
 * aliases); cache successes/absence for 60s and failures for 10s. At most 10
 * refreshes per 10s, even when visitors rotate IDs. The upstream's existing
 * rate limit must remain enabled: this is NOT a distributed abuse boundary. */
export function createHlstatsMotdHandler(options: {
  load: (steamID: string) => Promise<HlstatsMyResult>;
  now?: () => number;
  rateLimiter?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  development?: boolean;
}) {
  const now = options.now ?? Date.now;
  const entries = new Map<
    string,
    {
      expires: number;
      pending?: Promise<HlstatsMyResult>;
      result?: HlstatsMyResult;
    }
  >();
  let starts: number[] = [];
  async function load(steamID: string): Promise<MotdResult> {
    const time = now();
    for (const [key, entry] of entries)
      if (!entry.pending && entry.expires <= time) entries.delete(key);
    const existing = entries.get(steamID);
    if (existing?.pending) return existing.pending;
    if (existing?.result) return existing.result;
    starts = starts.filter((started) => time - started < 10_000);
    if (starts.length >= 10 || entries.size >= 128)
      return { available: false, reason: "rate_limited" };
    starts.push(time);
    const entry: {
      expires: number;
      pending?: Promise<HlstatsMyResult>;
      result?: HlstatsMyResult;
    } = { expires: time };
    entries.set(steamID, entry);
    entry.pending = Promise.resolve()
      .then(() => options.load(steamID))
      .catch((): HlstatsMyResult => ({
        available: false,
        reason: "unavailable",
      }))
      .then((result) => {
        entry.result = result;
        entry.expires =
          now() +
          (!result.available && result.reason === "unavailable"
            ? 10_000
            : 60_000);
        entry.pending = undefined;
        return result;
      });
    return entry.pending;
  }

  /** UI contract: prefer verified /api/stats/me whenever a verified session is
   * present. This endpoint ALWAYS reports unauthenticated/unverified, even if
   * a session cookie is sent. UA is spoofable and proves neither identity nor
   * ownership. Never use this result to authorize anything. */
  return async (request: Request): Promise<Response> => {
    const respond = (result: unknown, status: number, retryAfter = 10) =>
      new Response(
        JSON.stringify({
          source: "motd",
          authenticated: false,
          verified: false,
          ...(result as object),
        }),
        {
          status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, no-store",
            "CDN-Cache-Control": "no-store",
            "Cross-Origin-Resource-Policy": "same-origin",
            "X-Content-Type-Options": "nosniff",
            Vary: "User-Agent, Origin, Sec-Fetch-Site",
            ...(status === 405 ? { Allow: "GET" } : {}),
            ...(status === 429 ? { "Retry-After": String(retryAfter) } : {}),
          },
        },
      );
    const fail = (reason: string, status: number, retryAfter = 10) =>
      respond({ available: false, reason }, status, retryAfter);
    if (request.method !== "GET") return fail("method_not_allowed", 405);
    const ua = request.headers.get("user-agent");
    if (!ua || ua.length > 512 || !isGameUserAgent(ua))
      return fail("forbidden", 403);
    // Legacy MOTD browsers do not send Origin/Fetch Metadata. When provided,
    // require same-origin (same-site is insufficient); never enable CORS.
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      (origin !== null && origin !== url.origin) ||
      (site !== null && site !== "same-origin")
    )
      return fail("forbidden", 403);
    if (
      request.url.length > 2048 ||
      request.headers.has("transfer-encoding") ||
      (request.headers.has("content-length") &&
        request.headers.get("content-length") !== "0")
    )
      return fail("invalid_request", 400);
    const ids = url.searchParams.getAll("communityid");
    const names = url.searchParams.getAll("name");
    if (ids.length !== 1 || names.length > 1 || (names[0]?.length ?? 0) > 256)
      return fail("invalid_request", 400);
    const steamID = normalizeMotdCommunityId(ids[0]!);
    if (!steamID) return fail("invalid_identity", 400);
    // CF sets the ingress IP; never accept forwarding headers or a query ID as
    // a quota key. Reuse the edge 6/60s binding with a separate key namespace.
    // Only local development may substitute a missing CF IP; the limiter is
    // still required there. Enforce quota even for cached/coalesced responses.
    const ip =
      request.headers.get("cf-connecting-ip")?.trim() ||
      (options.development &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ? "local-development"
        : undefined);
    if (!ip || !options.rateLimiter) return fail("unavailable", 503);
    try {
      const result = await options.rateLimiter.limit({
        key: `motd-stats:${ip}`,
      });
      if (result.success === false) return fail("rate_limited", 429, 60);
      if (result.success !== true) return fail("unavailable", 503);
    } catch {
      // No exception serialization, IP logging, or fail-open upstream request.
      return fail("unavailable", 503);
    }
    const result = await load(steamID);
    if (!result.available)
      return fail(
        result.reason,
        result.reason === "not_found"
          ? 404
          : result.reason === "rate_limited"
            ? 429
            : 503,
      );
    // Explicit aggregate allowlist: never serialize an upstream object wholesale.
    const { rank, skill, kills, deaths, kpd, headshots, accuracy } =
      result.stats;
    return respond(
      {
        available: true,
        stats: { rank, skill, kills, deaths, kpd, headshots, accuracy },
      },
      200,
    );
  };
}
