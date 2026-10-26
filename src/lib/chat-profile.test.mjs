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
async function post(req) {
  const writes = [];
  const code = stripTypeScriptTypes(
    withoutImports(api)
      .replaceAll("import.meta.env", "testEnv")
      .replace(/export const /g, "const "),
    { mode: "transform" },
  );
  const handler = vm.runInNewContext(`(() => { ${code}; return POST; })()`, {
    Request,
    Response,
    console,
    Date,
    Math,
    testEnv: {
      DEV: true,
      STEAM_API_KEY: secret,
      TURSO_DATABASE_URL: "file:test",
    },
    env: {},
    readSteamProfile,
    resolveChatProfile,
    resolveChatAvatars: async () => new Map(),
    DEFAULT_CHAT_AVATAR,
    createClient: () => ({
      execute: async (statement) => {
        writes.push(statement);
        return { rows: [] };
      },
    }),
    getSedliakReply: () => null,
  });
  return { response: await handler({ request: req }), writes };
}
const body = {
  steamid: id,
  player_name: "Body imposter",
  player_avatar: "https://evil.test/avatar",
  message: "Hello",
};

test("avatar lookup falls back to the existing working single-profile route", async () => {
  const otherID = "76561198257068544";
  const requestedSteamLookups = [];
  const avatars = await resolveChatAvatars(
    [id, otherID],
    secret,
    async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/steamUser") {
        const profileID = parsed.searchParams.get("steamid");
        return Response.json({ avatar: `https://avatars.steamstatic.com/${profileID}_full.jpg` });
      }
      const ids = parsed.searchParams.get("steamids").split(",");
      requestedSteamLookups.push(ids);
      return new Response("forbidden", { status: 403 });
    },
  );
  assert.deepEqual(requestedSteamLookups, [[id, otherID], [id], [otherID]]);
  assert.equal(avatars.size, 2);
  assert.equal(avatars.get(id), `https://avatars.steamstatic.com/${id}_full.jpg`);
  assert.equal(avatars.get(otherID), `https://avatars.steamstatic.com/${otherID}_full.jpg`);
});

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
  assert.equal(saved.player_avatar, view.profile.playerAvatar);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].args[0], id);
  assert.equal(result.writes[0].args[1], "Claimed Player");
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
