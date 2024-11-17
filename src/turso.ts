// src/turso.ts
import { createClient } from '@libsql/client/web';

export function getTursoClient(env: Record<string, any>) {
  const TURSO_DATABASE_URL = env.TURSO_DATABASE_URL || '';
  const TURSO_AUTH_TOKEN = env.TURSO_AUTH_TOKEN || '';

  if (!TURSO_DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL is not set');
  }

  return createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
}
