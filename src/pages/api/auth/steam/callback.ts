// src/pages/api/auth/steam/callback.ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

type SteamPlayerSummaries = {
  response?: {
    players?: Array<{
      personaname?: string;
      avatar?: string;
      avatarfull?: string;
    }>;
  };
};

function extractSteamId(claimedId: string): string {
  const m = claimedId.match(/\/id\/(\d{17})$/);
  return m ? m[1] : "";
}

async function verifyOpenId(
  params: URLSearchParams,
): Promise<{ ok: boolean; raw: string }> {
  const required = [
    "openid.ns",
    "openid.mode",
    "openid.op_endpoint",
    "openid.claimed_id",
    "openid.identity",
    "openid.return_to",
    "openid.response_nonce",
    "openid.assoc_handle",
    "openid.signed",
    "openid.sig",
  ];

  for (const k of required) {
    if (!params.get(k)) {
      return { ok: false, raw: `missing:${k}` };
    }
  }

  const verifyParams = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    verifyParams.append(k, v);
  }
  verifyParams.set("openid.mode", "check_authentication");

  const resp = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });

  const raw = await resp.text();
  const ok = resp.ok && raw.includes("is_valid:true");
  return { ok, raw };
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const STEAM_API_KEY = import.meta.env.DEV
    ? import.meta.env.STEAM_API_KEY
    : env.STEAM_API_KEY;
  console.log(
    "STEAM_API_KEY present:",
    !!STEAM_API_KEY,
    "len:",
    STEAM_API_KEY ? STEAM_API_KEY.length : 0,
  );

  if (!STEAM_API_KEY) {
    console.error("STEAM_API_KEY is missing.");
    return new Response("Server configuration error", { status: 500 });
  }

  const reqUrl = new URL(request.url);
  const params = reqUrl.searchParams;

  if (params.get("openid.mode") !== "id_res") {
    return new Response("Authentication failed", { status: 401 });
  }

  const verified = await verifyOpenId(params);
  if (!verified.ok) {
    console.error("Steam OpenID verify failed:", verified.raw);
    return new Response("Authentication failed", { status: 401 });
  }

  const claimedId = params.get("openid.claimed_id") || "";
  const steamID = extractSteamId(claimedId);

  if (!steamID) {
    console.error("SteamID not found in OpenID response.");
    return new Response("Authentication failed", { status: 401 });
  }

  const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const responseBody = await response.text();
      console.error("Error response from Steam API:", responseBody);
      return new Response("Authentication failed", { status: 401 });
    }

    const data = (await response.json()) as SteamPlayerSummaries;
    const player = data.response?.players?.[0];

    const playerName = player?.personaname || `Player ${steamID}`;
    const playerAvatar = player?.avatarfull || player?.avatar || "";

    const sessionData = { steamID, playerName, playerAvatar };

    cookies.set("session", encodeURIComponent(JSON.stringify(sessionData)), {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: url.origin + "/",
      },
    });
  } catch (error) {
    console.error("Error fetching Steam user data:", error);
    return new Response("Authentication failed", { status: 401 });
  }
};
