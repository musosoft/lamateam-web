/// <reference path="../.astro/types.d.ts" />

declare namespace App {
    interface Locals {
      runtime: {
        env: {
          STEAM_API_KEY?: string;
        };
      };
    }
  }