// src/turso.ts
import { createClient } from '@libsql/client/web';

const TURSO_DATABASE_URL = import.meta.env.TURSO_DATABASE_URL || '';
const TURSO_AUTH_TOKEN = import.meta.env.TURSO_AUTH_TOKEN || '';

if (!TURSO_DATABASE_URL) {
  throw new Error('TURSO_DATABASE_URL is not set');
}

export const turso = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});
