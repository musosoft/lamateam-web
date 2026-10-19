import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.astro", import.meta.url), "utf8");
test("first-render avatar uses verified cached profile without client avatar probing", () => {
  assert.match(source, /const profile = Astro.locals.steamProfile/);
  assert.match(
    source,
    /profile\?\.playerAvatar \|\| '\/assets\/default-avatar\.webp'/,
  );
  assert.doesNotMatch(
    source,
    /data-motd-avatar|api\/steamUser|fetchSteamAvatar/,
  );
});

test("website keeps hero stats while MOTD has public guides, not player stats", () => {
  const hero = source.slice(
    source.indexOf("<header"),
    source.indexOf("</header>"),
  );
  assert.match(hero, /class="hero-summary"/);
  assert.match(
    hero,
    /<\/div>\s*\{displayName && !isGame && \(\s*<section\s+class="hero-stats"/,
  );
  assert.match(hero, /!isGame && \(\s*<div class="hero-connect/);
  assert.match(hero, /!isGame && \(\s*<>\s*<p class="hero-intro/);
  const info = source.indexOf('class="motd-info"');
  assert.ok(info > source.indexOf('class="motd-map-rating"'));
  assert.doesNotMatch(
    source.slice(info, source.indexOf("isGame && <ServerRules", info)),
    /data-hero-stats/,
  );
  assert.match(source, /\.home-hero:not\(\.motd-welcome\)/);
});
