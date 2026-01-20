// src/pages/api/auth/steam.ts
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ url }) => {
  const returnTo = `${url.origin}/api/auth/steam/callback`;
  const realm = url.origin;

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://steamcommunity.com/openid/login?${params.toString()}`,
    },
  });
};
