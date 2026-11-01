import type { ObservedPlayer } from "./check-players.ts";

const MAX_PLAYERS = 30;
const MAX_RESPONSE_BYTES = 128 * 1024;

/** Ephemeral public profile names, never written back to the observation store. */
export async function enrichCheckPlayerNames(
  players: readonly ObservedPlayer[],
  options: {
    apiKey?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<(ObservedPlayer & { displayName: string | null })[]> {
  const names = new Map<string, string>();
  const ids = [
    ...new Set(players.slice(0, MAX_PLAYERS).map((p) => p.communityId)),
  ];
  if (options.apiKey?.trim() && ids.length) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
      );
      url.searchParams.set("key", options.apiKey);
      url.searchParams.set("steamids", ids.join(","));
      // Bound the whole operation (including body reads), even if a transport
      // ignores abort. Workers supports manual but not error redirects; reject
      // every 3xx below without forwarding the server-side key.
      const result = await Promise.race([
        (async () => {
          const fetcher = options.fetch ?? fetch;
          const response = await fetcher.call(globalThis, url.href, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          if (
            !response.ok ||
            response.redirected ||
            !/^application\/json(?:\s*;|$)/i.test(
              response.headers.get("content-type") ?? "",
            )
          ) {
            void response.body?.cancel().catch(() => {});
            throw new Error("Invalid Steam response");
          }
          if (!response.body) throw new Error("Missing Steam response");
          const reader = response.body.getReader();
          const cancel = () => void reader.cancel().catch(() => {});
          controller.signal.addEventListener("abort", cancel, { once: true });
          let text = "",
            bytes = 0;
          const decoder = new TextDecoder("utf-8", { fatal: true });
          try {
            for (;;) {
              controller.signal.throwIfAborted();
              const { value, done } = await reader.read();
              controller.signal.throwIfAborted();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES)
                throw new Error("Oversized Steam response");
              text += decoder.decode(value, { stream: true });
            }
            return JSON.parse(text + decoder.decode());
          } finally {
            controller.signal.removeEventListener("abort", cancel);
            cancel();
            reader.releaseLock();
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Steam timeout"));
            controller.abort();
          }, options.timeoutMs ?? 2500);
        }),
      ]);
      const rows: unknown = result?.response?.players;
      if (!Array.isArray(rows) || rows.length > MAX_PLAYERS)
        throw new Error("Invalid Steam summaries");
      for (const row of rows) {
        if (
          row &&
          typeof row.steamid === "string" &&
          ids.includes(row.steamid) &&
          typeof row.personaname === "string" &&
          row.personaname.trim().length > 0 &&
          row.personaname.length <= 128 &&
          !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(
            row.personaname,
          )
        )
          names.set(row.steamid, row.personaname.trim());
      }
    } catch {
      // Missing/private/deleted profiles and provider failures are not list
      // failures. Do not log provider URLs/errors: they may contain the key.
      names.clear();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return players.map(({ communityId, lastSeen }) => ({
    communityId,
    lastSeen,
    displayName: names.get(communityId) ?? null,
  }));
}
