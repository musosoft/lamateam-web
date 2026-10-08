import type { APIRoute } from "astro";
import { loadServerStatus } from "../../lib/server-status";

export const prerender = false;

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await loadServerStatus()), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
