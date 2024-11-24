// src/pages/api/steamUser.ts
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
  const { STEAM_API_KEY } = import.meta.env.DEV ? import.meta.env : env;
  const url = new URL(request.url);
  const steamid = url.searchParams.get("steamid");

  if (!steamid || !STEAM_API_KEY) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
    });
  }

  const steamApiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamid}`;

  try {
    const response = await fetch(steamApiUrl);
    if (!response.ok) throw new Error(`Steam API error: ${response.status}`);

    const data = await response.json();
    const player = data.response.players[0];
    return new Response(JSON.stringify({ avatar: player?.avatarfull }), {
      status: 200,
    });
  } catch (error) {
    console.error("Error fetching Steam user data:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch Steam user data" }),
      { status: 500 },
    );
  }
};
