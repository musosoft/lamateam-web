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
    '/contact.php': '/contact',
    '/register.php': '/contact',    
    '/infusions/forum/viewthread.php?thread_id=1': '/faq',
    '/infusions/forum/index.php?section=unanswered': '/faq',
    '/infusions/forum/index.php?section=unsolved': '/faq',
    '/infusions/faq/faq.php': '/faq',
    '/infusions/faq/faq.php?cat_id=3': '/faq',
    '/infusions/faq/faq.php?cat_id=5': '/faq',    
    '/infusions/shoutbox_panel/shoutbox_archive.php': '/shoutbox',    
    '/motd/info.html': '/info',    
    '/viewpage.php?page_id=1' : '/vip',
    '/motd/vip.html': '/vip',    
    '/motd/pravidla.html': '/rules',    
    '/viewpage.php': '/',
    '/motd/index.html': '/',
    '/lostpassword.php': '/',
    '/search.php': '/',
    '/home.php': '/',
  },
});
