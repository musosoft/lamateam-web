import type { APIRoute } from "astro";

/** Old standalone checkout is not a second public payment surface. */
export const prerender = false;
export const ALL: APIRoute = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
