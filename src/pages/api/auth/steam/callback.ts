// src/pages/api/auth/steam/callback.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = async (context) => {
  const { request, cookies } = context;
  const url = new URL(request.url);
  const params = url.searchParams;

  const claimedId = params.get('openid.claimed_id');
  const steamID = claimedId?.split('/').pop();

  if (!steamID) {
    console.error('SteamID not found in OpenID response.');
    return new Response('Authentication failed', { status: 401 });
  }

  // Access the Steam API key from both environments
  const STEAM_API_KEY =
    import.meta.env.STEAM_API_KEY || process.env.STEAM_API_KEY;

  if (!STEAM_API_KEY) {
    console.error('Steam API key is missing.');
    return new Response('Server configuration error', { status: 500 });
  }

  console.log('Using Steam API Key:', STEAM_API_KEY);

  const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`;
  console.log('Fetching from Steam API URL:', apiUrl);

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response from Steam API:', errorText);
      return new Response('Authentication failed', { status: 401 });
    }

    const data = await response.json();
    const player = data.response.players[0];
    const playerName = player?.personaname || `Player ${steamID}`;
    const playerAvatar = player?.avatarfull || '/assets/default-avatar.webp';

    const sessionData = { steamID, playerName, playerAvatar };
    cookies.set('session', encodeURIComponent(JSON.stringify(sessionData)), {
      path: '/',
      httpOnly: true,
      secure: true,
      maxAge: 60 * 60 * 24, // 1 day
    });

    return new Response(null, {
      status: 302,
      headers: { Location: '/' },
    });
  } catch (error) {
    console.error('Error fetching Steam user data:', error);
    return new Response('Authentication failed', { status: 401 });
  }
};
