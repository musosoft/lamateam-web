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
    "/contact.php": "/contact",
    "/register.php": "/contact",
    "/infusions/forum/viewthread.php?thread_id=1": "/faq",
    "/infusions/forum/index.php": "/faq",
    "/infusions/faq/faq.php": "/faq",
    "/infusions/shoutbox_panel/shoutbox_archive.php": "/shoutbox",
    "/motd/info.html": "/info",
    "/motd/vip.html": "/vip",
    "/motd/pravidla.html": "/rules",
    "/viewpage.php": "/",
    "/motd/index.html": "/",
    "/lostpassword.php": "/",
    "/search.php": "/",
    "/home.php": "/",
    "/tv": "/faq#sourcetv",
    // "/TV": "/faq#sourcetv",
    "/stats": "https://stats.lamateam.eu/",
  },
});
