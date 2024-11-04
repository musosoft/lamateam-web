// src/pages/api/shoutbox.ts
import { turso } from '../../turso';

console.log('API Route Environment Variables:', {
  TURSO_DATABASE_URL: import.meta.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: import.meta.env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
});

export const GET = async () => {
  try {
    const { rows } = await turso.execute(
      'SELECT steamid, player_name, message, timestamp, player_avatar FROM Shoutbox ORDER BY timestamp DESC'
    );
    console.log('Fetched messages:', rows);

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const err = error as Error;
    console.error('Error fetching messages:', {
      error: err.message,
      stack: err.stack,
    });
    return new Response(JSON.stringify({ error: 'Failed to fetch messages', details: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = async ({ request }: { request: Request }) => {
  try {
    const body = await request.json();
    console.log('Received payload:', body);

    const { steamid, player_name, message, player_avatar } = body;

    if (!steamid || !player_name || !message || !player_avatar) {
      console.error('Validation Error: Missing required fields', { steamid, player_name, message, player_avatar });
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const timestamp = new Date().toISOString();
    console.log('Inserting into database:', { steamid, player_name, message, timestamp, player_avatar });

    await turso.execute({
      sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar) VALUES (?, ?, ?, ?, ?)`,
      args: [steamid, player_name, message, timestamp, player_avatar],
    });

    return new Response(JSON.stringify({ steamid, player_name, message, player_avatar, timestamp }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const err = error as Error;
    console.error('Error saving message:', {
      error: err.message,
      stack: err.stack,
    });
    return new Response(JSON.stringify({ error: 'Failed to save message', details: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
