declare namespace Cloudflare {
  interface Env {
    // Runtime-only Worker secret, never a public/build-time variable.
    DEEPL_API_KEY: string;
    CHECK_ROSTER_INGEST_SECRET?: string;
    CHECK_SOURCE_INGEST_TOKEN?: string;
    CHECK_AUTH_SECRET?: string;
    CHECK_ADMIN_STEAM64_ALLOWLIST?: string;
    MIZAN_API_KEY?: string;
    CHECK_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    TRANSLATION_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    STEAM_API_KEY?: string;
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
  }
}
