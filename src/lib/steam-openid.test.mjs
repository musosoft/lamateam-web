import assert from "node:assert/strict";
import test from "node:test";
import {
  createSteamOpenIdHandlers,
  OPENID_NS,
  STATE_SECONDS,
  STEAM_OP,
  STEAM_STATE_COOKIE,
  trustedSteamOrigin,
} from "./steam-openid.ts";
import { readSteamSession, STEAM_AUTH_COOKIE } from "./steam-session.ts";

const origin = "https://lamateam.eu";
const steamID = "76561198000000001";
const secret = "offline-test-key-not-a-real-secret";
const now = Date.parse("2026-10-07T12:00:00Z");

function cookieJar() {
  const values = new Map();
  const writes = [];
  const deletes = [];
  return {
    values,
    writes,
    deletes,
    get: (name) => (values.has(name) ? { value: values.get(name) } : undefined),
    set(name, value, options) {
      values.set(name, value);
      writes.push({ name, value, options });
    },
    delete(name, options) {
      values.delete(name);
      deletes.push({ name, options });
    },
  };
}

async function fixture(options = {}) {
  const cookies = cookieJar();
  const calls = [];
  let time = now;
  const handlers = createSteamOpenIdHandlers({
    secret: () => secret,
    now: () => time,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === STEAM_OP)
        return new Response(`ns:${OPENID_NS}\nis_valid:true\n`);
      return Response.json({
        response: {
          players: [{ personaname: "Player", avatarfull: "avatar" }],
        },
      });
    },
    ...options,
  });
  const start = await handlers.start(
    new Request(`${origin}/api/auth/steam`),
    cookies,
  );
  assert.equal(start.status, 302);
  const redirect = new URL(start.headers.get("location"));
  const returnTo = redirect.searchParams.get("openid.return_to");
  const state = new URL(returnTo).searchParams.get("state");
  const params = new URLSearchParams({
    state,
    "openid.ns": OPENID_NS,
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OP,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${steamID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${steamID}`,
    "openid.return_to": returnTo,
    "openid.response_nonce": "2026-10-07T12:00:00Zunique",
    "openid.assoc_handle": "offline-handle",
    "openid.signed":
      "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "offline-signature",
  });
  const callback = () =>
    handlers.callback(
      new Request(`${origin}/api/auth/steam/callback?${params}`),
      cookies,
    );
  return {
    cookies,
    calls,
    handlers,
    params,
    callback,
    state,
    redirect,
    time: (value) => {
      time = value;
    },
  };
}

function assertConsumed(f) {
  assert.equal(f.cookies.values.has(STEAM_STATE_COOKIE), false);
  assert.equal(f.cookies.deletes.length, 1);
  assert.equal(f.cookies.deletes[0].name, STEAM_STATE_COOKIE);
}

test("start uses unpredictable expiring host-only state and a trusted return_to", async () => {
  const f = await fixture();
  const second = await fixture();
  assert.match(f.state, /^[a-f0-9]{64}$/);
  assert.notEqual(f.state, second.state);
  assert.equal(f.redirect.origin + f.redirect.pathname, STEAM_OP);
  assert.equal(f.redirect.searchParams.get("openid.realm"), origin);
  assert.equal(
    f.redirect.searchParams.get("openid.return_to"),
    `${origin}/api/auth/steam/callback?state=${f.state}`,
  );
  assert.deepEqual(f.cookies.writes[0].options, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: STATE_SECONDS,
  });
});

test("valid flow verifies with Steam, preserves display cookie and authorizes signed session; browser replay fails", async () => {
  const f = await fixture();
  const response = await f.callback();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assertConsumed(f);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, STEAM_OP);
  assert.equal(f.calls[0].init.redirect, "manual");
  const verification = new URLSearchParams(f.calls[0].init.body);
  assert.equal(verification.get("openid.mode"), "check_authentication");
  assert.equal(verification.has("state"), false);
  assert.deepEqual(
    JSON.parse(decodeURIComponent(f.cookies.values.get("session"))),
    {
      steamID,
      playerName: "Player",
      playerAvatar: "avatar",
    },
  );
  const request = new Request(`${origin}/api/map-ratings`, {
    headers: {
      cookie: `${STEAM_AUTH_COOKIE}=${f.cookies.values.get(STEAM_AUTH_COOKIE)}`,
    },
  });
  assert.equal(await readSteamSession(request, secret, now), steamID);
  assert.equal((await f.callback()).status, 401);
  assert.equal(f.calls.length, 2);
});

test("missing/mismatched/expired/tampered state fails before network and clears cookie", async () => {
  for (const mutate of [
    (f) => f.params.delete("state"),
    (f) => f.params.set("state", "a".repeat(64)),
    (f) => f.cookies.values.delete(STEAM_STATE_COOKIE),
    (f) => f.time(now + STATE_SECONDS * 1000),
    (f) =>
      f.cookies.values.set(
        STEAM_STATE_COOKIE,
        `${f.state}.${Math.floor(now / 1000) + STATE_SECONDS}.` +
          "0".repeat(64),
      ),
  ]) {
    const f = await fixture();
    mutate(f);
    assert.equal((await f.callback()).status, 401);
    assertConsumed(f);
    assert.equal(f.calls.length, 0);
    assert.equal(f.cookies.values.has(STEAM_AUTH_COOKIE), false);
  }
});

test("rejects namespace/OP/return_to/identity mismatches, unsigned fields and duplicate parameters", async () => {
  for (const [key, value] of [
    ["openid.ns", "http://specs.openid.net/auth/1.1"],
    ["openid.mode", "cancel"],
    ["openid.op_endpoint", "https://evil.example/openid/login"],
    ["openid.op_endpoint", `${STEAM_OP}/`],
    ["openid.return_to", "https://evil.example/api/auth/steam/callback"],
    ["openid.return_to", `${origin}/api/auth/steam/callback`],
    [
      "openid.identity",
      "https://steamcommunity.com/openid/id/76561198000000002",
    ],
    ["openid.claimed_id", `https://evil.example/openid/id/${steamID}`],
    ["openid.claimed_id", `http://steamcommunity.com/openid/id/${steamID}`],
    [
      "openid.signed",
      "op_endpoint,claimed_id,identity,response_nonce,assoc_handle",
    ],
    ["openid.sig", ""],
  ]) {
    const f = await fixture();
    f.params.set(key, value);
    assert.equal((await f.callback()).status, 401, key);
    assertConsumed(f);
    assert.equal(f.calls.length, 0);
  }
  for (const key of ["state", "openid.identity", "openid.return_to"]) {
    const f = await fixture();
    f.params.append(key, f.params.get(key));
    assert.equal((await f.callback()).status, 401);
    assertConsumed(f);
    assert.equal(f.calls.length, 0);
  }
});

