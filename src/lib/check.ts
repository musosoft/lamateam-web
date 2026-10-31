import { latestCheckPlayers } from "./check-players.ts";

/** Legacy ingestion/authorization remains gated; players/search are public review only. */
export const CHECK_SERVER_ID = "82.208.17.101:27516";
export const CHECK_ROSTER_KEY = "check:v1:roster";
export const CHECK_COOKIE = "__Host-check_cap";
export const CHECK_FRESH_MS = 90_000;
export const CHECK_SESSION_MS = 120_000;
const RECENT_MS = 30 * 60_000;
const BASE = 76561197960265728n;
const encoder = new TextEncoder();

export interface CheckKV {
  list?(options: { prefix: string; limit: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
  }>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl: number },
  ): Promise<unknown>;
}
interface Dependencies {
  kv?: CheckKV;
  ingestSecret?: string;
  sourceIngestToken?: string;
  authSecret?: string;
  mizanKey?: string;
  rateLimiter?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}
type Connected = {
  steamId64: string;
  steamId2: string;
  userId: number;
  name: string;
  ipDigest: string;
  isAdmin: boolean;
  connectedAt: number;
};
type Disconnected = {
  steamId64: string;
  steamId2: string;
  name: string;
  disconnectedAt: number;
};
type Roster = {
  version: 1;
  serverId: string;
  generatedAt: number;
  connected: Connected[];
  recentlyDisconnected: Disconnected[];
};
type Action = "authorize" | "players" | "search" | "roster" | "source-roster";
class Failure extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Check unavailable");
    this.status = status;
  }
}
function fail(status: number): never {
  throw new Failure(status);
}
function object(value: unknown, status = 400): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(status);
  return value as Record<string, unknown>;
}
function parseJSON(text: string, status = 400): unknown {
  try {
    return JSON.parse(text);
  } catch {
    fail(status);
  }
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(400);
}
function timestamp(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now
  );
}
function fresh(value: unknown, now: number): value is number {
  return timestamp(value, now) && now - value < CHECK_FRESH_MS;
}
function name(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
/** Normalize only public individual Steam accounts; arithmetic remains lossless. */
export function checkSteamId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  let account: bigint;
  if (/^\d{17}$/.test(value)) account = BigInt(value) - BASE;
  else {
    const two = /^STEAM_[01]:([01]):(\d{1,10})$/.exec(value);
    const three = /^\[U:1:(\d{1,10})\]$/.exec(value);
    if (!two && !three) return null;
    account = two ? BigInt(two[2]!) * 2n + BigInt(two[1]!) : BigInt(three![1]!);
  }
  return account > 0n && account <= 4294967295n ? String(BASE + account) : null;
}
function identity(row: Record<string, unknown>) {
  if (
    typeof row.steamId64 !== "string" ||
    checkSteamId(row.steamId64) !== row.steamId64 ||
    typeof row.steamId2 !== "string" ||
    !/^STEAM_[01]:[01]:\d{1,10}$/.test(row.steamId2) ||
    checkSteamId(row.steamId2) !== row.steamId64 ||
    !name(row.name)
  )
    fail(400);
}
/** Strict IP literals only, no port/zone/hostname. Canonicalize IPv6 and mapped IPv4. */
export function normalizeCheckIP(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 45) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split(".");
    return parts.every(
      (part) => String(Number(part)) === part && Number(part) <= 255,
    )
      ? value
      : null;
  }
  if (!/^[0-9a-fA-F:.]+$/.test(value) || !value.includes(":")) return null;
  try {
    const host = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(host);
    if (!mapped) return host;
    const a = parseInt(mapped[1]!, 16),
      b = parseInt(mapped[2]!, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  } catch {
    return null;
  }
}
async function key(secret: string, purpose?: string) {
  if (secret.length < 32) fail(503);
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(
      purpose === undefined ? secret : `lamateam:check:${purpose}:v1:${secret}`,
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function mac(secret: string, purpose: string | undefined, text: string) {
  const bytes = await crypto.subtle.sign(
    "HMAC",
    await key(secret, purpose),
    encoder.encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function verify(
  secret: string,
  purpose: string | undefined,
  text: string,
  signature: string,
) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return crypto.subtle.verify(
    "HMAC",
    await key(secret, purpose),
    Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16)),
    encoder.encode(text),
  );
}
/** Publisher protocol: raw secret key, Unix-seconds header + LF + exact UTF-8 body. */
export const signCheckRoster = (
  body: string,
  secret: string,
  timestamp: string,
) => mac(secret, undefined, `${timestamp}\n${body}`);

async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  status: number,
  signal?: AbortSignal,
) {
  if (!body) fail(status);
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  let total = 0,
    text = "";
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      total += value.byteLength;
      if (total > max) fail(status);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function json(value: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      ...extra,
    },
  });
}
function banCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail(502);
  return value;
}
function banLabels(value: unknown): string[] {
  // Element schemas are undocumented: accept bounded plain strings only, never objects/links.
  if (!Array.isArray(value) || value.length > 128) fail(502);
  return value.map((item) => {
    if (
      typeof item !== "string" ||
      !item.trim() ||
      item.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(item)
    )
      fail(502);
    return item;
  });
}
function mizanResult(value: unknown, steamId64: string, queriedAt: number) {
  const data = object(object(value, 502).data, 502);
  const player = object(data.player, 502);
  const bans = object(data.bans, 502);
  if (
    player.provider !== "steam" ||
    player.id !== steamId64 ||
    typeof data.cheater !== "boolean" ||
    typeof data.trolling !== "boolean" ||
    !Object.hasOwn(data, "record") ||
    !(
      bans.lastAt === null ||
      (typeof bans.lastAt === "string" &&
        bans.lastAt.length <= 40 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          bans.lastAt,
        ) &&
        Number.isFinite(Date.parse(bans.lastAt)))
    )
  )
    fail(502);
  return {
    queriedAt,
    profileUrl: `https://mizan.ac/players/steam/${steamId64}`,
    steamId64,
    cheater: data.cheater,
    trolling: data.trolling,
    bans: {
      total: banCount(bans.total),
      active: banCount(bans.active),
      sources: banCount(bans.sources),
      conduct: banCount(bans.conduct),
      categories: banLabels(bans.categories),
      games: banLabels(bans.games),
      lastAt: bans.lastAt,
    },
    recordPresent: data.record !== null,
  };
}

