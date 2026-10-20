// src/pages/api/shoutbox.ts
import type { APIRoute } from "astro";
import { createClient } from "@libsql/client/web";
import { env } from "cloudflare:workers";
import { getSedliakReply } from "../../lib/sedliak";
import { readSteamProfile } from "../../lib/steam-profile";
import { resolveChatProfile } from "../../lib/chat-profile";

const SEDLIAK_ID = "sedliak-bot";
const SEDLIAK_NAME = "Sedliak";
const SEDLIAK_AVATAR = "/assets/sedliak-avatar.svg";
const SEDLIAK_REPLY_CHANCE = 0.25;
const SEDLIAK_COOLDOWN_MS = 30 * 60 * 1000;
const SEDLIAK_DAILY_LIMIT = 4;

function getTursoConfig(): { url: string; authToken?: string } {
  const devUrl = import.meta.env.TURSO_DATABASE_URL;
  const devToken = import.meta.env.TURSO_AUTH_TOKEN;

  const url = import.meta.env.DEV ? devUrl : env.TURSO_DATABASE_URL;
  const authToken = import.meta.env.DEV ? devToken : env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  return { url, authToken };
}

export const GET: APIRoute = async () => {
  try {
    const { url, authToken } = getTursoConfig();

    const turso = createClient({
      url,
      authToken,
    });

    const { rows } = await turso.execute(
      "SELECT steamid, player_name, message, timestamp, player_avatar FROM Shoutbox ORDER BY timestamp DESC LIMIT 50",
    );

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Failed to fetch messages",
        details: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { url, authToken } = getTursoConfig();

    const turso = createClient({
      url,
      authToken,
    });

    const body = (await request.json()) as {
      steamid?: string;
      player_name?: string;
      message?: string;
      player_avatar?: string;
      locale?: string;
    };

    const { steamid, player_name, message, player_avatar } = body;

    if (!steamid || !player_name || !message || !player_avatar) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (steamid === SEDLIAK_ID) {
      return new Response(JSON.stringify({ error: "Reserved chat identity" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const identity = resolveChatProfile(
      request,
      await readSteamProfile(
        request,
        import.meta.env.DEV ? import.meta.env.STEAM_API_KEY : env.STEAM_API_KEY,
      ),
    );
    if (!identity || identity.profile.steamID !== steamid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Resolve display metadata by the same rules as the rendered composer;
    // request-body metadata must not select a different displayed identity.
    const { playerName, playerAvatar } = identity.profile;

    const timestamp = new Date().toISOString();
    await turso.execute({
      sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar)
            VALUES (?, ?, ?, ?, ?)`,
      args: [steamid, playerName, message, timestamp, playerAvatar],
    });

    const reply = getSedliakReply(message, body.locale || "en");
    if (reply && Math.random() < SEDLIAK_REPLY_CHANCE) {
      try {
        const now = Date.now();
        const cooldownAfter = new Date(now - SEDLIAK_COOLDOWN_MS).toISOString();
        const today = new Date(now);
        today.setUTCHours(0, 0, 0, 0);
        await turso.execute({
          sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar)
              SELECT ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM Shoutbox WHERE steamid = ? AND timestamp > ?
              )
              AND (
                SELECT COUNT(*) FROM Shoutbox
                WHERE steamid = ? AND timestamp >= ?
              ) < ?`,
          args: [
            SEDLIAK_ID,
            SEDLIAK_NAME,
            reply,
            new Date(now).toISOString(),
            SEDLIAK_AVATAR,
            SEDLIAK_ID,
            cooldownAfter,
            SEDLIAK_ID,
            today.toISOString(),
            SEDLIAK_DAILY_LIMIT,
          ],
        });
      } catch (error) {
        console.error("Error saving Sedliak reply:", error);
      }
    }

    return new Response(
      JSON.stringify({
        steamid,
        player_name: playerName,
        message,
        player_avatar: playerAvatar,
        timestamp,
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error saving message:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Failed to save message",
        details: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
