// src/pages/api/test.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response('Test route is working!', { status: 200 });
};
