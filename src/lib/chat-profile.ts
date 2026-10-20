import { parseCookie } from "cookie";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";
import { isGameUserAgent } from "./motd-locale.ts";
import type { SteamProfile } from "./steam-profile.ts";

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
      playerAvatar: "/assets/default-avatar.webp",
    },
  };
}
