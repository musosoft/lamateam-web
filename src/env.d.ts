/// <reference path="../.astro/types.d.ts" />

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