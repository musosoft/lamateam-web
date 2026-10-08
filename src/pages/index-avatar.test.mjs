import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./index.astro", import.meta.url), "utf8");
const script = [
  ...source.matchAll(
    /<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/g,
  ),
].find((match) => match[1].includes("img[data-motd-avatar]"))[1];
const avatar = "https://avatars.steamstatic.com/player_full.jpg";

async function hydrate(identity, response = { ok: true, data: { avatar } }) {
  const image = {
    dataset: { motdAvatar: identity },
    src: "/assets/default-avatar.webp",
    isConnected: true,
  };
  const calls = [];
  const pending = [];
  vm.runInNewContext(script, {
    document: {
      querySelector(selector) {
        assert.equal(selector, "img[data-motd-avatar]");
        return identity === undefined ? null : image;
      },
    },
    URL,
    URLSearchParams,
    fetch(url) {
      calls.push(url);
      const result =
        response instanceof Error
          ? Promise.reject(response)
          : Promise.resolve({
              ok: response.ok,
              json: async () => response.data,
            });
      pending.push(result.catch(() => {}));
      return result;
    },
  });
  await Promise.all(pending);
  await new Promise((resolve) => setImmediate(resolve));
  return { image, calls };
}

test("MOTD Steam3 and Steam2 hydrate the same exact Steam64 avatar", async () => {
  assert.match(
    source,
    /data-motd-avatar=\{isGame \? rawCommunityId : undefined\}/,
  );
  for (const identity of [
    "[U:1:39734273]",
    "STEAM_0:1:19867136",
    "STEAM_1:1:19867136",
    "76561198000000001",
  ]) {
    const { image, calls } = await hydrate(identity);
    assert.deepEqual(calls, ["/api/steamUser?steamid=76561198000000001"]);
    assert.equal(image.src, avatar);
  }
  assert.deepEqual((await hydrate("STEAM_0:0:19867136")).calls, [
    "/api/steamUser?steamid=76561198000000000",
  ]);
});

test("desktop, missing and invalid identities never request Steam", async () => {
  for (const identity of [
    undefined,
    "",
    "[U:1:0]",
    "[U:1:4294967296]",
    "[U:2:1]",
    "STEAM_0:2:1",
    "[U:1:1]&steamid=other",
    "76561197960265728",
    "76561202255233024",
    "STEAM_0:1:2147483648",
  ]) {
    const { image, calls } = await hydrate(identity);
    assert.deepEqual(calls, []);
    assert.equal(image.src, "/assets/default-avatar.webp");
  }
});

test("Steam errors, absent avatars and unsafe URLs keep the placeholder", async () => {
  for (const response of [
    new Error("offline"),
    { ok: false, data: { avatar } },
    { ok: true, data: {} },
    { ok: true, data: null },
    { ok: true, data: { avatar: "not a URL" } },
    { ok: true, data: { avatar: "http://avatars.steamstatic.com/a.jpg" } },
    { ok: true, data: { avatar: "https://steamstatic.com.evil.test/a.jpg" } },
    {
      ok: true,
      data: { avatar: "https://user@avatars.steamstatic.com/a.jpg" },
    },
    { ok: true, data: { avatar: "https://avatars.steamstatic.com:444/a.jpg" } },
  ]) {
    const { image } = await hydrate("[U:1:39734273]", response);
    assert.equal(image.src, "/assets/default-avatar.webp");
  }
});

test("uint32 boundaries convert without losing Steam64 precision", async () => {
  for (const identity of ["[U:1:4294967295]", "STEAM_1:1:2147483647"]) {
    assert.deepEqual((await hydrate(identity)).calls, [
      "/api/steamUser?steamid=76561202255233023",
    ]);
  }
  assert.deepEqual((await hydrate("[U:1:1]")).calls, [
    "/api/steamUser?steamid=76561197960265729",
  ]);
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
