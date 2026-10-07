import { parse, type DefaultTreeAdapterMap } from "parse5";

/** Server-only adapter: neither the upstream URL nor query accepts visitor input. */
export const HLSTATS_URL =
  "https://stats.lamateam.eu/hlstats.php?mode=players&game=css";
export const HLSTATS_SECRET_HEADER = "X-LamaTeam-Stats-Key";
const CACHE_KEY = "https://lamateam.eu/_internal/hlstats-players-v2";
const FRESH_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const RETRY_MS = 60_000;
const MAX_BYTES = 1_048_576;
const MAX_PLAYERS = 100;

export interface HlstatsPlayer {
  /** HLstats numeric identifier, not proof of Steam identity or ownership. */
  playerId: number;
  rank: number;
  name: string;
  country: string;
  flagUrl: string | null;
  flagAlt: string;
  rankUrl: string | null;
  skill: number | null;
  kills: number | null;
  deaths: number | null;
  kpd: string | null;
  headshots: number | null;
  accuracy: string | null;
}
export interface HlstatsResult {
  players: HlstatsPlayer[];
  fetchedAt: number | null;
  stale: boolean;
  error: boolean;
}

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type CacheStore = Pick<Cache, "match" | "put">;
type Snapshot = {
  players: HlstatsPlayer[] | null;
  fetchedAt: number;
  retryAt: number;
  error: boolean;
};
const empty = (): HlstatsResult => ({
  players: [],
  fetchedAt: null,
  stale: false,
  error: true,
});
function isElement(node: Node): node is Element {
  return "tagName" in node;
}
function attr(node: Element, name: string): string {
  return node.attrs.find((a) => a.name === name)?.value ?? "";
}
function classes(node: Element, name: string): boolean {
  return attr(node, "class").split(/\s+/).includes(name);
}
function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
function elements(node: Node, tag: string): Element[] {
  return children(node)
    .filter(isElement)
    .filter((n) => n.tagName === tag);
}
function descendants(node: Node, tag: string): Element[] {
  return children(node).flatMap((n) => [
    ...(isElement(n) && n.tagName === tag ? [n] : []),
    ...descendants(n, tag),
  ]);
}
function text(node: Node): string {
  if (
    isElement(node) &&
    ["script", "style", "template", "textarea", "noscript"].includes(
      node.tagName,
    )
  )
    return "";
  return "value" in node ? node.value : children(node).map(text).join("");
}
function clean(node: Node): string {
  return text(node)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 256);
}
function image(cell: Element): Element | undefined {
  return descendants(cell, "img")[0];
}
/** Only inert image paths on the stats origin; no credentials, query or fragment. */
function imageUrl(node: Element | undefined): string | null {
  if (!node) return null;
  try {
    const url = new URL(attr(node, "src"), HLSTATS_URL);
    return url.origin === "https://stats.lamateam.eu" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/hlstatsimg\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|gif|jpe?g|webp)$/.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function integer(value: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const number = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function decimal(value: string, percent = false): string | null {
  if (!(percent ? /^\d+(?:\.\d+)?%$/ : /^\d+(?:\.\d+)?$/).test(value))
    return null;
  const number = Number(value.replace("%", ""));
  return Number.isFinite(number) && (!percent || number <= 100) ? value : null;
}

/** Parse only unambiguous same-origin player-info links. Never use names as IDs. */
export function parseHlstatsPlayerId(href: string): number | null {
  try {
    const url = new URL(href, HLSTATS_URL);
    if (
      url.origin !== "https://stats.lamateam.eu" ||
      url.pathname !== "/hlstats.php" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll("mode").length !== 1 ||
      url.searchParams.get("mode") !== "playerinfo" ||
      url.searchParams.getAll("player").length !== 1
    )
      return null;
    const value = url.searchParams.get("player") ?? "";
    if (!/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** Accept the HLstatsX players table, not challenge pages or arbitrary tables. */
function parseBoundedDocument(html: string) {
  if (new TextEncoder().encode(html).byteLength > MAX_BYTES)
    throw new Error("HLstats document too large");
  const document = parse(html);
  // Bound traversal depth/node count before recursive extraction.
  const queue: [Node, number][] = [[document, 0]];
  let count = 0;
  while (queue.length) {
    const [node, depth] = queue.pop()!;
    if (++count > 50_000 || depth > 100)
      throw new Error("HLstats document too complex");
    for (const child of children(node)) queue.push([child, depth + 1]);
  }
  return document;
}

export function parseHlstatsPlayers(html: string): HlstatsPlayer[] {
  const document = parseBoundedDocument(html);
  const tables = descendants(document, "table").filter((n) =>
    classes(n, "data-table"),
  );
  for (const table of tables) {
    const rows = children(table).flatMap((n) =>
      isElement(n) && n.tagName === "tr"
        ? [n]
        : isElement(n) && ["tbody", "thead", "tfoot"].includes(n.tagName)
          ? elements(n, "tr")
          : [],
    );
    const header = rows.find((r) => classes(r, "data-table-head"));
    if (!header) continue;
    const cells = children(header)
      .filter(isElement)
      .filter((n) => ["td", "th"].includes(n.tagName));
    const labels = cells.map(clean);
    if (
      labels[0] !== "Rank" ||
      !["Player", "Kills", "Deaths", "K:D", "Headshots", "Accuracy"].every(
        (label) => labels.filter((l) => l === label).length === 1,
      )
    )
      continue;
    if (
      labels.filter((l) => l === "Rank").length > 2 ||
      labels.filter((l) => l === "Points").length > 1
    )
      throw new Error("HLstats ambiguous columns");
    const players: HlstatsPlayer[] = [];
    for (const row of rows) {
      if (classes(row, "data-table-head")) continue;
      const values = elements(row, "td");
      if (
        values.length !== labels.length ||
        values.some((v) => attr(v, "colspan") || attr(v, "rowspan"))
      )
        throw new Error("HLstats invalid player row");
      const cell = (label: string) => values[labels.indexOf(label)]!;
      const rank = integer(clean(values[0]!));
      const playerCell = cell("Player");
      const links = descendants(playerCell, "a").filter(
        (a) => parseHlstatsPlayerId(attr(a, "href")) !== null,
      );
      const link = links.length === 1 ? links[0] : undefined;
      const playerId = link ? parseHlstatsPlayerId(attr(link, "href")) : null;
      const name = link ? clean(link) : "";
      if (
        !rank ||
        !name ||
        playerId === null ||
        players.some((p) => p.rank === rank || p.playerId === playerId)
      )
        throw new Error("HLstats invalid player identity");
      const flag = image(playerCell);
      const country = flag
        ? attr(flag, "alt")
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
            .trim()
            .slice(0, 128)
        : "";
      const rankIndex = labels.indexOf("Rank", 1);
      // Points can contain a skill-change tooltip: use only the numeric prefix.
      const skillText = labels.includes("Points") ? clean(cell("Points")) : "";
      const skill = integer(/^(\d[\d,]*)(?:\s|$)/.exec(skillText)?.[1] ?? "");
      players.push({
        playerId,
        rank,
        name,
        country,
        flagAlt: country,
        flagUrl: imageUrl(flag),
        rankUrl: rankIndex >= 0 ? imageUrl(image(values[rankIndex]!)) : null,
        skill,
        kills: integer(clean(cell("Kills"))),
        deaths: integer(clean(cell("Deaths"))),
        kpd: decimal(clean(cell("K:D"))),
        headshots: integer(clean(cell("Headshots"))),
        accuracy: decimal(clean(cell("Accuracy")), true),
      });
      if (players.length > MAX_PLAYERS)
        throw new Error("HLstats too many players");
    }
    return players;
  }
  throw new Error("HLstats players table missing");
}

type RefreshFailureReason =
  | "missing_secret"
  | "fetch_exception"
  | "cloudflare_challenge"
  | "http_failure"
  | "content_type_failure"
  | "size_failure"
  | "response_read_failure"
  | "parser_rejection"
  | "token_reflection";

class HlstatsResponseError extends Error {
  readonly reason: RefreshFailureReason;
  constructor(reason: RefreshFailureReason) {
    super("HLstats invalid response");
    this.reason = reason;
  }
}

async function readHtml(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const failure: RefreshFailureReason | undefined =
    response.headers.get("cf-mitigated") === "challenge"
      ? "cloudflare_challenge"
      : !response.ok
        ? "http_failure"
        : !/^text\/html(?:\s*;|$)/i.test(
              response.headers.get("content-type") ?? "",
            )
          ? "content_type_failure"
          : Number(response.headers.get("content-length")) > MAX_BYTES
            ? "size_failure"
            : !response.body
              ? "response_read_failure"
              : undefined;
  if (failure) {
    await response.body?.cancel();
    throw new HlstatsResponseError(failure);
  }
  const reader = response.body!.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new HlstatsResponseError("size_failure");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Per-colo Cache API plus per-isolate coalescing/backoff. No global rate-limit
 * exemption is assumed: the origin's existing 10/10s limit must stay active. */
export function createHlstatsLoader(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    cache?: () => CacheStore | undefined;
    timeoutMs?: number;
    /** Server-only injection; never included in snapshots or returned data. */
    bypassToken?: string;
  } = {},
) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache =
    options.cache ??
    (() =>
      (globalThis as typeof globalThis & { caches?: { default?: CacheStore } })
        .caches?.default);
  let snapshot: Snapshot | undefined;
  let pending: Promise<HlstatsResult> | undefined;
  function result(): HlstatsResult {
    if (
      !snapshot ||
      snapshot.players === null ||
      now() - snapshot.fetchedAt >= STALE_MS
    )
      return empty();
    return {
      players: snapshot.players,
      fetchedAt: snapshot.fetchedAt,
      stale: now() - snapshot.fetchedAt >= FRESH_MS,
      error: snapshot.error,
    };
  }
  async function load(bypassToken: string | undefined): Promise<HlstatsResult> {
    let store: CacheStore | undefined;
    const key = new Request(CACHE_KEY);
    try {
      store = cache();
      const response = await store?.match(key);
      if (response) {
        const value = (await response.json()) as Snapshot;
        // Cache entries are created only here, never from upstream JSON.
        if (
          typeof value.error === "boolean" &&
          Number.isFinite(value.fetchedAt) &&
          Number.isFinite(value.retryAt) &&
          value.fetchedAt <= now() &&
          value.retryAt > now() &&
          value.retryAt <= now() + FRESH_MS &&
          (value.players === null ||
            (Array.isArray(value.players) &&
              value.players.length <= MAX_PLAYERS &&
              now() - value.fetchedAt < STALE_MS))
        )
          snapshot = value;
      }
    } catch {
      /* Cache outages use the isolate snapshot instead. */
    }
    if (snapshot && now() < snapshot.retryAt) return result();
    const secretPresent =
      typeof bypassToken === "string" && !!bypassToken.trim();
    let reason: RefreshFailureReason = "missing_secret";
    let upstreamStatus: number | null = null;
    let cfMitigated = false;
    try {
      // Missing/blank secrets fail through the existing stale/backoff path.
      // Do not attempt an unauthenticated request or send an empty header.
      if (!secretPresent) throw new Error("HLstats unavailable");
      reason = "fetch_exception";
      const signal = AbortSignal.timeout(options.timeoutMs ?? 8_000);
      const response = await fetcher(HLSTATS_URL, {
        method: "GET",
        // workerd rejects "error"; manual keeps credentials on this origin.
        // readHtml rejects all non-OK responses, including redirects.
        redirect: "manual",
        headers: {
          Accept: "text/html",
          [HLSTATS_SECRET_HEADER]: bypassToken!,
        },
        signal,
      });
      upstreamStatus = response.status;
      cfMitigated = response.headers.has("cf-mitigated");
      reason = "response_read_failure";
      const html = await readHtml(response, signal);
      // Refuse reflected credentials before extracting or caching public data.
      reason = "token_reflection";
      if (html.includes(bypassToken!))
        throw new Error("HLstats invalid response");
      reason = "parser_rejection";
      const players = parseHlstatsPlayers(html);
      snapshot = {
        players,
        fetchedAt: now(),
        retryAt: now() + FRESH_MS,
        error: false,
      };
    } catch (failure) {
      // Allowlisted scalars only: never serialize exceptions, headers or bodies.
      // No Ray ID: even response header values are untrusted upstream data.
      try {
        console.warn({
          reason:
            failure instanceof HlstatsResponseError ? failure.reason : reason,
          secretPresent,
          upstreamStatus,
          cfMitigated,
        });
      } catch {
        /* Diagnostics must not change the stale/error/backoff behavior. */
      }
      snapshot = {
        players:
          snapshot && now() - snapshot.fetchedAt < STALE_MS
            ? snapshot.players
            : null,
        fetchedAt: snapshot?.fetchedAt ?? 0,
        retryAt: now() + RETRY_MS,
        error: true,
      };
    }
    try {
      await store?.put(
        key,
        new Response(JSON.stringify(snapshot), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${Math.max(1, Math.ceil((snapshot.players === null ? RETRY_MS : STALE_MS - (now() - snapshot.fetchedAt)) / 1000))}`,
          },
        }),
      );
    } catch {
      /* The in-memory fallback still bounds refreshes. */
    }
    return result();
  }
  return (bypassToken = options.bypassToken): Promise<HlstatsResult> => {
    if (snapshot && now() < snapshot.retryAt) return Promise.resolve(result());
    pending ??= load(bypassToken).finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
export const loadHlstatsPlayers = createHlstatsLoader();

/** Numeric chart values only; null means absent, hidden or invalid upstream. */
export interface HlstatsMyStats {
  rank: number | null;
  skill: number | null;
  kills: number | null;
  deaths: number | null;
  kpd: number | null;
  headshots: number | null;
  /** Percentage points (0–100), not a fraction. */
  accuracy: number | null;
}

export type HlstatsMyResult =
  | { available: true; stats: HlstatsMyStats }
  | { available: false; reason: "not_found" | "unavailable" };

/** Public individual SteamID64 only: universe/type/instance bits are fixed. */
export function hlstatsUniqueId(steamID: string): string | null {
  if (steamID.length !== 17 || !/^\d{17}$/.test(steamID)) return null;
  const account = BigInt(steamID) - 76561197960265728n;
  if (account <= 0n || account > 4294967295n) return null;
  // playerinfo.php:63 strips STEAM_0:, PlayerUniqueIds stores Y:Z.
  return `${account % 2n}:${account / 2n}`;
}

/** playerinfo_general.php's summary, never aliases or personal profile rows. */
export function parseHlstatsMyStats(
  html: string,
  steamID: string,
): HlstatsMyStats | null {
  const uniqueId = hlstatsUniqueId(steamID);
  if (!uniqueId) throw new Error("HLstats invalid identity");
  const document = parseBoundedDocument(html);
  const rows = descendants(document, "tr");
  // The source emits this exact error for zero uniqueId matches. Do not infer
  // absence from a challenge, missing summary, redirect or an arbitrary page.
  if (
    text(document).includes(`No players found matching uniqueId '${uniqueId}'`)
  )
    return null;
  const steamRows = rows.filter((row) => {
    const cells = elements(row, "td");
    return cells.length === 1 && clean(cells[0]!).startsWith("Steam:");
  });
  const identityRows = steamRows.filter((row) => {
    const cells = elements(row, "td");
    return descendants(cells[0]!, "a").some((link) => {
      const href = attr(link, "href");
      return (
        (href === `http://steamcommunity.com/profiles/${steamID}` ||
          href === `https://steamcommunity.com/profiles/${steamID}`) &&
        clean(link) === `STEAM_0:${uniqueId}`
      );
    });
  });
  if (steamRows.length !== 1 || identityRows.length !== 1)
    throw new Error("HLstats identity mismatch");
  // The fork's uniqueId lookup is not game-filtered. Require the general tab's
  // generated CSS links as well; never expose a different game's summary.
  const games = descendants(document, "a").flatMap((link) => {
    try {
      const url = new URL(attr(link, "href"), HLSTATS_URL);
      return url.origin === new URL(HLSTATS_URL).origin &&
        url.pathname === "/hlstats.php" &&
        ["servers", "mapinfo", "countryclansinfo", "weaponinfo"].includes(
          url.searchParams.get("mode") ?? "",
        )
        ? url.searchParams.getAll("game")
        : [];
    } catch {
      return [];
    }
  });
  if (!games.length || games.some((game) => game !== "css"))
    throw new Error("HLstats game mismatch");
  const summaries = descendants(document, "table").filter(
    (table) =>
      classes(table, "data-table") &&
      descendants(table, "tr").some(
        (row) =>
          classes(row, "data-table-head") &&
          clean(row) === "Statistics Summary",
      ),
  );
  if (summaries.length !== 1) throw new Error("HLstats summary missing");
  const values = new Map<string, string>();
  const labels = [
    "Rank:",
    "Points:",
    "Kills:",
    "Deaths:",
    "Kills per Death:",
    "Headshots:",
    "Weapon Accuracy:",
  ];
  for (const row of descendants(summaries[0]!, "tr")) {
    const cells = elements(row, "td");
    const label = cells[0] ? clean(cells[0]) : "";
    if (!labels.includes(label)) continue;
    if (cells.length !== 2 || values.has(label))
      throw new Error("HLstats ambiguous summary");
    // Parenthesized starred values are recent-event statistics, not totals.
    const value = clean(cells[1]!);
    const match = /^([^()]+?)(?:\s+\([^()]*\*\))?$/.exec(value);
    values.set(label, match?.[1]?.trim() ?? "");
  }
  const value = (label: string) => values.get(label) ?? "";
  const numeric = (label: string, percent = false) => {
    const parsed = decimal(value(label), percent);
    return parsed === null ? null : Number(parsed.replace("%", ""));
  };
  const stats: HlstatsMyStats = {
    rank: integer(value("Rank:")),
    skill: integer(value("Points:")),
    kills: integer(value("Kills:")),
    deaths: integer(value("Deaths:")),
    kpd: numeric("Kills per Death:"),
    headshots: integer(value("Headshots:")),
    accuracy: numeric("Weapon Accuracy:", true),
  };
  if (stats.rank === 0) stats.rank = null;
  if (Object.values(stats).every((stat) => stat === null))
    throw new Error("HLstats summary unavailable");
  return stats;
}

/** No snapshots, coalescing, Cache API or cross-user state on this path. */
export async function loadHlstatsMyStats(
  steamID: string,
  options: {
    fetch?: typeof fetch;
    bypassToken?: string;
    timeoutMs?: number;
  } = {},
): Promise<HlstatsMyResult> {
  const unavailable: HlstatsMyResult = {
    available: false,
    reason: "unavailable",
  };
  const uniqueId = hlstatsUniqueId(steamID);
  if (!uniqueId || !options.bypassToken?.trim()) return unavailable;
  try {
    const url = new URL(HLSTATS_URL);
    url.search = "";
    url.searchParams.set("mode", "playerinfo");
    url.searchParams.set("uniqueid", uniqueId);
    url.searchParams.set("game", "css");
    // playerinfo.php:215–224 supports the general tab without JS or a second
    // request using a scraped player ID; exact identity lookup runs first.
    url.searchParams.set("type", "ajax");
    url.searchParams.set("tab", "general");
    const signal = AbortSignal.timeout(options.timeoutMs ?? 8_000);
    const response = await (options.fetch ?? fetch)(url.href, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "Cache-Control": "no-store",
        [HLSTATS_SECRET_HEADER]: options.bypassToken,
      },
      signal,
    });
    const html = await readHtml(response, signal);
    if (html.includes(options.bypassToken)) return unavailable;
    const stats = parseHlstatsMyStats(html, steamID);
    return stats
      ? { available: true, stats }
      : { available: false, reason: "not_found" };
  } catch {
    // Never log identity-bearing URLs, upstream bodies, exceptions or secrets.
    return unavailable;
  }
}

export function createHlstatsMeHandler(options: {
  session: (request: Request) => Promise<string | null>;
  load: (steamID: string) => Promise<HlstatsMyResult>;
}) {
  return async (request: Request): Promise<Response> => {
    const respond = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          "CDN-Cache-Control": "no-store",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (request.method !== "GET")
      return respond({ available: false, reason: "method_not_allowed" }, 405);
    try {
      const steamID = await options.session(request);
      if (!steamID || !hlstatsUniqueId(steamID))
        return respond({ available: false, reason: "unauthorized" }, 401);
      const result = await options.load(steamID);
      return respond(
        result,
        result.available ? 200 : result.reason === "not_found" ? 404 : 503,
      );
    } catch {
      return respond({ available: false, reason: "unavailable" }, 503);
    }
  };
}
