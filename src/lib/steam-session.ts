import { parseCookie } from "cookie";

// The legacy JSON session is display-only: HttpOnly does not prevent forgery.
// Bind rating authorization to a MAC issued only after Steam OpenID verification.
export const STEAM_AUTH_COOKIE = "steam_auth";
export const STEAM_SESSION_SECONDS = 60 * 60 * 24;

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`lamateam:steam-session:v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueSteamSession(
  steamID: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  if (!/^\d{17}$/.test(steamID) || !secret)
    throw new Error("Invalid session configuration");
  const payload = `v1.${steamID}.${Math.floor(now / 1000) + STEAM_SESSION_SECONDS}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(payload),
  );
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${payload}.${hex}`;
}

export async function readSteamSession(
  request: Request,
  secret: string | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!secret) return null;
  try {
    const token = parseCookie(request.headers.get("cookie") || "")[
      STEAM_AUTH_COOKIE
    ];
    const match = token?.match(/^v1\.(\d{17})\.(\d{10})\.([a-f0-9]{64})$/);
    if (!match) return null;
    const expires = Number(match[2]);
    const seconds = Math.floor(now / 1000);
    if (expires <= seconds || expires > seconds + STEAM_SESSION_SECONDS)
      return null;
    const signature = Uint8Array.from(match[3].match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      signature,
      new TextEncoder().encode(`v1.${match[1]}.${match[2]}`),
    );
    return valid ? match[1] : null;
  } catch {
    return null;
  }
}
