import { parseCookie } from "cookie";
import { readSteamSession } from "./steam-session.ts";

export interface SteamProfile {
  steamID: string;
  playerName: string;
  playerAvatar: string;
}
export async function readSteamProfile(
  request: Request,
  secret?: string,
): Promise<SteamProfile | null> {
  const steamID = await readSteamSession(request, secret);
  if (!steamID) return null;
  const profile: SteamProfile = {
    steamID,
    playerName: "Steam player",
    playerAvatar: "/assets/default-avatar.webp",
  };
  try {
    const raw = parseCookie(request.headers.get("cookie") || "").session;
    const display = JSON.parse(raw || "{}");
    // A signed identity authorizes the UI; the legacy cookie supplies display
    // metadata only when it describes that same identity. Never fetch here.
    if (display?.steamID !== steamID) return profile;
    if (
      typeof display.playerName === "string" &&
      display.playerName.trim() &&
      display.playerName !== "Guest"
    )
      profile.playerName = display.playerName.slice(0, 128);
    const avatar = new URL(display.playerAvatar);
    if (
      avatar.protocol === "https:" &&
      !avatar.username &&
      !avatar.password &&
      !avatar.port &&
      /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$/.test(avatar.hostname)
    )
      profile.playerAvatar = avatar.href;
  } catch {
    /* Invalid cached metadata keeps the verified identity and fallback. */
  }
  return profile;
}
