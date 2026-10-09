import type { Client } from "@libsql/client/web";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";
import { isGameUserAgent } from "./motd-locale.ts";

type RatingDatabase = Pick<Client, "execute" | "batch">;
type Dependencies = {
  maps: readonly string[];
  database: () => RatingDatabase;
  session: (request: Request) => Promise<string | null>;
  rateLimiter?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
};

const aggregateSQL = `SELECT map, AVG(stars) AS average, COUNT(*) AS count,
  MAX(CASE WHEN steamid = ? THEN stars END) AS userRating
  FROM MapRatings`;

export function createMapRatingsHandler(deps: Dependencies) {
  const maps = new Set(
    deps.maps.filter((map) => /^[A-Za-z0-9_$-]{1,128}$/.test(map)),
  );
  const validMap = (map: unknown): map is string =>
    typeof map === "string" && maps.has(map);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        Vary: "Cookie, User-Agent",
        "X-Content-Type-Options": "nosniff",
      },
    });
  const aggregate = (map: string, row?: Record<string, unknown>) => ({
    map,
    average: row?.average == null ? null : Number(row.average),
    count: Number(row?.count ?? 0),
    userRating: row?.userRating == null ? null : Number(row.userRating),
  });

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") {
      const response = json({ error: "Method not allowed" }, 405);
      response.headers.set("Allow", "GET, POST");
      return response;
    }
    try {
      const url = new URL(request.url);
      const identity = async () => {
        const sessionID = await deps.session(request);
        const authenticated = sessionID !== null && /^\d{17}$/.test(sessionID);
        const game = isGameUserAgent(request.headers.get("user-agent"));
        const ids = url.searchParams.getAll("communityid");
        // Unsigned MOTD IDs are intentionally allowed to vote, not authentication.
        // Cookies, name and body fields never select a game's rating identity.
        const steamID = game
          ? ids.length === 1
            ? normalizeMotdCommunityId(ids[0]!)
            : null
          : authenticated
            ? sessionID
            : null;
        return { steamID, authenticated, canRate: steamID !== null, game };
      };
      if (request.method === "POST") {
        // Require Origin even for clients without Fetch Metadata. No Referer fallback.
        const site = request.headers.get("sec-fetch-site");
        if (
          request.headers.get("origin") !== url.origin ||
          (site && site !== "same-origin")
        ) {
          return json({ error: "Same-origin request required" }, 403);
        }
        if (
          request.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() !== "application/json"
        ) {
          return json({ error: "JSON body required" }, 415);
        }
        const { steamID, authenticated, canRate, game } = await identity();
        if (!steamID) return json({ error: "Steam sign-in required" }, 401);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return json({ error: "Invalid rating" }, 400);
        const { map, stars } = body as Record<string, unknown>;
        if (
          !validMap(map) ||
          typeof stars !== "number" ||
          !Number.isInteger(stars) ||
          stars < 1 ||
          stars > 5
        ) {
          return json(
            { error: "Known map and integer stars 1–5 required" },
            400,
          );
        }
        if (game) {
          // Only the CF ingress header is trusted. Never use forwarded headers
          // or a spoofable community ID as the quota key; fail closed everywhere.
          const ip = request.headers.get("cf-connecting-ip")?.trim();
          if (!ip || !deps.rateLimiter)
            return json({ error: "Map ratings unavailable" }, 503);
          const result = await deps.rateLimiter.limit({
            key: `motd-map-ratings:${ip}`,
          });
          if (result.success === false) {
            const response = json({ error: "Too many rating requests" }, 429);
            response.headers.set("Retry-After", "60");
            return response;
          }
          if (result.success !== true)
            return json({ error: "Map ratings unavailable" }, 503);
        }
        // One write transaction makes the returned aggregate include this vote.
        const results = await deps.database().batch(
          [
            {
              sql: `INSERT INTO MapRatings (map, steamid, stars) VALUES (?, ?, ?)
              ON CONFLICT(map, steamid) DO UPDATE SET stars = excluded.stars`,
              args: [map, steamID, stars],
            },
            {
              sql: `${aggregateSQL} WHERE map = ? GROUP BY map`,
              args: [steamID, map],
            },
          ],
          "write",
        );
        return json({
          ...aggregate(map, results[1].rows[0]),
          authenticated,
          canRate,
        });
      }
      const map = url.searchParams.get("map");
      if (map !== null && !validMap(map))
        return json({ error: "Unknown map" }, 400);
      const { steamID, authenticated, canRate } = await identity();
      const { rows } = await deps.database().execute({
        sql: `${aggregateSQL}${map !== null ? " WHERE map = ?" : ""} GROUP BY map`,
        args: map !== null ? [steamID, map] : [steamID],
      });
      if (map !== null)
        return json({ ...aggregate(map, rows[0]), authenticated, canRate });
      const byMap = new Map(rows.map((row) => [String(row.map), row]));
      return json({
        authenticated,
        canRate,
        ratings: Array.from(maps, (name) => aggregate(name, byMap.get(name))),
      });
    } catch {
      // Never return database URLs, tokens, SQL details, or identity in errors.
      return json({ error: "Map ratings unavailable" }, 503);
    }
  };
}
