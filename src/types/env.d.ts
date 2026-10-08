declare namespace Cloudflare {
  interface Env {
    // Runtime-only Worker secret, never a public/build-time variable.
    DEEPL_API_KEY: string;
    TRANSLATION_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    STEAM_API_KEY?: string;
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
  }
}