export function createCheckHandlers(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const fetcher = deps.fetch ?? fetch;
  async function loadRoster(): Promise<Roster> {
    const raw = await deps.kv!.get(CHECK_ROSTER_KEY);
    if (!raw || raw.length > 100_000) fail(503);
    const stored = object(parseJSON(raw, 503), 503);
    if (
      stored.version !== 1 ||
      stored.serverId !== CHECK_SERVER_ID ||
      !fresh(stored.generatedAt, now()) ||
      typeof stored.seal !== "string"
    )
      fail(503);
    const { seal, ...payload } = stored;
    if (
      !(await verify(
        deps.authSecret!,
        "stored-roster",
        JSON.stringify(payload),
        seal,
      ))
    )
      fail(503);
    return payload as Roster;
  }
  async function ingest(request: Request, source = false) {
    let body: string;
    if (source) {
      const token = deps.sourceIngestToken;
      if (!token || token.length < 32) fail(503);
      const supplied = request.headers.get("authorization") ?? "";
      if (supplied.length > 1024 || !supplied.startsWith("Bearer ")) fail(403);
      // HMAC both values to fixed-size bytes and use WebCrypto constant-time verification.
      const signature = await mac(
        deps.authSecret!,
        "source-token",
        supplied.slice(7),
      );
      if (!(await verify(deps.authSecret!, "source-token", token, signature)))
        fail(403);
      body = await boundedText(request.body, 96 * 1024, 413);
    } else {
      if (!deps.ingestSecret || deps.ingestSecret.length < 32) fail(503);
      const rosterTimestamp = request.headers.get("x-roster-timestamp") ?? "";
      if (
        !/^(?:0|[1-9]\d{0,11})$/.test(rosterTimestamp) ||
        Math.abs(Math.floor(now() / 1000) - Number(rosterTimestamp)) > 60
      )
        fail(403);
      body = await boundedText(request.body, 96 * 1024, 413);
      if (
        !(await verify(
          deps.ingestSecret,
          undefined,
          `${rosterTimestamp}\n${body}`,
          request.headers.get("x-roster-signature") ?? "",
        ))
      )
        fail(403);
    }
    const input = object(parseJSON(body));
    fields(input, [
      "version",
      "serverId",
      "generatedAt",
      "connected",
      "recentlyDisconnected",
    ]);
    if (
      input.version !== 1 ||
      input.serverId !== CHECK_SERVER_ID ||
      !fresh(input.generatedAt, now()) ||
      !Array.isArray(input.connected) ||
      input.connected.length > 128 ||
      !Array.isArray(input.recentlyDisconnected) ||
      input.recentlyDisconnected.length > 256
    )
      fail(400);
    const ids = new Set<string>(),
      users = new Set<number>();
    const connected: Connected[] = [];
    for (const item of input.connected) {
      const row = object(item);
      fields(row, [
        "steamId64",
        "steamId2",
        "userId",
        "name",
        "ip",
        "isAdmin",
        "connectedAt",
      ]);
      identity(row);
      const ip = normalizeCheckIP(row.ip);
      if (
        !ip ||
        typeof row.isAdmin !== "boolean" ||
        !Number.isSafeInteger(row.userId) ||
        Number(row.userId) <= 0 ||
        Number(row.userId) > 2147483647 ||
        !timestamp(row.connectedAt, input.generatedAt) ||
        ids.has(String(row.steamId64)) ||
        users.has(Number(row.userId))
      )
        fail(400);
      ids.add(String(row.steamId64));
      users.add(Number(row.userId));
      connected.push({
        steamId64: String(row.steamId64),
        steamId2: String(row.steamId2),
        userId: Number(row.userId),
        name: String(row.name),
        ipDigest: await mac(deps.authSecret!, "ip", ip),
        isAdmin: row.isAdmin,
        connectedAt: row.connectedAt,
      });
    }
    const recentlyDisconnected: Disconnected[] = [];
    for (const item of input.recentlyDisconnected) {
      const row = object(item);
      fields(row, ["steamId64", "steamId2", "name", "disconnectedAt"]);
      identity(row);
      if (
        !timestamp(row.disconnectedAt, input.generatedAt) ||
        input.generatedAt - row.disconnectedAt >= RECENT_MS ||
        ids.has(String(row.steamId64))
      )
        fail(400);
      ids.add(String(row.steamId64));
      recentlyDisconnected.push({
        steamId64: String(row.steamId64),
        steamId2: String(row.steamId2),
        name: String(row.name),
        disconnectedAt: row.disconnectedAt,
      });
    }
    // KV is eventually consistent: this is best-effort ordering, not an atomic replay ledger.
    const previous = await deps.kv!.get(CHECK_ROSTER_KEY);
    if (previous) {
      const prior = object(parseJSON(previous, 503), 503);
      if (typeof prior.generatedAt !== "number") fail(503);
      if (prior.generatedAt >= input.generatedAt) fail(409);
    }
    const roster: Roster = {
      version: 1,
      serverId: CHECK_SERVER_ID,
      generatedAt: input.generatedAt,
      connected,
      recentlyDisconnected,
    };
    const seal = await mac(
      deps.authSecret!,
      "stored-roster",
      JSON.stringify(roster),
    );
    await deps.kv!.put(CHECK_ROSTER_KEY, JSON.stringify({ ...roster, seal }), {
      expirationTtl: 3600,
    });
    // No automatic Mizan calls: detailed checks are explicitly manual only.
    return json({ accepted: true, observedAt: roster.generatedAt });
  }
  async function execute(action: Action, request: Request) {
    const method = action === "players" ? "GET" : "POST";
    if (request.method !== method)
      return json({ error: "Method not allowed" }, 405, { Allow: method });
    if (
      !deps.kv ||
      !deps.authSecret ||
      deps.authSecret.length < 32 ||
      !deps.rateLimiter
    )
      fail(503);
    const url = new URL(request.url);
    if (url.protocol !== "https:") fail(403);
    if (action !== "roster" && action !== "source-roster") {
      const origin = request.headers.get("origin"),
        site = request.headers.get("sec-fetch-site");
      if (
        (method === "POST" && origin !== url.origin) ||
        (origin !== null && origin !== url.origin) ||
        (site !== null && site !== "same-origin")
      )
        fail(403);
    }
    if (
      method === "POST" &&
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      fail(415);
    const ip = normalizeCheckIP(request.headers.get("cf-connecting-ip"));
    if (!ip) fail(403);
    const digest = await mac(deps.authSecret, "ip", ip);
    const limit = await deps.rateLimiter.limit({
      key: `check:${action}:${digest}`,
    });
    if (limit.success !== true) fail(limit.success === false ? 429 : 503);
    if (action === "roster") return ingest(request);
    if (action === "source-roster") return ingest(request, true);
    if (action === "players") return json(await latestCheckPlayers(deps.kv, now()));
    if (action === "search") {
      const body = object(parseJSON(await boundedText(request.body, 1024, 413)));
      fields(body, ["communityId"]);
      const id = checkSteamId(body.communityId);
      if (!id) fail(400);
      return json(await lookup(id));
    }
    const roster = await loadRoster();
    if (action === "authorize") {
      const body = object(
        parseJSON(await boundedText(request.body, 1024, 413)),
      );
      fields(body, ["communityId"]);
      const id = checkSteamId(body.communityId);
      const row = roster.connected.find((player) => player.steamId64 === id);
      if (
        !row ||
        !row.isAdmin ||
        row.ipDigest !== digest ||
        roster.connected.filter((player) => player.ipDigest === digest)
          .length !== 1
      )
        fail(403);
      const payload = `v1.${row.steamId64}.${row.userId}.${row.connectedAt}.${now() + CHECK_SESSION_MS}.${digest}`;
      const token = `${payload}.${await mac(deps.authSecret, "capability", payload)}`;
      return json({ authorized: true }, 200, {
        "Set-Cookie": `${CHECK_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${CHECK_SESSION_MS / 1000}`,
      });
    }
    fail(400);
  }
  async function lookup(steamId64: string) {
    if (!deps.mizanKey?.trim()) fail(503);
    const signal = AbortSignal.timeout(deps.timeoutMs ?? 12_000);
    try {
      const response = await fetcher(
        `https://api.mizan.ac/v1/players/${steamId64}`,
        {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            Accept: "application/json",
            "X-API-Key": deps.mizanKey,
          },
        },
      );
      if (
        !response.ok ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        fail(502);
      }
      const result = JSON.parse(
        await boundedText(response.body, 128 * 1024, 502, signal),
      );
      return mizanResult(result, steamId64, now());
    } catch {
      fail(signal.aborted ? 504 : 502);
    }
  }
  function handler(action: Action) {
    return async (request: Request) => {
      try {
        return await execute(action, request);
      } catch (error) {
        const status = error instanceof Failure ? error.status : 503;
        return json(
          { error: status === 403 ? "Access denied" : "Check unavailable" },
          status,
          status === 429 ? { "Retry-After": "60" } : {},
        );
      }
    };
  }
  return {
    authorize: handler("authorize"),
    players: handler("players"),
    search: handler("search"),
    roster: handler("roster"),
    sourceRoster: handler("source-roster"),
  };
}
