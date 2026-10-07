import type { Client } from "@libsql/client/web";

type RatingDatabase = Pick<Client, "execute" | "batch">;
type Dependencies = {
  maps: readonly string[];
  database: () => RatingDatabase;
  session: (request: Request) => Promise<string | null>;
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
        Vary: "Cookie",
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
        const steamID = await deps.session(request);
        if (!steamID || !/^\d{17}$/.test(steamID))
          return json({ error: "Steam sign-in required" }, 401);
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
        return json(aggregate(map, results[1].rows[0]));
      }
      const map = url.searchParams.get("map");
      if (map !== null && !validMap(map))
        return json({ error: "Unknown map" }, 400);
      const steamID = await deps.session(request);
      const { rows } = await deps.database().execute({
        sql: `${aggregateSQL}${map !== null ? " WHERE map = ?" : ""} GROUP BY map`,
        args: map !== null ? [steamID, map] : [steamID],
      });
      const authenticated = steamID !== null;
      if (map !== null)
        return json({ ...aggregate(map, rows[0]), authenticated });
      const byMap = new Map(rows.map((row) => [String(row.map), row]));
      return json({
        authenticated,
        ratings: Array.from(maps, (name) => aggregate(name, byMap.get(name))),
      });
    } catch {
      // Never return database URLs, tokens, SQL details, or identity in errors.
      return json({ error: "Map ratings unavailable" }, 503);
    }
  };
}
