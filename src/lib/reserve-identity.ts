import { parseCookie } from "cookie";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";
import { isGameUserAgent } from "./motd-locale.ts";
import type { SteamProfile } from "./steam-profile.ts";

/** A checkout target hint only, never authentication or activation authority.
 * signedProfile must come from middleware's verified Steam session. MOTD's
 * communityid (query, then cookie) is self-asserted, even with a game UA. */
export function reserveSteamPrefill(
  request: Request,
  signedProfile: SteamProfile | null | undefined,
): string {
  if (signedProfile) return signedProfile.steamID;
  const ua = request.headers.get("user-agent");
  if (!ua || ua.length > 512 || !isGameUserAgent(ua)) return "";
  const params = new URL(request.url).searchParams;
  if (params.getAll("communityid").length > 1) return "";
  const cookies = parseCookie(request.headers.get("cookie") || "");
  return (
    normalizeMotdCommunityId(
      params.get("communityid") ?? cookies.communityid ?? "",
    ) ?? ""
  );
}
