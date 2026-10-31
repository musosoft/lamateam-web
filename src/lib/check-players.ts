import { checkSteamId, type CheckKV } from "./check.ts";

export const CHECK_PLAYER_PREFIX = "check:v2:player:";
export const CHECK_PLAYER_TTL = 7 * 24 * 60 * 60;
export const CHECK_PLAYER_LIST_LIMIT = 1000;
export type ObservedPlayer = { communityId: string; lastSeen: number };

// One-time bootstrap from the verified seven-day Workers Logs snapshot. These
// observations expire at their original age; new MOTD visits are stored in KV.
const LOG_SNAPSHOT: ObservedPlayer[] = (
  [
    ["76561198766056125", "2026-11-01T02:22:17.296+07:00"],
    ["76561199355480211", "2026-11-01T02:10:56.715+07:00"],
    ["76561198082010312", "2026-11-01T02:10:06.825+07:00"],
    ["76561197995194513", "2026-11-01T02:05:02.466+07:00"],
    ["76561197970960079", "2026-11-01T02:04:56.958+07:00"],
    ["76561199385049281", "2026-11-01T01:38:53.870+07:00"],
    ["76561198116771046", "2026-11-01T01:35:57.288+07:00"],
    ["76561197982136913", "2026-11-01T01:12:13.399+07:00"],
    ["76561199162672560", "2026-11-01T01:08:35.569+07:00"],
    ["76561198741476066", "2026-11-01T00:24:50.240+07:00"],
    ["76561197969663652", "2026-11-01T00:21:25.631+07:00"],
    ["76561198082531765", "2026-10-31T23:31:24.987+07:00"],
    ["76561197999032529", "2026-10-31T23:21:31.150+07:00"],
    ["76561199510935660", "2026-10-31T23:07:18.770+07:00"],
    ["76561198855251512", "2026-10-31T22:38:51.079+07:00"],
    ["76561198129771326", "2026-10-31T13:42:33.477+07:00"],
    ["76561198675362737", "2026-10-31T05:30:20.538+07:00"],
    ["76561198011901198", "2026-10-31T05:15:02.718+07:00"],
    ["76561198076140268", "2026-10-31T04:25:32.394+07:00"],
    ["76561198359338720", "2026-10-31T04:11:17.825+07:00"],
    ["76561198336084324", "2026-10-31T03:48:59.934+07:00"],
    ["76561199038906741", "2026-10-31T03:35:55.062+07:00"],
    ["76561198013953459", "2026-10-31T03:35:53.335+07:00"],
    ["76561199764450391", "2026-10-31T03:35:51.882+07:00"],
    ["76561197995101396", "2026-10-31T03:35:49.563+07:00"],
    ["76561198777102339", "2026-10-31T03:05:50.127+07:00"],
    ["76561198336324401", "2026-10-31T02:56:51.013+07:00"],
    ["76561197993160441", "2026-10-31T02:54:06.613+07:00"],
    ["76561198288188328", "2026-10-31T02:22:26.554+07:00"],
    ["76561198018787607", "2026-10-31T02:09:17.862+07:00"],
  ] as const
).map(([communityId, time]) => ({
  communityId,
  lastSeen: Date.parse(time),
}));

/** Store only a normalized public identity and observation time. No URL/name/IP. */
export async function recordCheckPlayer(
  kv: CheckKV,
  identity: unknown,
  lastSeen: number,
  now = Date.now(),
): Promise<void> {
  const communityId = checkSteamId(identity);
  const remaining = CHECK_PLAYER_TTL - Math.floor((now - lastSeen) / 1000);
  if (
    !communityId ||
    !Number.isSafeInteger(lastSeen) ||
    lastSeen <= 0 ||
    lastSeen > now ||
    remaining < 60 ||
    remaining > CHECK_PLAYER_TTL
  )
    throw new Error("Invalid observation");
  await kv.put(
    CHECK_PLAYER_PREFIX + communityId,
    JSON.stringify({ lastSeen }),
    {
      expirationTtl: remaining,
    },
  );
}

/** One bounded page, never an unbounded walk. Refuse incomplete results rather
 * than claiming an arbitrary lexicographic subset is the latest 30. */
export async function latestCheckPlayers(kv: CheckKV, now: number) {
  if (!kv.list) throw new Error("Observation listing unavailable");
  const page = await kv.list({
    prefix: CHECK_PLAYER_PREFIX,
    limit: CHECK_PLAYER_LIST_LIMIT,
  });
  if (!page.list_complete || page.keys.length > CHECK_PLAYER_LIST_LIMIT)
    throw new Error("Observation capacity exceeded");
  const players = new Map<string, ObservedPlayer>();
  for (const player of LOG_SNAPSHOT) {
    if (
      checkSteamId(player.communityId) === player.communityId &&
      player.lastSeen <= now &&
      now - player.lastSeen < CHECK_PLAYER_TTL * 1000
    )
      players.set(player.communityId, player);
  }
  // Bound concurrent subrequests as well as total work.
  for (let start = 0; start < page.keys.length; start += 20) {
    await Promise.all(
      page.keys.slice(start, start + 20).map(async ({ name }) => {
        const communityId = name.slice(CHECK_PLAYER_PREFIX.length);
        if (
          !name.startsWith(CHECK_PLAYER_PREFIX) ||
          checkSteamId(communityId) !== communityId
        )
          return;
        const raw = await kv.get(name);
        if (!raw || raw.length > 128) return;
        try {
          const value = JSON.parse(raw);
          const lastSeen = value?.lastSeen;
          if (
            !Number.isSafeInteger(lastSeen) ||
            lastSeen <= 0 ||
            lastSeen > now ||
            now - lastSeen >= CHECK_PLAYER_TTL * 1000
          )
            return;
          if (lastSeen > (players.get(communityId)?.lastSeen ?? 0))
            players.set(communityId, { communityId, lastSeen });
        } catch {
          /* Corrupt individual observations are not identities. */
        }
      }),
    );
  }
  const latest = [...players.values()]
    .sort(
      (a, b) =>
        b.lastSeen - a.lastSeen || a.communityId.localeCompare(b.communityId),
    )
    .slice(0, 30);
  return { observedAt: latest[0]?.lastSeen ?? null, players: latest };
}
