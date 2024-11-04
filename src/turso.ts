// src/turso.ts
import { createClient } from '@libsql/client/web';

export const turso = createClient({
  url: import.meta.env.TURSO_DATAPUBLIC_SITE_URL ?? process.env.TURSO_DATAPUBLIC_SITE_URL,
  authToken: import.meta.env.TURSO_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
});
