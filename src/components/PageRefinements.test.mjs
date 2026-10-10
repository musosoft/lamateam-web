import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = (name) => read(`../pages/${name}.astro`);

function sectionContaining(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `Missing section marker: ${marker}`);
  const start = source.lastIndexOf("<section", markerIndex);
  const tags = /<\/?section\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let tag; (tag = tags.exec(source));) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  assert.fail("Unclosed section");
}

test("commands note belongs to the command reference section and retains its guidance", () => {
  const section = sectionContaining(
    page("commands"),
    "aria-label={t('Server command reference')}",
  );
  for (const text of [
    "Note:",
    "Some commands may depend on permissions",
    "(warmup/round)",
    "without a prefix in the console",
    "localizedHref('/hitreg', locale)",
  ])
    assert.ok(section.includes(text), text);
});

test("money legend precedes the tables inside their existing panel; CT alignment survives", () => {
  const source = page("money");
  const legend =
    "👤 = awarded to the player only • 👥 = awarded to the entire team";
  assert.equal(source.split(legend).length - 1, 1);
  assert.ok(source.indexOf("<article") < source.indexOf(legend));
  assert.ok(source.indexOf(legend) < source.indexOf("<table"));
  assert.match(
    source,
    /table :is\(th, td\):first-child\s*\{\s*text-align: right/,
  );
});

test("SourceTV retains status/download affordances with smaller thumbnails and full-width layout", () => {
  const source = page("sourcetv");
  for (const text of [
    "width={64}",
    "height={36}",
    'class="demo-map-link"',
    "t('Download')",
    "No demos available yet.",
    "Demo list temporarily unavailable.",
    "Showing the last available demo list",
    "table-layout: fixed",
    "data-no-translate",
  ])
    assert.ok(source.includes(text), text);
  assert.match(source, /aria-label=\{\s*\n\s*t\('Download'\)\s*\+/);
  assert.match(source, /\.demo-panel\s*\{[^}]*width: 100%/s);
  assert.ok(source.includes('alt=""')); // Adjacent map link supplies the decorative thumbnail's context.
});

test("contact adds local branding and in-game admin help without changing form submission", () => {
  const source = page("contact");
  for (const text of [
    'src="/assets/favicon.svg"',
    "Czech Republic",
    '<code translate="no">@</code>',
    "contact the admins and report an issue",
    "contact-info",
    "contact-discord",
    "contact-form",
    'action="https://formspree.io/f/xovqnqna"',
    'method="POST"',
    'name="email"',
    'name="message"',
  ])
    assert.ok(source.includes(text), text);
  assert.ok(!source.includes("max-width: 72rem"));
  assert.ok(source.includes("@media (min-width: 1200px)"));
});

test("previous shared-chrome/home and page-section requests remain in place", () => {
  const home = page("index");
  const connect = page("connect");
  const css = read("../assets/tailwind.css");
  assert.ok(
    !connect.includes("<iframe") &&
      !connect.includes("optional-panel") &&
      !connect.includes("query.fakaheda.eu"),
  );
  assert.ok(!home.includes("· approx.") && !home.includes("shoutboxMessages"));
  assert.ok(
    home.includes("every five minutes") && home.includes("monitor-server-ip"),
  );
  assert.match(css, /\.join-panel\s*\{[^}]*background: none/s);
  assert.match(css, /\.join-actions\s*\{[^}]*justify-content: flex-end/s);
  assert.ok(
    css.includes("center calc(100% - 1.5rem)") &&
      css.includes("min(78vh, 780px)"),
  );
  assert.equal(
    read("../layouts/Layout.astro").split("<LiveChat />").length - 1,
    1,
  );
  for (const component of ["CommunityNav", "LanguageSelector"])
    assert.ok(
      read(`./${component}.astro`).includes("<LanguageFlag locale={locale} />"),
    );
  assert.ok(!read("./CommunityNav.astro").includes("header-languages"));
  assert.ok(
    read("./MapRatings.astro").includes(
      "randomSkip?.addEventListener('click', chooseRandomMap",
    ),
  );
  const serverRules = read("./ServerRules.astro");
  assert.ok(page("rules").includes("<ServerRules locale={locale} />"));
  assert.ok(serverRules.includes("aria-label={t('Server Rules')}"));
  assert.ok(home.includes('<ServerRules compact locale="en" />'));
  assert.ok(
    page("admins").includes("['Crazy69', 'Ipos', 'muso.sk', 'Zuzule']"),
  );
  assert.ok(page("vip").includes("'.:Urv@NeC:....'"));
  assert.ok(read("../assets/hero.svg").includes(">LaMaTeAm</text>"));
  assert.ok(
    read("../layouts/Layout.astro").includes(
      "© LaMaTeAm: crazy69 • web &amp; server: muso.sk",
    ),
  );
});

test("smaller flags stay inside footer options while header flags keep accessible hit targets", () => {
  const selector = read("./LanguageSelector.astro");
  const select = selector.match(/<select\b[\s\S]*?<\/select>/)?.[0];
  assert.ok(select);
  const option = select.match(/<option\b[\s\S]*?<\/option>/)?.[0];
  assert.ok(option.includes("<LanguageFlag locale={locale} />"));
  assert.ok(option.includes("language-native-flag"));
  assert.ok(option.includes("aria-label={names[locale]}"));
  assert.ok(option.includes("value={locale.toUpperCase()}"));
  assert.ok(
    option.includes(
      "data-path={pageKind ? localePath(locale, pageKind) : undefined}",
    ),
  );
  assert.ok(select.includes("<selectedcontent>"));
  assert.equal((selector.match(/id="language"/g) ?? []).length, 1);
  assert.ok(!selector.includes("footer-language-options"));
  const css = read("../assets/tailwind.css");
  assert.match(
    css,
    /\.header-language-options svg\s*\{[^}]*width: 18px;[^}]*height: 12px;/s,
  );
  assert.match(
    css,
    /\.header-language-options a\s*\{[^}]*min-height: 44px;[^}]*min-width: 44px;/s,
  );
  assert.ok(css.includes("@supports (appearance: base-select)"));
});