test("rejects stale, future, malformed and impossible nonce timestamps", async () => {
  for (const nonce of [
    "2026-10-07T11:54:59Zstale",
    "2026-10-07T12:00:31Zfuture",
    "2026-02-30T12:00:00Zinvalid",
    "garbage",
    "2026-10-07T12:00:00Z",
  ]) {
    const f = await fixture();
    f.params.set("openid.response_nonce", nonce);
    assert.equal((await f.callback()).status, 401);
    assertConsumed(f);
    assert.equal(f.calls.length, 0);
  }
});

test("origin policy never trusts Host/Forwarded, accepts only configured HTTPS origins", async () => {
  assert.equal(trustedSteamOrigin(), origin);
  assert.equal(
    trustedSteamOrigin("https://login.example/"),
    "https://login.example",
  );
  for (const site of [
    "http://lamateam.eu",
    "https://user@lamateam.eu",
    "https://lamateam.eu/path",
    "https://lamateam.eu/?x=1",
  ]) {
    assert.throws(() => trustedSteamOrigin(site));
  }
  const f = await fixture();
  const evilStart = await f.handlers.start(
    new Request("https://evil.example/api/auth/steam", {
      headers: { host: "lamateam.eu", "x-forwarded-host": "lamateam.eu" },
    }),
    cookieJar(),
  );
  assert.equal(evilStart.status, 403);
  const evilCallback = await f.handlers.callback(
    new Request(`https://evil.example/api/auth/steam/callback?${f.params}`),
    f.cookies,
  );
  assert.equal(evilCallback.status, 401);
  assertConsumed(f);
  assert.equal(f.calls.length, 0);
});

test("verification rejection/throw and profile failures clear state without issuing sessions", async () => {
  for (const fetcher of [
    async () => new Response(`ns:${OPENID_NS}\nis_valid:false\n`),
    async () => new Response(`ns:${OPENID_NS}\nis_valid:trueevil\n`),
    async () =>
      new Response(`ns:${OPENID_NS}\nis_valid:true\nis_valid:false\n`),
    async () => {
      throw new Error("private assertion body");
    },
    async (url) =>
      String(url) === STEAM_OP
        ? new Response(`ns:${OPENID_NS}\nis_valid:true\n`)
        : new Response("private API body", { status: 500 }),
  ]) {
    const f = await fixture({ fetch: fetcher });
    const response = await f.callback();
    assert.equal(response.status, 401);
    assert.equal(await response.text(), "Authentication failed");
    assertConsumed(f);
    assert.equal(f.cookies.values.has(STEAM_AUTH_COOKIE), false);
    assert.equal(f.cookies.values.has("session"), false);
  }
});

test("failed callbacks preserve existing display/auth sessions and clear state even without configuration", async () => {
  const f = await fixture();
  f.cookies.values.set("session", "existing-display-session");
  f.cookies.values.set(STEAM_AUTH_COOKIE, "existing-signed-session");
  f.params.delete("state");
  assert.equal((await f.callback()).status, 401);
  assertConsumed(f);
  assert.equal(f.cookies.values.get("session"), "existing-display-session");
  assert.equal(
    f.cookies.values.get(STEAM_AUTH_COOKIE),
    "existing-signed-session",
  );

  const unconfigured = createSteamOpenIdHandlers({
    secret: () => undefined,
    fetch: async () => {
      assert.fail("unconfigured login must not fetch");
    },
  });
  const cookies = cookieJar();
  cookies.values.set(STEAM_STATE_COOKIE, "old-state");
  const response = await unconfigured.callback(
    new Request(`${origin}/api/auth/steam/callback`),
    cookies,
  );
  assert.equal(response.status, 500);
  assert.equal(cookies.values.has(STEAM_STATE_COOKIE), false);
});

test("profile fetch uses a string URL and local unbound fetch reference", async () => {
  let profileUrlType;
  const f = await fixture({
    fetch: async (url, init) => {
      if (String(url) === STEAM_OP) {
        profileUrlType = typeof url;
        return new Response(`ns:${OPENID_NS}\nis_valid:true\n`);
      }
      return Response.json({
        response: {
          players: [{ personaname: "Player", avatarfull: "avatar" }],
        },
      });
    },
  });
  const response = await f.callback();
  assert.equal(response.status, 302);
  assert.equal(profileUrlType, "string");
});
