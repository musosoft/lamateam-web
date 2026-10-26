import { parseCookie } from "cookie";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";
import { isGameUserAgent } from "./motd-locale.ts";
import type { SteamProfile } from "./steam-profile.ts";

export const DEFAULT_CHAT_AVATAR = "/assets/default-avatar.webp";
const STEAM_AVATAR_HOSTS = new Set([
  "avatars.steamstatic.com",
  "avatars.cloudflare.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "steamuserimages-a.akamaihd.net",
  "avatars.akamai.steamstatic.com",
]);

/** Display enrichment only, never authentication. Batch at most the latest
 * 50 identities into one time-bounded lookup; outages keep chat available. */
export async function resolveChatAvatars(
  steamIDs: string[],
  apiKey?: string,
  fetcher: typeof fetch = globalThis.fetch,
  diagnostic?: (event: string) => void,
): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  const ids = [...new Set(steamIDs)].filter(
    (id) => /^\d{17}$/.test(id) && normalizeMotdCommunityId(id) === id,
  ).slice(0, 50);
  if (!apiKey || !ids.length) return avatars;
  const lookup = async (requestedIDs: string[]) => {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", requestedIDs.join(","));
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
    } catch (error) {
      diagnostic?.(`steam-fetch-error:${requestedIDs.length}:${error instanceof Error ? error.name : "unknown"}`);
      return false;
    }
    if (!response.ok) {
      diagnostic?.(`steam-http-${response.status}:${requestedIDs.length}`);
      return false;
    }
    const data = await response.json() as {
      response?: { players?: { steamid: string; avatarfull?: string }[] };
    };
    if (!Array.isArray(data?.response?.players)) {
      diagnostic?.(`steam-payload-invalid:${requestedIDs.length}`);
      return false;
    }
    for (const player of data.response.players) {
      if (!player || !requestedIDs.includes(player.steamid) || typeof player.avatarfull !== "string") continue;
      try {
        const avatar = new URL(player.avatarfull);
        if (
          avatar.protocol === "https:" && !avatar.username && !avatar.password &&
          !avatar.port && STEAM_AVATAR_HOSTS.has(avatar.hostname)
        ) avatars.set(player.steamid, avatar.href);
      } catch { /* Invalid upstream metadata is not an avatar. */ }
    }
    diagnostic?.(`steam-ok:${requestedIDs.length}:${avatars.size}`);
    return true;
  };

  try {
    const batchSucceeded = await lookup(ids);
    // Steam occasionally rejects or incompletely answers multi-ID requests.
    // Retry only missing IDs individually; this mirrors the known-good profile
    // endpoint and avoids leaving the whole feed on placeholder avatars.
    const missingIDs = ids.filter((id) => !avatars.has(id));
    if (!batchSucceeded || missingIDs.length) {
      for (const id of missingIDs) {
        try {
          await lookup([id]);
        } catch { /* A Steam outage must not prevent reading or posting chat. */ }
      }
    }

    // The existing single-profile endpoint follows Steam's working request
    // path and remains a final fallback if direct/batched requests are denied.
    for (const id of ids.filter((steamID) => !avatars.has(steamID))) {
      try {
        const profileURL = new URL("https://lamateam-web.still-fog-235d.workers.dev/api/steamUser");
        profileURL.searchParams.set("steamid", id);
        const response = await fetcher(profileURL, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
          diagnostic?.(`profile-http-${response.status}`);
          continue;
        }
        const data = await response.json() as { avatar?: unknown };
        if (typeof data.avatar !== "string") continue;
        const avatar = new URL(data.avatar);
        if (
          avatar.protocol === "https:" && !avatar.username && !avatar.password &&
          !avatar.port && STEAM_AVATAR_HOSTS.has(avatar.hostname)
        ) {
          avatars.set(id, avatar.href);
          diagnostic?.("profile-ok");
        }
      } catch (error) {
        diagnostic?.(`profile-fetch-error:${error instanceof Error ? error.name : "unknown"}`);
        /* Keep the default avatar when Steam or the profile route is unavailable. */
      }
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
