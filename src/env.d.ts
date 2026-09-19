/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PUBLIC_SITE_URL?: string;
  readonly STEAM_API_KEY?: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: {
        STEAM_API_KEY?: string;
        TURSO_DATABASE_URL?: string;
        TURSO_AUTH_TOKEN?: string;
        PUBLIC_SITE_URL?: string;
      };
    };
  }
}