test("home uses a unified hero and sidebar rating widget with locally owned GameTracker color", () => {
  const home = page("index");
  const css = read("../assets/tailwind.css");
  assert.match(
    css,
    /\.join-panel\s*\{[^}]*width: 100%;[^}]*max-width: none;[^}]*border: 0;/s,
  );
  assert.ok(home.includes("'home-hero'"));
  assert.ok(home.includes("{ 'fl-p-4/12 fl-gap-4/10 fl-mb-5/12': !isGame }"));
  assert.ok(
    home.indexOf(
      "<MapRatings compact locale={locale} />",
      home.indexOf("<aside"),
    ) > home.indexOf("<aside"),
  );
  assert.ok(!home.includes('aria-labelledby="join-overview"'));
  assert.match(css, /main\s*\{[^}]*max-width: 1760px/s);
  const url = new URL(
    home.match(
      /src="(https:\/\/cache\.gametracker\.com\/components\/html0\/\?[^"\n]+)"/,
    )[1],
  );
  const surface = css.match(/--surface: #([\da-f]{6});/)[1];
  for (const key of ["bgColor", "titleBgColor", "borderColor"])
    assert.equal(url.searchParams.get(key), "131f32");
  assert.equal(url.searchParams.get("bgColor"), surface);
  for (const selector of [
    ".server-monitor",
    ".gametracker-frame",
    ".gametracker-frame .gametracker-widget",
    ".server-monitor-actions",
  ]) {
    const rule = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    assert.ok(rule.includes("background: #131f32"), selector);
  }
  assert.match(css, /\.server-monitor-heading\s*\{[^}]*background: #ffb41e/s);
  assert.ok(![...url.searchParams.values()].includes("adbed5"));
});

test("latest header and hero refinements retain identity and accessible controls", () => {
  const home = page("index");
  const css = read("../assets/tailwind.css");
  assert.ok(home.includes("{communityIntro}"));
  assert.ok(home.includes(".split('. ')[0] + '.'"));
  assert.ok(home.includes("Welcome to LaMaTeAm."));
  assert.ok(home.includes("{displayName}"));
  assert.ok(home.includes("src={avatar}"));
  assert.match(
    css,
    /\.nav-guides-links\s*\{[^}]*flex-wrap: nowrap;[^}]*justify-content: center;/s,
  );
  assert.match(
    css,
    /\.server-monitor-heading\s*\{[^}]*height: 74px;[^}]*box-sizing: border-box;/s,
  );
  assert.match(css, /\.server-monitor-status\s*\{[^}]*font-size: 14px;/s);
  assert.match(
    css,
    /@media \(max-width: 700px\)\s*\{\s*\.server-monitor-heading\s*\{[^}]*height: auto;/s,
  );
  assert.ok(read("./CommunityNav.astro").includes("aria-current="));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(
    read("./MapRatings.astro").includes("prefers-reduced-motion: reduce"),
  );
});
