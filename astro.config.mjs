// astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
  output: 'server', // Enables server-side rendering
  adapter: cloudflare({ mode: 'directory' }),
  integrations: [tailwind()],
});
