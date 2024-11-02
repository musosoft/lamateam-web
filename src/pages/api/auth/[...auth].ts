// src/pages/api/auth/[...auth].ts
import { getSession } from 'auth-astro/server'; // Correct import
import type { APIRoute } from 'astro';

export const all: APIRoute = async ({ request }) => {
  const session = await getSession(request); // Use getSession to handle the request
  // You can return the session data or handle authentication as needed
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
