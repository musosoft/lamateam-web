// src/pages/api/shoutbox.ts
import type { APIRoute } from "astro";
import { parse } from "cookie";
import { createClient } from "@libsql/client/web";

export const GET: APIRoute = async ({ locals }) => {
  try {
    const { env } = locals.runtime;
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = import.meta.env.DEV
      ? import.meta.env
      : env;

    if (!TURSO_DATABASE_URL) {
      throw new Error("TURSO_DATABASE_URL is not set");
    }

    const turso = createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
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

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { env } = locals.runtime;
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = import.meta.env.DEV
      ? import.meta.env
      : env;

    if (!TURSO_DATABASE_URL) {
      throw new Error("TURSO_DATABASE_URL is not set");
    }

    const turso = createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
    });

    const body = await request.json();
    const { steamid, player_name, message, player_avatar } = body;

    // Validate input
    if (!steamid || !player_name || !message || !player_avatar) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Retrieve cookies from the request headers
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = parse(cookieHeader);
    const sessionCookie = cookies["session"];
    const session = sessionCookie
      ? JSON.parse(decodeURIComponent(sessionCookie))
      : {};

    // Get the user agent to check if the request is from the game client
    const userAgent = request.headers.get("user-agent") || "";
    const isGame = userAgent.includes("Valve Client");

    console.log("User Agent in API request:", userAgent);
    console.log("isGame in API request:", isGame);

    // Verify authentication
    if (session?.steamID !== steamid && !isGame) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Proceed to save the message in the database
    const timestamp = new Date().toISOString();
    await turso.execute({
      sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar) VALUES (?, ?, ?, ?, ?)`,
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
