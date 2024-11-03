// src/pages/api/auth/steam/callback.ts
import type { APIRoute } from 'astro';

const STEAM_API_KEY = import.meta.env.STEAM_CLIENT_ID ?? process.env.STEAM_CLIENT_ID;

export const GET: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  const claimedId = params.get('openid.claimed_id');
  const steamID = claimedId?.split('/').pop();

  if (!steamID) {
    console.error('SteamID not found in OpenID response.');
    return new Response('Authentication failed', { status: 401 });
  }

  if (!STEAM_API_KEY) {
    console.error('Steam API key is missing.');
    return new Response('Server configuration error', { status: 500 });
  }

  // Log API key and URL
  console.log('Using Steam API Key:', STEAM_API_KEY);
  const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`;
  console.log('Fetching from Steam API URL:', apiUrl);

  // Fetch player data from Steam API
  try {
    const response = await fetch(apiUrl);
    const responseBody = await response.text();

    // Log response body for debugging
    console.log('Steam API response body:', responseBody);

    if (!response.ok) {
      console.error('Error response from Steam API:', responseBody);
      return new Response('Authentication failed', { status: 401 });
    }

    const data = JSON.parse(responseBody);
    const player = data.response.players[0];
    const playerName = player?.personaname || `Player ${steamID}`;
    const playerAvatar = player?.avatar || '';

    const sessionData = { steamID, playerName, playerAvatar };
    cookies.set('session', encodeURIComponent(JSON.stringify(sessionData)), {
      path: '/',
      httpOnly: true,
      secure: true,
      maxAge: 60 * 60 * 24, // 1 day
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
      },
    });
  } catch (error) {
    console.error('Error fetching Steam user data:', error);
    return new Response('Authentication failed', { status: 401 });
  }
};
