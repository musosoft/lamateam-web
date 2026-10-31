import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { resolveChatProfile } from "./chat-profile.ts";
import { readSteamProfile } from "./steam-profile.ts";
import { issueSteamSession } from "./steam-session.ts";
import { normalizeMotdCommunityId } from "./hlstats-motd.ts";

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
function apiHarness({
  rows = [],
  fetcher = async () => new Response(null, { status: 503 }),
  failRepair = false,
} = {}) {
  const writes = [];
  const code = stripTypeScriptTypes(
    withoutImports(api)
      .replaceAll("import.meta.env", "testEnv")
      .replace(/export (const |async function )/g, "$1"),
    { mode: "transform" },
  );
  const handlers = vm.runInNewContext(
    `(() => { ${code}; return { POST, GET, resolveChatAvatars }; })()`,
    {
      Request,
      Response,
      console,
      Date,
      Math,
      URL,
      setTimeout,
      clearTimeout,
      fetch: fetcher,
      testEnv: {
        DEV: true,
        STEAM_API_KEY: secret,
        TURSO_DATABASE_URL: "file:test",
      },
      env: {},
      readSteamProfile,
      resolveChatProfile,
      normalizeMotdCommunityId,
      createClient: () => ({
        execute: async (statement) => {
          writes.push(statement);
          if (
            failRepair &&
            typeof statement === "object" &&
            statement.sql.startsWith("UPDATE")
          ) {
            throw new Error("repair unavailable");
          }
          return { rows };
        },
      }),
      getSedliakReply: () => null,
    },
  );
  return { ...handlers, writes };
}
async function post(req, options) {
  const harness = apiHarness(options);
  return {
    response: await harness.POST({ request: req }),
    writes: harness.writes,
  };
}
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

const avatar = "https://avatars.steamstatic.com/player_full.jpg";
const summaries = (players) => Response.json({ response: { players } });
const player = (steamid = id, avatarfull = avatar) => ({ steamid, avatarfull });

test("avatar resolver batches deduplicated valid Steam64 IDs and binds the Worker fetch receiver", async () => {
  const other = "76561199385049281";
  const calls = [];
  const { resolveChatAvatars } = apiHarness({
    fetcher: function workerFetch(url, ...init) {
      assert.equal(this.fetch, workerFetch); // must receive the VM global, not undefined
      assert.equal(init.length, 0);
      calls.push(new URL(url).searchParams.get("steamids"));
      return Promise.resolve(summaries([player(), player(other)]));
    },
  });
  const result = await resolveChatAvatars(
    [id, id, "bad", "00000000000000000", other],
    "key",
  );
  assert.equal(result.size, 2);
  assert.equal(result.get(other), avatar);
  assert.deepEqual(calls, [`${id},${other}`]);
});

test("avatar resolver retries missing IDs after incomplete, failed or malformed batches", async () => {
  const other = "76561199385049281";
  for (const batch of [
    () => summaries([player()]),
    () => new Response(null, { status: 503 }),
    () => new Response("not json"),
    () => {
      throw new TypeError("network failure");
    },
  ]) {
    const calls = [];
    const { resolveChatAvatars } = apiHarness({
      fetcher: async (url) => {
        const ids = new URL(url).searchParams.get("steamids").split(",");
        calls.push(ids);
        return calls.length === 1
          ? batch()
          : summaries(ids.map((value) => player(value)));
      },
    });
    const result = await resolveChatAvatars([id, other], "key");
    assert.equal(result.size, 2);
    assert.equal(calls[0].length, 2);
    assert.ok(calls.slice(1).every((ids) => ids.length === 1));
  }
});

test("avatar resolver rejects non-Steam HTTPS metadata and unrequested identities", async () => {
  for (const unsafe of [
    "http://avatars.steamstatic.com/x.jpg",
    "https://avatars.steamstatic.com.evil.test/x.jpg",
    "https://evil.test/x.jpg",
    "https://user:pass@avatars.steamstatic.com/x.jpg",
    "https://avatars.steamstatic.com:444/x.jpg",
    "not a URL",
  ]) {
    const { resolveChatAvatars } = apiHarness({
      fetcher: async () =>
        summaries([player(id, unsafe), player("76561199385049281")]),
    });
    assert.equal((await resolveChatAvatars([id], "key")).size, 0);
  }
});

