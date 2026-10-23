import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { DEFAULT_CHAT_AVATAR, resolveChatAvatars, resolveChatProfile } from "./chat-profile.ts";
import { readSteamProfile } from "./steam-profile.ts";
import { issueSteamSession } from "./steam-session.ts";

const id = "76561197960265731";
const secret = "chat-test-secret";
const query = "?communityid=%5BU%3A1%3A3%5D&name=Claimed%20Player";
const component = readFileSync(
  new URL("../components/LiveChat.astro", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../pages/api/shoutbox.ts", import.meta.url),
  "utf8",
);
const withoutImports = (source) => source.replace(/^import .*;\n/gm, "");
function request({ game = true, suffix = query, cookie = "", body } = {}) {
  return new Request(
    `https://lamateam.eu/${body ? "api/shoutbox" : ""}${suffix}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "user-agent": game ? "Valve Steam GameOverlay" : "Mozilla/5.0",
        cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
async function render(req) {
  const steamProfile = await readSteamProfile(req, secret);
  const frontmatter = component.split("---")[1];
  const code = stripTypeScriptTypes(withoutImports(frontmatter), {
    mode: "transform",
  });
  return vm.runInNewContext(
    `(() => { ${code}; return { profile, isAuthenticated, motdQuery }; })()`,
    {
      Astro: {
        request: req,
        url: new URL(req.url),
        cookies: { get: () => undefined },
        locals: { steamProfile },
      },
      env: {},
      URLSearchParams,
      resolveChatProfile,
      selectHomeLocale: () => "en",
      localeFromPath: () => "en",
      translator: () => (value) => value,
    },
  );
}
const steamAvatar = "https://avatars.steamstatic.com/resolved.jpg";
async function route(req, { rows = [], fetcher, failUpdate = false, apiKey = secret } = {}) {
  const writes = [];
  const lookups = [];
  const code = stripTypeScriptTypes(
    withoutImports(api)
      .replaceAll("import.meta.env", "testEnv")
      .replace(/export const /g, "const "),
    { mode: "transform" },
  );
  const handlers = vm.runInNewContext(`(() => { ${code}; return { POST, GET }; })()`, {
    Request,
    Response,
    console,
    Date,
    Math,
    testEnv: {
      DEV: true,
      STEAM_API_KEY: apiKey,
      TURSO_DATABASE_URL: "file:test",
    },
    env: {},
    readSteamProfile,
    resolveChatProfile,
    DEFAULT_CHAT_AVATAR,
    resolveChatAvatars: (ids, key) => resolveChatAvatars(ids, key, async (url, options) => {
      lookups.push(new URL(url));
      if (fetcher) return fetcher(url, options);
      return Response.json({ response: { players: [{ steamid: id, avatarfull: steamAvatar }] } });
    }),
    createClient: () => ({
      execute: async (statement) => {
        if (typeof statement === "string") return { rows };
        writes.push(statement);
        if (failUpdate && statement.sql.startsWith("UPDATE")) throw new Error("DB unavailable");
        return { rows: [] };
      },
    }),
    getSedliakReply: () => null,
  });
  return { response: await handlers[req.method]({ request: req }), writes, lookups };
}
const post = route;
const body = {
  steamid: id,
  player_name: "Body imposter",
  player_avatar: "https://evil.test/avatar",
  message: "Hello",
};

test("MOTD raw communityid renders enabled composer and posts the same self-asserted identity", async () => {
  const view = await render(request());
  assert.equal(view.isAuthenticated, true);
  assert.equal(view.profile.steamID, id);
  assert.equal(view.profile.playerName, "Claimed Player");
  assert.match(component, /disabled=\{!isAuthenticated\}/);
  assert.match(
    component,
    /Self-asserted MOTD identity \(not verified by Steam\)/,
  );
  assert.match(component, /data-motd-query=\{motdQuery\}/);
  assert.match(component, /shell\.dataset\.motdQuery/);
  const result = await post(request({ suffix: `?${view.motdQuery}`, body }));
  assert.equal(result.response.status, 201);
  const saved = await result.response.json();
  assert.equal(saved.steamid, view.profile.steamID);
  assert.equal(saved.player_name, view.profile.playerName);
  assert.equal(view.profile.playerAvatar, DEFAULT_CHAT_AVATAR);
  assert.equal(saved.player_avatar, steamAvatar);
  assert.equal(result.lookups.length, 1);
  assert.equal(result.lookups[0].pathname, "/ISteamUser/GetPlayerSummaries/v2/");
  assert.equal(result.lookups[0].searchParams.get("steamids"), id);
  assert.equal(result.lookups[0].searchParams.get("key"), secret);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].args[0], id);
  assert.equal(result.writes[0].args[1], "Claimed Player");
  assert.equal(result.writes[0].args[4], steamAvatar);
});

test("GET resolves and persists only exact-default recent rows with valid Steam64 identities", async () => {
  const row = (steamid, player_avatar = DEFAULT_CHAT_AVATAR, timestamp = "2026-10-23T12:00:00.000Z") => ({
    steamid, player_name: "Player", message: "Hello", timestamp, player_avatar,
  });
  const rows = [
    row(id), row(id, DEFAULT_CHAT_AVATAR, "2026-10-23T11:00:00.000Z"),
    row("sedliak-bot"), row("bad"), row("76561197960265728"),
    row("[U:1:3]"), row(id, "https://avatars.steamstatic.com/custom.jpg"),
    row(id, null), row(id, "/assets/default-avatar.webp?custom"),
  ];
  const result = await route(request(), { rows });
  assert.equal(result.response.status, 200);
  const feed = await result.response.json();
  assert.equal(result.lookups.length, 1);
  assert.equal(result.lookups[0].searchParams.get("steamids"), id);
  assert.equal(result.writes.length, 2);
  for (const [i, write] of result.writes.entries()) {
    assert.match(write.sql, /WHERE steamid = \? AND timestamp = \? AND player_avatar = \?/);
    assert.deepEqual(Array.from(write.args), [steamAvatar, id, rows[i].timestamp, DEFAULT_CHAT_AVATAR]);
    assert.equal(feed[i].player_avatar, steamAvatar);
  }
  for (let i = 2; i < rows.length; i++) assert.equal(feed[i].player_avatar, rows[i].player_avatar);
});

test("Steam enrichment failure preserves POST fallback and GET feed without avatar writes", async () => {
  for (const options of [
    { fetcher: async () => { throw new Error("Steam unavailable"); } },
    { fetcher: async () => new Response("unavailable", { status: 503 }) },
    { fetcher: async () => new Response("not JSON") },
    { fetcher: async () => Response.json({ response: { players: [] } }) },
    { apiKey: "" },
  ]) {
    const submitted = await post(request({ body }), options);
    assert.equal(submitted.response.status, 201);
    assert.equal((await submitted.response.json()).player_avatar, DEFAULT_CHAT_AVATAR);
    assert.equal(submitted.writes[0].args[4], DEFAULT_CHAT_AVATAR);
    const rows = [{ steamid: id, player_avatar: DEFAULT_CHAT_AVATAR, timestamp: "recent" }];
    const feed = await route(request(), { ...options, rows });
    assert.equal(feed.response.status, 200);
    assert.equal((await feed.response.json())[0].player_avatar, DEFAULT_CHAT_AVATAR);
    assert.equal(feed.writes.length, 0);
  }
});

test("GET still returns resolved avatar if best-effort persistence fails", async () => {
  const result = await route(request(), {
    rows: [{ steamid: id, player_avatar: DEFAULT_CHAT_AVATAR, timestamp: "recent" }],
    failUpdate: true,
  });
  assert.equal(result.response.status, 200);
  assert.equal((await result.response.json())[0].player_avatar, steamAvatar);
});

test("avatar resolver skips bot/invalid IDs and rejects mismatched or untrusted upstream avatars", async () => {
  const neverFetch = async () => { assert.fail("invalid identities must not trigger lookup"); };
  assert.equal((await resolveChatAvatars(["sedliak-bot", "bad", "76561197960265728", "[U:1:3]"], secret, neverFetch)).size, 0);
  for (const player of [
    { steamid: "76561197960265730", avatarfull: steamAvatar },
    { steamid: id, avatarfull: "https://evil.test/avatar" },
    { steamid: id, avatarfull: "http://avatars.steamstatic.com/avatar" },
  ]) {
    const avatars = await resolveChatAvatars([id], secret, async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ response: { players: [player] } });
    });
    assert.equal(avatars.size, 0);
  }
});

test("regular browser cannot use query or unsigned legacy session to enable or post chat", async () => {
  const cookie = `session=${encodeURIComponent(JSON.stringify({ steamID: id, playerName: "Legacy" }))}`;
  for (const value of ["", cookie, "steam_auth=forged"]) {
    const view = await render(request({ game: false, cookie: value }));
    assert.equal(view.isAuthenticated, false);
    assert.equal(view.profile, undefined);
    const result = await post(request({ game: false, cookie: value, body }));
    assert.equal(result.response.status, 401);
    assert.equal(result.writes.length, 0);
  }
});

test("signed session remains authoritative in browsers and MOTD even with a different query ID", async () => {
  const display = {
    steamID: id,
    playerName: "Signed Player",
    playerAvatar: "https://avatars.steamstatic.com/test.jpg",
  };
  const cookie = `steam_auth=${await issueSteamSession(id, secret)}; session=${encodeURIComponent(JSON.stringify(display))}`;
  for (const game of [true, false]) {
    const suffix = "?communityid=76561197960265730&name=Spoof";
    const view = await render(request({ game, cookie, suffix }));
    assert.equal(view.isAuthenticated, true);
    assert.equal(view.profile.playerName, "Signed Player");
    assert.equal(view.motdQuery, "");
    const result = await post(request({ game, cookie, suffix, body }));
    assert.equal(result.response.status, 201);
    assert.equal((await result.response.json()).player_name, "Signed Player");
  }
});

test("MOTD accepts normalized Steam64 and cookie sources but rejects malformed, duplicate and mismatching identities", async () => {
  for (const value of [id, "[U:1:3]"]) {
    assert.equal(
      resolveChatProfile(
        request({ suffix: `?communityid=${encodeURIComponent(value)}` }),
        null,
      ).profile.steamID,
      id,
    );
  }
  assert.equal(
    resolveChatProfile(
      request({
        suffix: "",
        cookie: `communityid=${id}; name=Cookie%20Player`,
      }),
      null,
    ).profile.playerName,
    "Cookie Player",
  );
  for (const suffix of [
    "",
    "?communityid=bad",
    "?communityid=[U:1:0]",
    "?communityid=[U:1:4294967296]",
    "?communityid=00000000000000000",
    `?communityid=${id}&communityid=${id}`,
  ]) {
    assert.equal((await render(request({ suffix }))).isAuthenticated, false);
    const result = await post(request({ suffix, body }));
    assert.equal(result.response.status, 401);
    assert.equal(result.writes.length, 0);
  }
  const mismatch = await post(
    request({ body: { ...body, steamid: "76561197960265730" } }),
  );
  assert.equal(mismatch.response.status, 401);
  assert.equal(mismatch.writes.length, 0);
});

test("required-field and reserved-bot checks still run for MOTD", async () => {
  for (const invalid of [
    { ...body, message: "" },
    { ...body, steamid: "sedliak-bot" },
  ]) {
    const result = await post(request({ body: invalid }));
    assert.equal(result.response.status, 400);
    assert.equal(result.writes.length, 0);
  }
});
