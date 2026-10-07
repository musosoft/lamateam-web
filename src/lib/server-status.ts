/** Fixed FakaHeda JSON feed; never accept a URL or server address from a caller. */
export const SERVER_STATUS_URL =
  "https://query.fakaheda.eu/82.208.17.101:27516.feed";

const CACHE_KEY = "https://lamateam.eu/_internal/server-status-v1";
const CACHE_TTL_MS = 60_000;
const MAX_STALE_MS = 10 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const TIMEOUT_MS = 4_000;

export interface ServerStatus {
  players: number | null;
  fetchedAt: number | null;
  stale: boolean;
  error: boolean;
}

type CacheStore = Pick<Cache, "match" | "put">;
type Snapshot = ServerStatus & { checkedAt: number };

/** Read only the documented count field, never names or other upstream data. */
export function parseServerPlayerCount(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const players = (value as { players?: unknown }).players;
  if (typeof players === "number")
    return Number.isSafeInteger(players) && players >= 0 ? players : null;
  if (typeof players !== "string" || !/^\d{1,6}$/.test(players)) return null;
  const count = Number(players);
  return Number.isSafeInteger(count) ? count : null;
}

async function readBoundedJson(response: Response, signal: AbortSignal) {
  if (
    !response.ok ||
    !/^(?:application\/json|text\/html)(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    ) ||
    Number(response.headers.get("content-length")) > MAX_BODY_BYTES ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error("Invalid server status response");
  }

  const reader = response.body.getReader();
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error("Server status too large");
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validSnapshot(value: unknown, now: number): value is Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<Snapshot>;
  return (
    (snapshot.players === null ||
      (Number.isSafeInteger(snapshot.players) && snapshot.players! >= 0)) &&
    (snapshot.fetchedAt === null ||
      (Number.isFinite(snapshot.fetchedAt) && snapshot.fetchedAt! <= now)) &&
    Number.isFinite(snapshot.checkedAt) &&
    snapshot.checkedAt! <= now &&
    now - snapshot.checkedAt! < CACHE_TTL_MS &&
    typeof snapshot.stale === "boolean" &&
    typeof snapshot.error === "boolean"
  );
}

/** One-minute shared cache, per-isolate request coalescing, and bounded stale fallback. */
export function createServerStatusLoader(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    cache?: () => CacheStore | undefined;
    timeoutMs?: number;
  } = {},
) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache =
    options.cache ??
    (() =>
      (globalThis as typeof globalThis & { caches?: { default?: CacheStore } })
        .caches?.default);
  let lastGood: { players: number; fetchedAt: number } | undefined;
  let localSnapshot: Snapshot | undefined;
  let pending: Promise<ServerStatus> | undefined;

  async function load(): Promise<ServerStatus> {
    if (localSnapshot && validSnapshot(localSnapshot, now()))
      return {
        players: localSnapshot.players,
        fetchedAt: localSnapshot.fetchedAt,
        stale: localSnapshot.stale,
        error: localSnapshot.error,
      };
    const key = new Request(CACHE_KEY);
    let store: CacheStore | undefined;
    try {
      store = cache();
      const cached = await store?.match(key);
      if (cached) {
        const value: unknown = await cached.json();
        if (validSnapshot(value, now())) {
          localSnapshot = value;
          if (value.players !== null && value.fetchedAt !== null)
            lastGood = { players: value.players, fetchedAt: value.fetchedAt };
          return {
            players: value.players,
            fetchedAt: value.fetchedAt,
            stale: value.stale,
            error: value.error,
          };
        }
      }
    } catch {
      // Cache failures fall through to the upstream request.
    }

    let snapshot: Snapshot;
    try {
      const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      const response = await fetcher(SERVER_STATUS_URL, {
        method: "GET",
        // Do not follow redirects to an untrusted host.
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal,
      });
      const body = await readBoundedJson(response, signal);
      const players = parseServerPlayerCount(body);
      if (players === null) throw new Error("Invalid player count");
      const fetchedAt = now();
      lastGood = { players, fetchedAt };
      snapshot = {
        players,
        fetchedAt,
        checkedAt: fetchedAt,
        stale: false,
        error: false,
      };
    } catch {
      const checkedAt = now();
      const recent =
        lastGood && checkedAt - lastGood.fetchedAt < MAX_STALE_MS
          ? lastGood
          : undefined;
      snapshot = {
        players: recent?.players ?? null,
        fetchedAt: recent?.fetchedAt ?? null,
        checkedAt,
        stale: !!recent,
        error: true,
      };
    }
    localSnapshot = snapshot;

    try {
      await store?.put(
        key,
        new Response(JSON.stringify(snapshot), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
          },
        }),
      );
    } catch {
      // Keep serving the isolate result if the shared cache is unavailable.
    }
    return {
      players: snapshot.players,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
      error: snapshot.error,
    };
  }

  return () => {
    pending ??= load().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

export const loadServerStatus = createServerStatusLoader();
