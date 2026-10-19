import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { readSteamProfile } from "./lib/steam-profile";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.steamProfile = context.isPrerendered
    ? null
    : await readSteamProfile(
        context.request,
        import.meta.env.DEV ? import.meta.env.STEAM_API_KEY : env.STEAM_API_KEY,
      );
  const response = await next();
  if (
    !context.isPrerendered &&
    response.headers.get("content-type")?.includes("text/html")
  ) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
});
