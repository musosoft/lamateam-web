// astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: import.meta.env.BASE_URL ?? process.env.BASE_URL,
  output: 'server', // Enables server-side rendering
  adapter: cloudflare({ mode: 'directory' }),
  integrations: [tailwind()],
});
