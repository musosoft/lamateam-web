// src/pages/api/shoutbox.ts
import { turso } from '../../turso';

export const GET = async () => {
  try {
    const { rows } = await turso.execute('SELECT player_name, message, timestamp, player_avatar FROM Shoutbox ORDER BY timestamp DESC');  // Fetch all required fields
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch messages' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = async ({ request }: { request: Request }) => {
  try {
    const { player_name, message, player_avatar } = await request.json();
    const timestamp = new Date().toISOString();

    await turso.execute({
      sql: `INSERT INTO Shoutbox (player_name, message, timestamp, player_avatar) VALUES (?, ?, ?, ?)`,
      args: [player_name, message, timestamp, player_avatar],
    });

    // Return the saved message with a timestamp to append on the client-side
    return new Response(JSON.stringify({ player_name, message, player_avatar, timestamp }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to save message' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