test("avatar resolver bounds batch, retries and stalled fetch/body; missing credentials do no IO", async () => {
  let calls = 0;
  const { resolveChatAvatars } = apiHarness({
    fetcher: async () => {
      calls++;
      return summaries([]);
    },
  });
  const ids = Array.from({ length: 70 }, (_, i) =>
    String(BigInt(id) + BigInt(i)),
  );
  assert.equal((await resolveChatAvatars(ids)).size, 0);
  assert.equal((await resolveChatAvatars(["bad"], "key")).size, 0);
  assert.equal(calls, 0);
  await resolveChatAvatars(ids, "key");
  assert.equal(calls, 6);
  for (const fetcher of [
    () => new Promise(() => {}),
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
  ]) {
    const start = Date.now();
    assert.equal((await resolveChatAvatars([id], "key", fetcher, 20)).size, 0);
    assert.ok(Date.now() - start < 1000);
  }
});

test("MOTD POST uses server avatar, never submitted metadata; failed lookup preserves posting", async () => {
  const result = await post(request({ body }), {
    fetcher: async () => summaries([player()]),
  });
  assert.equal(result.response.status, 201);
  assert.equal((await result.response.json()).player_avatar, avatar);
  assert.equal(result.writes[0].args[4], avatar);
  const failed = await post(request({ body }), {
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(failed.response.status, 201);
  assert.equal(
    (await failed.response.json()).player_avatar,
    "/assets/default-avatar.webp",
  );
});

test("signed POST preserves authoritative profile avatar without Steam lookup", async () => {
  const display = { steamID: id, playerName: "Signed", playerAvatar: avatar };
  const cookie = `steam_auth=${await issueSteamSession(id, secret)}; session=${encodeURIComponent(JSON.stringify(display))}`;
  let calls = 0;
  const result = await post(request({ cookie, body }), {
    fetcher: async () => {
      calls++;
      throw new Error("unexpected lookup");
    },
  });
  assert.equal(result.response.status, 201);
  assert.equal((await result.response.json()).player_avatar, avatar);
  assert.equal(calls, 0);
});

test("GET repairs only exact-default recent valid Steam rows, conditionally persists, and tolerates repair failure", async () => {
  const rows = [
    {
      steamid: id,
      player_name: "Recent",
      message: "Hi",
      timestamp: "2026-11-01T00:00:00Z",
      player_avatar: "/assets/default-avatar.webp",
    },
    { steamid: id, player_avatar: "https://custom.test/avatar" },
    { steamid: "sedliak-bot", player_avatar: "/assets/default-avatar.webp" },
    { steamid: "bad", player_avatar: "/assets/default-avatar.webp" },
    { steamid: id, player_avatar: null },
    { steamid: id, player_avatar: "/assets/default-avatar.webp?custom" },
  ];
  for (const failRepair of [false, true]) {
    const harness = apiHarness({
      rows,
      failRepair,
      fetcher: async (url) => {
        assert.equal(new URL(url).searchParams.get("steamids"), id);
        return summaries([player()]);
      },
    });
    const response = await harness.GET();
    assert.equal(response.status, 200);
    const messages = await response.json();
    assert.equal(messages[0].player_avatar, avatar);
    assert.deepEqual(messages.slice(1), rows.slice(1));
    assert.equal(rows[0].player_avatar, "/assets/default-avatar.webp");
    assert.match(harness.writes[0], /ORDER BY timestamp DESC LIMIT 50/);
    assert.equal(harness.writes.length, 2);
    assert.match(
      harness.writes[1].sql,
      /WHERE steamid = \? AND timestamp = \? AND player_avatar = \?/,
    );
    assert.deepEqual(Array.from(harness.writes[1].args), [
      avatar,
      id,
      rows[0].timestamp,
      rows[0].player_avatar,
    ]);
  }
  const failed = apiHarness({
    rows,
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  const response = await failed.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), rows);
  assert.equal(failed.writes.length, 1);
});
