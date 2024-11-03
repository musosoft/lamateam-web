// astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  output: 'server', // Enables server-side rendering
  adapter: cloudflare({ mode: 'directory' }),
  integrations: [tailwind()],
});
