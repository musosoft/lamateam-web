// src/pages/api/shoutbox.ts
import { turso } from '../../turso';

export const GET = async () => {
  try {
    const { rows } = await turso.execute(
      'SELECT steamid, player_name, message, timestamp, player_avatar FROM Shoutbox ORDER BY timestamp DESC'
    );

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching messages:', {
      error: error.message,
      stack: error.stack,
    });
    return new Response(JSON.stringify({ error: 'Failed to fetch messages', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = async ({ request }: { request: Request }) => {
  try {
    const { steamid, player_name, message, player_avatar } = await request.json();

    if (!steamid || !player_name || !message || !player_avatar) {
      console.error('Validation Error: Missing required fields', { steamid, player_name, message, player_avatar });
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const timestamp = new Date().toISOString();

    await turso.execute({
      sql: `INSERT INTO Shoutbox (steamid, player_name, message, timestamp, player_avatar) VALUES (?, ?, ?, ?, ?)`,
      args: [steamid, player_name, message, timestamp, player_avatar],
    });

    return new Response(JSON.stringify({ steamid, player_name, message, player_avatar, timestamp }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving message:', {
      error: error.message,
      stack: error.stack,
    });
    return new Response(JSON.stringify({ error: 'Failed to save message', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

