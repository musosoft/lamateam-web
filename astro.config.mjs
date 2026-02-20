// astro.config.mjs
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
  output: "server",
  adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
    mode: "directory",
    imageService: "cloudflare",
  }),
  integrations: [icon()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        debug: fileURLToPath(new URL("./src/shims/debug.mjs", import.meta.url)),
        "node-fetch": fileURLToPath(new URL("./src/shims/node-fetch.mjs", import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ["debug", "node-fetch"],
    },
    ssr: {
      noExternal: true,
    },
  },
  prefetch: true,
  redirects: {
    "/faq": "/",
    "/tv": "/sourcetv",
    "/info": "/commands",
    "/stats": "https://stats.lamateam.eu/",
  },
});
