import type { AstroCookies } from "astro";
import {
  issueSteamSession,
  STEAM_AUTH_COOKIE,
  STEAM_SESSION_SECONDS,
} from "./steam-session.ts";

export const STEAM_OP = "https://steamcommunity.com/openid/login";
export const OPENID_NS = "http://specs.openid.net/auth/2.0";
export const STEAM_STATE_COOKIE = "__Host-steam_openid_state";
export const STATE_SECONDS = 300;
const CALLBACK_PATH = "/api/auth/steam/callback";
const cookieOptions = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax" as const,
};
type Cookies = Pick<AstroCookies, "get" | "set" | "delete">;
type Dependencies = {
  // Origin comes from build-time site config, never Host/Forwarded headers.
  site?: string;
  secret: () => string | undefined;
  fetch: typeof fetch;
  now?: () => number;
};

export function trustedSteamOrigin(site = "https://lamateam.eu"): string {
  const url = new URL(site);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Steam login requires an HTTPS site origin");
  }
  return url.origin;
}

async function stateKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`lamateam:steam-openid-state:v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function issueState(secret: string, now: number) {
  const state = hex(crypto.getRandomValues(new Uint8Array(32)));
  const payload = `${state}.${Math.floor(now / 1000) + STATE_SECONDS}`;
  const mac = await crypto.subtle.sign(
    "HMAC",
    await stateKey(secret),
    new TextEncoder().encode(payload),
  );
  return { state, cookie: `${payload}.${hex(new Uint8Array(mac))}` };
}

async function validState(
  state: string,
  cookie: string | undefined,
  secret: string,
  now: number,
) {
  if (!/^[a-f0-9]{64}$/.test(state)) return false;
  const match = cookie?.match(/^([a-f0-9]{64})\.(\d{10})\.([a-f0-9]{64})$/);
  if (!match || match[1] !== state) return false;
  const seconds = Math.floor(now / 1000);
  if (Number(match[2]) <= seconds || Number(match[2]) > seconds + STATE_SECONDS)
    return false;
  return crypto.subtle.verify(
    "HMAC",
    await stateKey(secret),
    Uint8Array.from(match[3].match(/../g)!, (byte) => parseInt(byte, 16)),
    new TextEncoder().encode(`${match[1]}.${match[2]}`),
  );
}

function assertionSteamID(
  params: URLSearchParams,
  returnTo: string,
  now: number,
): string | null {
  // Reject ambiguous duplicate parameters instead of relying on parser ordering.
  for (const key of params.keys()) {
    if (
      params.getAll(key).length !== 1 ||
      (key !== "state" && !key.startsWith("openid."))
    )
      return null;
  }
  if (
    params.get("openid.ns") !== OPENID_NS ||
    params.get("openid.mode") !== "id_res" ||
    params.get("openid.op_endpoint") !== STEAM_OP ||
    params.get("openid.return_to") !== returnTo
  )
    return null;
  const claimed = params.get("openid.claimed_id");
  const identity = params.get("openid.identity");
  const match = claimed?.match(
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/,
  );
  if (!match || claimed !== identity) return null;
  const nonce = params.get("openid.response_nonce") || "";
  const timestamp = nonce.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z).+$/,
  )?.[1];
  if (!timestamp) return null;
  const time = Date.parse(timestamp);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== timestamp.replace("Z", ".000Z") ||
    now - time > STATE_SECONDS * 1000 ||
    time - now > 30_000
  )
    return null;
  const signed = new Set((params.get("openid.signed") || "").split(","));
  for (const key of [
    "op_endpoint",
    "claimed_id",
    "identity",
    "return_to",
    "response_nonce",
    "assoc_handle",
  ]) {
    if (!signed.has(key) || !params.get(`openid.${key}`)) return null;
  }
  if (!params.get("openid.sig")) return null;
  return match[1];
}

async function verifyAssertion(params: URLSearchParams, fetcher: typeof fetch) {
  const body = new URLSearchParams();
  for (const [key, value] of params)
    if (key.startsWith("openid.")) body.set(key, value);
  body.set("openid.mode", "check_authentication");
  const signal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetcher(STEAM_OP, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (error) {
    throw error;
  }
  if (!response.ok) return false;
  const lines = (await response.text()).split(/\r?\n/);
  return (
    lines.filter((line) => line.startsWith("is_valid:")).length === 1 &&
    lines.includes("is_valid:true") &&
    lines.filter((line) => line.startsWith("ns:")).length === 1 &&
    lines.includes(`ns:${OPENID_NS}`)
  );
}

export function createSteamOpenIdHandlers(deps: Dependencies) {
  const now = deps.now || Date.now;
  const response = (body: string | null, status: number, location?: string) =>
    new Response(body, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(location ? { Location: location } : {}),
      },
    });
  return {
    async start(request: Request, cookies: Cookies): Promise<Response> {
      try {
        const origin = trustedSteamOrigin(deps.site);
        if (new URL(request.url).origin !== origin)
          return response("Invalid login origin", 403);
        const secret = deps.secret();
        if (!secret) return response("Server configuration error", 500);
        const { state, cookie } = await issueState(secret, now());
        cookies.set(STEAM_STATE_COOKIE, cookie, {
          ...cookieOptions,
          maxAge: STATE_SECONDS,
        });
        const params = new URLSearchParams({
          "openid.ns": OPENID_NS,
          "openid.mode": "checkid_setup",
          "openid.return_to": `${origin}${CALLBACK_PATH}?state=${state}`,
          "openid.realm": origin,
          "openid.identity": `${OPENID_NS}/identifier_select`,
          "openid.claimed_id": `${OPENID_NS}/identifier_select`,
        });
        return response(null, 302, `${STEAM_OP}?${params}`);
      } catch {
        return response("Server configuration error", 500);
      }
    },
    async callback(request: Request, cookies: Cookies): Promise<Response> {
      // Consume browser state on every outcome, before any network operation.
      let stateCookie: string | undefined;
      try {
        stateCookie = cookies.get(STEAM_STATE_COOKIE)?.value;
        cookies.delete(STEAM_STATE_COOKIE, cookieOptions);
      } catch (error) {
        // Preserve the existing propagation of cookie-consumption failures.
        throw error;
      }
      try {
        const origin = trustedSteamOrigin(deps.site);
        const url = new URL(request.url);
        if (url.origin !== origin || url.pathname !== CALLBACK_PATH) {
          return response("Authentication failed", 401);
        }
        const secret = deps.secret();
        if (!secret) {
          return response("Server configuration error", 500);
        }
        const params = url.searchParams;
        const state = params.get("state") || "";
        const currentTime = now();
        if (!(await validState(state, stateCookie, secret, currentTime))) {
          return response("Authentication failed", 401);
        }
        const steamID = assertionSteamID(
          params,
          `${origin}${CALLBACK_PATH}?state=${state}`,
          currentTime,
        );
        if (!steamID) {
          return response("Authentication failed", 401);
        }
        if (!(await verifyAssertion(params, deps.fetch))) {
          return response("Authentication failed", 401);
        }
        const apiUrl = new URL(
          "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
        );
        apiUrl.searchParams.set("key", secret);
        apiUrl.searchParams.set("steamids", steamID);
        let profile: Response;
        try {
          const fetcher = deps.fetch;
          profile = await fetcher(apiUrl.toString(), {
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
        } catch (error) {
          throw error;
        }
        if (!profile.ok) {
          return response("Authentication failed", 401);
        }
        let data: {
          response?: {
            players?: Array<{
              personaname?: string;
              avatar?: string;
              avatarfull?: string;
            }>;
          };
        };
        try {
          data = (await profile.json()) as typeof data;
        } catch {
          return response("Authentication failed", 401);
        }
        const player = data.response?.players?.[0];
        const sessionData = {
          steamID,
          playerName: player?.personaname || `Player ${steamID}`,
          playerAvatar: player?.avatarfull || player?.avatar || "",
        };
        const session = await issueSteamSession(steamID, secret, currentTime);
        cookies.set(STEAM_AUTH_COOKIE, session, {
          ...cookieOptions,
          maxAge: STEAM_SESSION_SECONDS,
        });
        const displaySession = encodeURIComponent(JSON.stringify(sessionData));
        cookies.set("session", displaySession, {
          ...cookieOptions,
          maxAge: STEAM_SESSION_SECONDS,
        });
        return response(null, 302, `${origin}/`);
      } catch {
        return response("Authentication failed", 401);
      }
    },
  };
}
