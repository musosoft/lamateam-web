// astro.config.mjs
// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import auth from 'auth-astro';

// Set `site` value directly from environment, or use a fallback
const siteUrl = process.env.PUBLIC_SITE_URL || 'https://lama-web.pages.dev';

export default defineConfig({
  site: siteUrl,

  integrations: [
    tailwind({
      nesting: true,
      applyBaseStyles: true, // Apply Tailwind’s base styles
    }),
    auth(),
  ],

  output: 'server',
  adapter: cloudflare(), // Use Cloudflare Pages adapter

  vite: {
    define: {
      'process.env': process.env, // Allows process.env usage in Vite
    },
    ssr: {
      noExternal: ['auth-astro'], // Do not externalize auth-astro to avoid bundling issues
    },
  },
});
