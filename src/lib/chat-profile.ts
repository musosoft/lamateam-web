import { parseCookie } from "cookie";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";
import { isGameUserAgent } from "./motd-locale.ts";
import type { SteamProfile } from "./steam-profile.ts";

export const DEFAULT_CHAT_AVATAR = "/assets/default-avatar.webp";

/** Display enrichment only, never authentication. One bounded request also
 * serves the recent-feed repair; malformed IDs and bot identities are excluded. */
export async function resolveChatAvatars(
  steamIDs: string[],
  apiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  const ids = [...new Set(steamIDs)].filter(
    (id) => /^\d{17}$/.test(id) && normalizeMotdCommunityId(id) === id,
  ).slice(0, 50);
  if (!apiKey || !ids.length) return avatars;
  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", ids.join(","));
    const response = await fetcher(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return avatars;
    const data = await response.json() as {
      response?: { players?: { steamid: string; avatarfull?: string }[] };
    };
    for (const player of data.response?.players ?? []) {
      if (!ids.includes(player.steamid) || !player.avatarfull) continue;
      try {
        const avatar = new URL(player.avatarfull);
        if (
          avatar.protocol === "https:" && !avatar.username && !avatar.password &&
          !avatar.port && /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$/.test(avatar.hostname)
        ) avatars.set(player.steamid, avatar.href);
      } catch { /* Invalid upstream metadata is not an avatar. */ }
    }
  } catch { /* Steam outages must not prevent reading or posting chat. */ }
  return avatars;
}

/** Chat-only exception approved for MOTD: UA and communityid are spoofable.
 * This is a self-asserted identity, NOT Steam authentication. Never expose it
 * through locals.steamProfile or use it to authorize other site features. */
export function resolveChatProfile(
  request: Request,
  signedProfile: SteamProfile | null | undefined,
): { profile: SteamProfile; source: "steam" | "motd" } | null {
  if (signedProfile) return { profile: signedProfile, source: "steam" };
  if (!isGameUserAgent(request.headers.get("user-agent"))) return null;
  const params = new URL(request.url).searchParams;
  if (
    params.getAll("communityid").length > 1 ||
    params.getAll("name").length > 1
  )
    return null;
  const cookies = parseCookie(request.headers.get("cookie") || "");
  const steamID = normalizeMotdCommunityId(
    params.get("communityid") ?? cookies.communityid ?? "",
  );
  if (!steamID) return null;
  const name = params.get("name") ?? cookies.name ?? "";
  return {
    source: "motd",
    profile: {
      steamID,
      playerName: name.trim().slice(0, 128) || "Steam player",
      playerAvatar: DEFAULT_CHAT_AVATAR,
    },
  };
}
