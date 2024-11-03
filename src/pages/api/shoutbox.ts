// src/pages/api/shoutbox.ts
import { turso } from '../../turso';

export const GET = async () => {
  try {
    const { rows } = await turso.execute(
      'SELECT player_name, message, timestamp, player_avatar FROM Shoutbox ORDER BY timestamp DESC'
    );
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch messages' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = async ({ request }: { request: Request }) => {
  try {
    const { player_name, message, player_avatar } = await request.json();

    if (!player_name || !message || !player_avatar) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const timestamp = new Date().toISOString();

    await turso.execute({
      sql: `INSERT INTO Shoutbox (player_name, message, timestamp, player_avatar) VALUES (?, ?, ?, ?)`,
      args: [player_name, message, timestamp, player_avatar],
    });

    return new Response(JSON.stringify({ player_name, message, player_avatar, timestamp }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving message:', error);
    return new Response(JSON.stringify({ error: 'Failed to save message' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
