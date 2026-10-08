import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("../layouts/Layout.astro");
const home = read("./index.astro");
const chat = read("../components/LiveChat.astro");
const rulesPage = read("./rules.astro");
const rulesContent = read("../components/ServerRules.astro");
const css = read("../assets/tailwind.css");
const overrides = css.slice(css.indexOf("/* Only the MOTD home"));
const rule = (selector) => {
  const start = overrides.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing ${selector}`);
  return overrides.slice(start, overrides.indexOf("}", start) + 1);
};

test("full-height panes share game route geometry, not the website", () => {
  assert.match(layout, /'motd-home': isGame && pageKind === 'home'/);
  const body = rule("body.is-game.motd-home");
  assert.match(body, /height: 100vh;\s+height: 100dvh;/);
  assert.match(body, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(body, /align-items: stretch/);
  assert.match(rule(".is-game.motd-home .community-nav"), /height: auto/);
  assert.match(rule(".is-game.motd-home .nav-inner"), /height: auto/);
  // No guessed header subtraction or fixed chat cap in the home overrides.
  assert.doesNotMatch(
    overrides.split("/* Keep the complete picker")[0],
    /calc\(100|height: min\(/,
  );
});

test("game routes share home gutters, title scale, full-height chat and transition identity", () => {
  for (const selector of [
    "body.is-game.motd-home",
    ".is-game.motd-home .community-nav",
    ".is-game.motd-home .nav-inner",
    ".is-game.motd-home main",
    ".is-game.motd-home #live-chat-shell",
    ".is-game.motd-home .live-chat-panel",
  ]) {
    assert.ok(
      overrides.includes(
        `${selector.replace(".motd-home", "")},\n${selector} {`,
      ),
    );
  }
  assert.match(
    rule(".is-game.motd-home main"),
    /padding: var\(--motd-space\) !important/,
  );
  assert.match(rule(".is-game main > section"), /padding-block: 0/);
  assert.match(
    rule(".is-game .page-heading"),
    /margin: 0 0 var\(--motd-space\)/,
  );
  assert.match(
    rule(".is-game .page-heading h1"),
    /font-size: calc\(var\(--motd-text\) \* 1\.45\)/,
  );
  assert.match(
    layout,
    /transition:name=\{isGame \? 'motd-content' : undefined\}/,
  );
});

test("game map cards fit two readable columns in a 300px content pane", () => {
  const maps = read("../components/MapRatings.astro");
  assert.match(
    maps,
    /:global\(\.is-game\) \.rated-map-grid \{\s+grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 140px\), 1fr\)\)/,
  );
  assert.match(maps, /@container map-card \(max-width: 240px\)/);
  assert.match(
    maps,
    /:global\(\.is-game\) \.rated-map-card \{\s+container: map-card \/ inline-size/,
  );
  // Website cards retain their existing minimum width and intrinsic sizing.
  assert.match(
    maps,
    /\.rated-map-grid \{\s+display: grid;\s+grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 260px\), 1fr\)\)/,
  );
  assert.match(maps, /:global\(\.is-game\) \.rating-star \{\s+min-width: 24px/);
  assert.match(maps, /overflow-wrap: anywhere/);
});

test("game instruction is a short placeholder without a redundant or misleading help row", () => {
  assert.match(chat, /en: 'Click Send to chat'/);
  assert.match(chat, /data-game-placeholder=\{gamePlaceholder\}/);
  assert.match(
    chat,
    /if \(inGame\) input.placeholder = input.dataset.gamePlaceholder!/,
  );
  assert.doesNotMatch(chat, /chat-keyboard-notice|Enter\/Space cannot send/);
  assert.match(chat, /t\('Say hello to the team…'\)/);
  assert.match(chat, /nextInput.dataset.gamePlaceholder!/);
});

test("welcome, player stats and rating stay in the left main; chat is its sibling", () => {
  const main = home.slice(home.indexOf("<Layout"), home.indexOf("<style>"));
  assert.match(main, /Welcome to LaMaTeAm\./);
  assert.match(main, /data-hero-stats/);
  assert.match(main, /<MapRatings compact locale=\{locale\}/);
  assert.doesNotMatch(main, /<LiveChat/);
  assert.ok(layout.indexOf("<LiveChat />") > layout.indexOf("</main>"));
  assert.match(rule(".is-game.motd-home main"), /min-height: 0/);
  assert.match(rule(".is-game.motd-home main"), /overflow-y: auto/);
  assert.match(
    rule(".is-game.motd-home .live-chat-panel"),
    /height: 100%;\s+max-height: none/,
  );
  assert.match(rule(".is-game.motd-home #live-chat-shell"), /min-height: 0/);
});

test("narrow MOTDs keep chat on the right without crushing rating or composer", () => {
  assert.match(
    rule("body.is-game.motd-home"),
    /grid-template-columns: minmax\(0, 1fr\) minmax\(\s*0,\s*min\(48vw, clamp\(240px, 36vw, 360px\)\)\s*\)/,
  );
  assert.match(overrides, /main \{\s+grid-column: 1;\s+grid-row: 2/);
  assert.match(
    overrides,
    /#live-chat-shell \{\s+grid-column: 2;\s+grid-row: 2/,
  );
  assert.match(overrides, /@container motd-content \(max-width: 280px\)/);
  assert.match(
    overrides,
    /\.map-rating-form \{\s+grid-column: 1;\s+grid-row: 2/,
  );
  assert.match(
    css,
    /\.live-chat-panel \.shoutbox-feed \{[^}]*overflow-y: auto/s,
  );
  assert.match(css, /\.chat-compose \{[^}]*flex-shrink: 0/s);
  assert.match(chat, /let saved = inGame \|\| shell.dataset.defaultOpen/);
  assert.match(chat, /setOpen\(saved \|\| linkedToChat/);
});

test("MOTD reuses the complete canonical server rules without changing web content", () => {
  assert.match(
    home,
    /import ServerRules from '\.\.\/components\/ServerRules\.astro'/,
  );
  assert.match(home, /isGame && <ServerRules compact locale="en"/);
  assert.match(rulesPage, /<ServerRules locale=\{locale\} \/>/);
  assert.match(rulesContent, /const Heading = compact \? 'h2' : 'h1'/);
  assert.equal(
    (rulesContent.match(/<tr class="hover:bg-gray-600">/g) ?? []).length,
    16,
  );
  assert.match(rulesContent, /Prohibited/);
  assert.match(rulesContent, /Penalty/);
  assert.match(rulesContent, /NOT KNOWING THE RULES IS NO EXCUSE!/);
  assert.match(rulesContent, /Rules reminder/);
  // DOM order, not CSS reordering, places info directly before the rules.
  const top = home.indexOf("home-top-row");
  const welcome = home.indexOf("<header", top);
  const rating = home.indexOf('class="motd-map-rating"', welcome);
  const info = home.indexOf('class="motd-info"', rating);
  const rules = home.indexOf("isGame && <ServerRules", info);
  assert.ok(top < welcome && welcome < rating && rating < info);
  assert.ok(info < rules);
  assert.match(rule(".is-game.motd-home .community-main"), /display: grid/);
  assert.doesNotMatch(overrides, /order: [23]/);
});

test("MOTD map preview is a bounded horizontal thumbnail beside prompt and controls", () => {
  assert.match(
    rule(".is-game.motd-home .random-map-widget"),
    /grid-template-columns: 8\.75em minmax\(0, 1fr\)/,
  );
  const thumbnail = rule(
    ".is-game.motd-home .random-map-widget .map-thumbnail",
  );
  assert.match(thumbnail, /grid-column: 1/);
  assert.match(thumbnail, /grid-row: 1 \/ 3/);
  assert.match(thumbnail, /width: 100%/);
  assert.match(thumbnail, /aspect-ratio: 4 \/ 3/);
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-thumbnail img"),
    /max-height: 120px/,
  );
  assert.match(rule(".is-game.motd-home .random-map-prompt"), /grid-column: 2/);
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-card-content"),
    /grid-column: 2/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-rating-form"),
    /max-content auto !important/,
  );
  assert.match(rule(".is-game.motd-home main"), /height: 100%/);
  assert.match(rule(".is-game.motd-home #live-chat-shell"), /height: 100%/);
  assert.match(rule(".is-game.motd-home .live-chat-panel"), /min-height: 0/);
});

test("MOTD welcome and rating use natural top-aligned sizing without full-width controls", () => {
  const row = rule(".is-game.motd-home .motd-top-row");
  assert.match(row, /display: flex/);
  assert.match(row, /flex-wrap: wrap/);
  assert.match(row, /align-items: flex-start/);
  assert.match(row, /justify-content: flex-start/);
  for (const selector of [".motd-welcome", ".motd-map-rating"]) {
    assert.match(rule(`.is-game.motd-home ${selector}`), /flex: 0 1 auto/);
  }
  assert.match(rule(".is-game.motd-home .motd-welcome"), /width: fit-content/);
  assert.match(
    rule(".is-game.motd-home .motd-map-rating"),
    /width: max-content/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget"),
    /width: fit-content/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-rating-form"),
    /justify-content: end/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget .rating-star"),
    /flex: 0 0 auto/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget #random-map-skip"),
    /justify-self: end/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget #random-map-skip"),
    /align-self: start/,
  );
  assert.match(home, /\.home-top-row \{\s+display: contents/);
});

test("MOTD rating content aligns right and controls stay in compact top tracks", () => {
  const widget = rule(".is-game.motd-home .random-map-widget");
  assert.match(widget, /grid-template-rows: min-content min-content/);
  assert.match(widget, /gap: 0 0\.5rem/);
  for (const selector of [
    ".random-map-prompt",
    ".random-map-widget .map-card-content",
  ])
    assert.match(rule(`.is-game.motd-home ${selector}`), /text-align: right/);
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-card-content"),
    /gap: 0/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-name"),
    /justify-content: flex-end/,
  );
});

test("MOTD guides use established copy without display-identity stats or an empty panel", () => {
  const info = home.slice(
    home.indexOf('class="motd-info"'),
    home.indexOf("isGame && <ServerRules"),
  );
  assert.match(info, /data-no-translate>\{communityIntro\}/);
  assert.match(info, /\['Statistics', 'Maps', 'Commands'\]/);
  assert.doesNotMatch(info, /SourceTV/);
  assert.match(home, /title: 'SourceTV'/);
  assert.match(home, /!isGame && \([\s\S]*class="desktop-community/);
  assert.match(info, /\{page.description\}/);
  assert.doesNotMatch(info, /data-hero-stats|motd-info panel/);
  assert.match(home, /https:\/\/stats\.lamateam\.eu\//);
  assert.match(rule(".is-game.motd-home .motd-info"), /padding: 0/);
  for (const selector of [
    ".motd-info",
    ".motd-rules h2",
    ".motd-rules table",
    ".motd-rules p",
  ]) {
    assert.match(
      rule(`.is-game.motd-home ${selector}`),
      /font-size: (calc\(var\(--motd-text\)|inherit)/,
    );
  }
  assert.match(
    rule(".is-game.motd-home .motd-rules table"),
    /line-height: 1.5/,
  );
});

test("700×400 MOTD shares a legible scale across panes and collapses the closed chat track", () => {
  const body = rule("body.is-game.motd-home");
  assert.match(
    body,
    /--motd-text: clamp\(0\.875rem, min\(2vw, 3\.5dvh\), 1rem\)/,
  );
  assert.match(body, /font-size: var\(--motd-text\)/);
  assert.doesNotMatch(overrides, /minmax\(240px/);
  assert.match(
    rule("body.is-game:has(#live-chat-panel[hidden])"),
    /grid-template-columns: minmax\(0, 1fr\)/,
  );
  const closed = rule(
    ".is-game:has(#live-chat-panel[hidden]) #live-chat-shell",
  );
  assert.match(closed, /position: fixed/);
  assert.match(closed, /width: 0/);
  assert.match(chat, /panel.hidden = !open/);
  assert.match(chat, /localStorage.setItem\(preference, String\(open\)\)/);
  assert.match(home, /\.hero-stats,[\s\S]*font-size: var\(--motd-text\)/);
  assert.match(
    overrides,
    /\.chat-compose input,[\s\S]*font-size: var\(--motd-text\)/,
  );
});

test("every MOTD route releases the sidebar track while web layout stays untouched", () => {
  assert.match(css, /\.is-game main \{[^}]*max-width: none/s);
  const collapsed = rule("body.is-game:has(#live-chat-panel[hidden])");
  assert.doesNotMatch(collapsed, /motd-home/);
  assert.match(collapsed, /grid-template-columns: minmax\(0, 1fr\)/);
  const shell = rule(".is-game:has(#live-chat-panel[hidden]) #live-chat-shell");
  assert.match(shell, /position: fixed/);
  assert.match(shell, /width: 0/);
  assert.match(shell, /height: 0/);
  assert.match(shell, /padding: 0/);
});

test("chat controls remain centered circles with one shared dimension at every size", () => {
  const controls = css.slice(css.indexOf(".chat-close,\n.chat-launcher {"));
  const geometry = controls.slice(0, controls.indexOf("}") + 1);
  for (const property of [
    "width: var(--chat-control-size)",
    "height: var(--chat-control-size)",
    "aspect-ratio: 1",
    "border-radius: 50%",
    "padding: 0",
    "flex-shrink: 0",
    "align-items: center",
    "justify-content: center",
  ])
    assert.ok(geometry.includes(property), property);
  assert.match(css, /--chat-control-size: clamp\(44px, 2\.1vw, 84px\)/);
  assert.match(
    rule(".is-game.motd-home .chat-close"),
    /--chat-control-size: 44px/,
  );
});

test("scoped welcome overrides its empty stats track and heading width cap", () => {
  assert.match(
    home,
    /:global\(\.is-game\.motd-home\) \.motd-welcome \.hero-summary \{\s+display: block/,
  );
  assert.match(
    home,
    /:global\(\.is-game\.motd-home\) \.motd-welcome h1 \{\s+max-width: none/,
  );
  assert.match(home, /\{ 'fl-p-4\/12 fl-gap-4\/10 fl-mb-5\/12': !isGame \}/);
  assert.match(overrides, /\.rating-feedback:empty/);
});

test("MOTD top sections are borderless while rating grid alignment is preserved", () => {
  for (const selector of [".motd-welcome", ".random-map-widget"]) {
    const section = rule(`.is-game.motd-home ${selector}`);
    for (const property of [
      "padding: 0",
      "border: 0",
      "background: none",
      "box-shadow: none",
    ]) {
      assert.ok(section.includes(property), `${selector}: ${property}`);
    }
  }
  assert.match(
    home,
    /:global\(\.is-game\.motd-home\) \.motd-welcome \{\s+padding: 0;\s+border: 0/,
  );
  assert.match(
    rule(".is-game.motd-home .random-map-widget .map-card-content"),
    /grid-column: 2/,
  );
});

test("MOTD heading and supporting fonts derive from a capped readable scale", () => {
  for (const selector of [
    ".motd-welcome h1",
    ".motd-rules h2",
    ".live-chat-heading h2",
  ]) {
    assert.match(
      rule(`.is-game.motd-home ${selector}`),
      /font-size: calc\(var\(--motd-text\) \* 1\.(45|2)\)/,
    );
  }
  assert.match(home, /\.guide-description \{\s+font-size: var\(--motd-text\)/);
  assert.match(rule(".is-game.motd-home .chat-close"), /font-size: 1\.8rem/);
});
