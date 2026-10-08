import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("navigation fits natural link widths and moves languages into the phone menu", () => {
  const source = read("./CommunityNav.astro");
  assert.equal((source.match(/links\.map\(/g) ?? []).length, 1);
  assert.ok(!source.includes('class="nav-inline"'));
  const body = source.match(
    /const fitNavigation = \(\) => \{([\s\S]*?)\n    \};/,
  )[1];
  const items = [80, 80, 80].map((width) => ({
    dataset: {},
    removeAttribute() {},
    getBoundingClientRect: () => ({ width }),
  }));
  let languageParent;
  const languageControls = {};
  const links = {
    clientWidth: 180,
    querySelectorAll: () => items,
    contains: () => false,
    prepend: () => {
      languageParent = "menu";
    },
  };
  const nav = {
    dataset: { open: "true" },
    querySelector: () => ({
      prepend: () => {
        languageParent = "header";
      },
    }),
  };
  const phone = { matches: false };
  const fit = () =>
    vm.runInNewContext(stripTypeScriptTypes(body), {
      nav,
      phone,
      links,
      languageControls,
      toggle: { setAttribute() {} },
      document: { activeElement: null },
    });
  fit();
  assert.deepEqual(
    items.map((item) => item.dataset.overflow),
    ["false", "false", "true"],
  );
  assert.equal(languageParent, "header");
  assert.equal(nav.dataset.open, "true");
  links.clientWidth = 800;
  fit();
  assert.equal(nav.dataset.hasOverflow, "false");
  phone.matches = true;
  fit();
  assert.ok(items.every((item) => item.dataset.overflow === "true"));
  assert.equal(languageParent, "menu");
  assert.equal(nav.dataset.hasOverflow, "true");
  assert.ok(!("measuring" in nav.dataset));
});

test("single responsive navigation keeps languages, focus, and swap cleanup", () => {
  const nav = read("./CommunityNav.astro");
  assert.ok(nav.includes("CS:S SERVER"));
  assert.ok(!nav.includes("COUNTER-STRIKE: SOURCE"));
  assert.equal(nav.split('class="header-language-options"').length - 1, 1);
  for (const text of [
    'aria-expanded="false"',
    'aria-controls="community-links"',
    "resizeObserver.disconnect()",
    "controller.abort()",
    "phone.matches",
    "labelObserver.disconnect()",
    "event.key !== 'Escape'",
    "toggle.focus()",
    "astro:before-swap",
  ])
    assert.ok(nav.includes(text), text);
  const css = read("../assets/tailwind.css");
  assert.ok(css.includes('[data-overflow="true"]'));
  assert.match(css, /\.nav-guides-links\s*\{[^}]*flex-wrap: nowrap/s);
  assert.ok(css.includes("text-overflow: ellipsis"));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("compact footer reserves the launcher zone and MOTD chat stays bounded", () => {
  const css = read("../assets/tailwind.css");
  assert.ok(
    css.includes("padding-right: max(5.5rem, env(safe-area-inset-right))"),
  );
  assert.match(
    css,
    /\.community-footer \.language-control select\s*\{[^}]*border: 0/s,
  );
  const motdPanel = css.slice(
    css.indexOf(".is-game .live-chat-panel {\n  position: relative;"),
  );
  assert.match(motdPanel, /position: relative/);
  assert.match(motdPanel, /max-height: min\(600px, calc\(100dvh - 72px\)\)/);
  const motdMain = css.slice(css.lastIndexOf(".is-game main {")).split("}")[0];
  assert.ok(!motdMain.includes("14rem"));
});

test("contact content combines info/form with equal-height Discord on the right", () => {
  const page = read("../pages/contact.astro");
  const content = page.slice(
    page.indexOf('<section class="contact-content'),
    page.indexOf("</section>", page.indexOf('<section class="contact-content')),
  );
  assert.ok(content.includes('class="contact-info"'));
  assert.ok(content.includes('class="contact-form"'));
  assert.ok(!content.includes('class="contact-discord'));
  assert.ok(page.indexOf("page-heading") < page.indexOf("contact-content"));
  assert.ok(page.includes("align-items: stretch"));
  assert.match(
    page,
    /\.contact-discord \.community-widget\s*\{[^}]*height: 100%/s,
  );
});

test("native tables preserve full-width panels and single-line identity cells", () => {
  const bans = read("./BanTable.astro");
  const stats = read("../pages/stats.astro");
  assert.ok(bans.includes("panel fl-p-3/6 ban-content"));
  assert.ok(stats.includes("panel fl-p-3/6 stats-content"));
  assert.match(bans, /tbody th\s*\{[^}]*white-space: nowrap/s);
  assert.match(bans, /\.ban-steam\s*\{[^}]*display: inline/s);
  assert.match(stats, /\.player-name\s*\{[^}]*white-space: nowrap/s);
  assert.match(stats, /\.country\s*\{[^}]*white-space: nowrap/s);
});

test("SourceTV sorts date keys newest-first without giving it a different main gutter", () => {
  const page = read("../pages/sourcetv.astro");
  assert.ok(page.includes("sortDate: match"));
  assert.ok(page.includes("b.sortDate.localeCompare(a.sortDate)"));
  assert.ok(!page.includes("main:has(.sourcetv-page)"));
  assert.ok(page.includes("t('SourceTV Demos')"));
});

test("desktop type is fluid while MOTD has compact overrides; widgets and footer stay compact", () => {
  assert.ok(read("../layouts/Layout.astro").includes("fl-text-sm/lg"));
  assert.ok(read("./CommunityNav.astro").includes("fl-text-xs/lg"));
  const home = read("../pages/index.astro");
  assert.ok(home.includes("fl-text-2xl/6xl"));
  assert.ok(home.includes("currentPlayersHeight=80"));
  assert.ok(home.includes('height="392"'));
  const css = read("../assets/tailwind.css");
  assert.match(css, /\.is-game\s*\{[^}]*font-size: 0.875rem/s);
  assert.match(css, /\.server-monitor-heading\s*\{[^}]*flex-direction: row/s);
  assert.ok(
    read("./LanguageSelector.astro").includes(
      '<label for="language" class="sr-only">',
    ),
  );
});
