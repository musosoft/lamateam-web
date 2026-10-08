/** Server-only: visitor input never selects the upstream or cache key. */
export const SOURCETV_URL =
  "https://wild-fire-819b.still-fog-235d.workers.dev/list";
const CACHE_KEY = "https://lamateam.eu/_internal/sourcetv-list-v1";
const FRESH_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const RETRY_MS = 30_000;
export const SOURCETV_MAX_BYTES = 262_144;
export const SOURCETV_TIMEOUT_MS = 8_000;
const FOREGROUND_TIMEOUT_MS = 1_500;
const CACHE_TIMEOUT_MS = 100;

export interface SourceTVExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface SourceTVResult {
  files: string[];
  stale: boolean;
  error: boolean;
  refreshing?: boolean;
}
type Snapshot = { files: string[] | null; fetchedAt: number; retryAt: number };
type CacheStore = Pick<Cache, "match" | "put">;

async function boundedCache<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Cache timeout")),
          CACHE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the existing JSON string-array contract; reject partial/malformed lists. */
export function parseSourceTVFiles(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 5_000 ||
    value.some(
      (file) =>
        typeof file !== "string" ||
        !file.trim() ||
        file.length > 1_024 ||
        /[\u0000-\u001f\u007f]/.test(file),
    )
  )
    throw new Error("Invalid SourceTV list");
  return value;
}

async function readList(
  response: Response,
  signal: AbortSignal,
): Promise<string[]> {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error("SourceTV unavailable");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    if (Number(response.headers.get("content-length")) > SOURCETV_MAX_BYTES)
      throw new Error("SourceTV list too large");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > SOURCETV_MAX_BYTES)
        throw new Error("SourceTV list too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseSourceTVFiles(JSON.parse(text));
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

export function createSourceTVLoader(
  options: {
    fetch?: typeof fetch;
    cache?: () => CacheStore | undefined;
    now?: () => number;
    timeoutMs?: number;
  } = {},
) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cache =
    options.cache ??
    (() => {
      const storage = globalThis.caches as CacheStorage & {
        default?: CacheStore;
      };
      return storage?.default;
    });
  let snapshot: Snapshot | undefined;
  let inFlight: Promise<SourceTVResult> | undefined;
  let reading: Promise<void> | undefined;
  const usable = (s: Snapshot) =>
    s.files !== null && now() - s.fetchedAt < STALE_MS;
  const result = (s: Snapshot): SourceTVResult => ({
    files: usable(s) ? s.files! : [],
    stale: usable(s) && now() - s.fetchedAt >= FRESH_MS,
    error: s.retryAt > now() || !usable(s),
  });
  function getStore(): CacheStore | undefined {
    try {
      return cache();
    } catch {
      return undefined;
    }
  }
  async function readCache(store: CacheStore | undefined): Promise<void> {
    try {
      if (!snapshot) {
        const data = await boundedCache(
          (async () => {
            const hit = await store?.match(new Request(CACHE_KEY));
            return hit ? ((await hit.json()) as Snapshot) : undefined;
          })(),
        );
        if (data && !snapshot) {
          if (
            Number.isFinite(data.fetchedAt) &&
            Number.isFinite(data.retryAt) &&
            data.fetchedAt <= now() &&
            data.retryAt <= now() + RETRY_MS
          ) {
            if (data.files !== null) parseSourceTVFiles(data.files);
            snapshot = data;
          }
        }
      }
    } catch {
      /* Cache unavailable/corrupt: retain isolate fallback. */
    }
  }
  async function refresh(
    store: CacheStore | undefined,
    timeoutMs: number,
  ): Promise<SourceTVResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const files = await Promise.race([
        fetcher(SOURCETV_URL, {
          method: "GET",
          headers: { Accept: "application/json" },
          // workerd rejects "error"; readList fails closed on 3xx responses.
          redirect: "manual",
          signal: controller.signal,
        }).then((response) => readList(response, controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("SourceTV timeout"));
          }, timeoutMs);
        }),
      ]);
      snapshot = { files, fetchedAt: now(), retryAt: 0 };
    } catch {
      snapshot = {
        files: snapshot && usable(snapshot) ? snapshot.files : null,
        fetchedAt: snapshot?.fetchedAt ?? 0,
        retryAt: now() + RETRY_MS,
      };
    } finally {
      clearTimeout(timer);
    }
    // Do not extend the one-hour data lifetime when persisting a failure.
    const ttl =
      snapshot.files === null
        ? RETRY_MS
        : Math.max(RETRY_MS, snapshot.fetchedAt + STALE_MS - now());
    try {
      await boundedCache(
        Promise.resolve(
          store?.put(
            new Request(CACHE_KEY),
            new Response(JSON.stringify(snapshot), {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": `public, max-age=${Math.ceil(ttl / 1000)}`,
              },
            }),
          ),
        ),
      );
    } catch {
      /* In-memory freshness/backoff still works without Cache API. */
    }
    return result(snapshot);
  }
  return async (
    context?: SourceTVExecutionContext,
  ): Promise<SourceTVResult> => {
    const store = getStore();
    if (!snapshot) {
      if (!reading)
        reading = readCache(store).finally(() => {
          reading = undefined;
        });
      await reading;
    }
    if (
      snapshot &&
      ((usable(snapshot) && now() - snapshot.fetchedAt < FRESH_MS) ||
        snapshot.retryAt > now())
    )
      return result(snapshot);
    const background = typeof context?.waitUntil === "function";
    if (!inFlight) {
      // No detached timers/retry loops: exactly one bounded refresh per isolate.
      inFlight = refresh(
        store,
        options.timeoutMs ??
          (background ? SOURCETV_TIMEOUT_MS : FOREGROUND_TIMEOUT_MS),
      ).finally(() => {
        inFlight = undefined;
      });
    }
    if (background) {
      try {
        // Register on every participating request so its runtime owns the work.
        context!.waitUntil(inFlight);
        return {
          ...(snapshot ? result(snapshot) : { files: [], stale: false }),
          error: false,
          refreshing: true,
        };
      } catch {
        /* Unsupported context: await the already-bounded task. */
      }
    }
    return inFlight;
  };
}

// Cache API is per Cloudflare location; coalescing/fallback is per warm isolate.
export const loadSourceTVFiles = createSourceTVLoader();
