// astro.config.mjs
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwind from "@astrojs/tailwind";

import icon from "astro-icon";

export default defineConfig({
  site: import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
  output: "server", // Enables server-side rendering
  adapter: cloudflare({ mode: "directory" }),
  integrations: [tailwind(), icon()],
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
    "/TV": "/faq#sourcetv",
    "/stats": "https://stats.lamateam.eu/",
  },
});
