// src/turso.ts
import { createClient } from '@libsql/client/web';

let TURSO_DATABASE_URL = '';
let TURSO_AUTH_TOKEN = '';

// Attempt to get environment variables from import.meta.env (development)
if (typeof import.meta !== 'undefined' && import.meta.env) {
  TURSO_DATABASE_URL = import.meta.env.TURSO_DATABASE_URL || '';
  TURSO_AUTH_TOKEN = import.meta.env.TURSO_AUTH_TOKEN || '';
}

// If not found, attempt to get them from globalThis (Cloudflare Workers environment)
if (!TURSO_DATABASE_URL && typeof globalThis !== 'undefined') {
  TURSO_DATABASE_URL = (globalThis as any).TURSO_DATABASE_URL || '';
  TURSO_AUTH_TOKEN = (globalThis as any).TURSO_AUTH_TOKEN || '';
}

// Throw an error if TURSO_DATABASE_URL is still not set
if (!TURSO_DATABASE_URL) {
  throw new Error('TURSO_DATABASE_URL is not set');
}

export const turso = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});
