// src/pages/api/shoutbox.ts
import type { APIRoute } from "astro";
import { parse } from "cookie";
import { createClient } from "@libsql/client/web";
import { env } from "cloudflare:workers";

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

    const body = await request.json();
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

    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = parse(cookieHeader);
    const sessionCookie = cookies["session"];
    const session = sessionCookie
      ? JSON.parse(decodeURIComponent(sessionCookie))
      : {};

    const rawUserAgent = request.headers.get("user-agent") || "";
    const userAgent = rawUserAgent.toLowerCase();
    const isGame = userAgent.includes("valve") || userAgent.includes("steam");

    if (!isGame && session?.steamID !== steamid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const timestamp = new Date().toISOString();
    await turso.execute({
      sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar)
            VALUES (?, ?, ?, ?, ?)`,
      args: [steamid, player_name, message, timestamp, player_avatar],
    });

    return new Response(
      JSON.stringify({
        steamid,
        player_name,
        message,
        player_avatar,
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
