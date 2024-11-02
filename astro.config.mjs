// astro.config.mjs
// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import auth from 'auth-astro';

// Set `site` value directly from environment, or use a fallback
const siteUrl = process.env.PUBLIC_SITE_URL || 'https://lama-web.pages.dev';

export default defineConfig({
  site: siteUrl, // Use fallback or predefined value

  vite: {
    define: {
      'process.env': process.env, // Allows process.env usage in Vite
    },
  },

  integrations: [
    tailwind({
      nesting: true,
      applyBaseStyles: true, // Uses Tailwind’s base styles for consistency
    }),
    auth(),
  ],
  output: 'server',
  adapter: cloudflare(),
});
