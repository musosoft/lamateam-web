import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHlstatsMeHandler } from "../../../lib/hlstats.ts";
import {
  issueSteamSession,
  readSteamSession,
} from "../../../lib/steam-session.ts";

const id = "76561197960265731";
const secret = "synthetic-session-secret";
const stats = {
  rank: 12,
  skill: 1234,
  kills: 100,
  deaths: 40,
  kpd: 2.5,
  headshots: 25,
  accuracy: 24.25,
};
const session = (request) => readSteamSession(request, secret);
const request = (cookie = "", suffix = "") =>
  new Request(`https://lamateam.eu/api/stats/me${suffix}`, {
    headers: { Cookie: cookie },
  });
async function check(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const data = await response.text();
  assert.doesNotMatch(
    data,
    /7656119|STEAM_|synthetic-session-secret|<html|playerId|uniqueid/,
  );
  assert.deepEqual(JSON.parse(data), body);
}

test("unauthorized or legacy/forged/expired cookies never reach HLstats", async () => {
  const handle = createHlstatsMeHandler({
    session,
    load: async () => assert.fail("must not load"),
  });
  const expired = await issueSteamSession(id, secret, Date.now() - 86_401_000);
  const forged = await issueSteamSession(id, "wrong-secret");
  const invalidIdentity = await issueSteamSession("00000000000000001", secret);
  for (const cookie of [
    "",
    `steam_user=${encodeURIComponent(JSON.stringify({ steamID: id }))}`,
    `steam_auth=${expired}`,
    `steam_auth=${forged}`,
    `steam_auth=${invalidIdentity}`,
  ]) {
    await check(await handle(request(cookie, `?steamID=${id}`)), 401, {
      available: false,
      reason: "unauthorized",
    });
  }
});

test("signed session is sole identity source; exact stable aggregates and private states", async () => {
  const cookie = `steam_auth=${await issueSteamSession(id, secret)}`;
  for (const [result, status] of [
    [{ available: true, stats }, 200],
    [{ available: false, reason: "not_found" }, 404],
    [{ available: false, reason: "unavailable" }, 503],
  ]) {
    const handle = createHlstatsMeHandler({
      session,
      load: async (actual) => {
        assert.equal(actual, id);
        return result;
      },
    });
    await check(
      await handle(
        request(
          cookie,
          "?steamID=76561197960265730&uniqueid=0:1&url=https://evil.test",
        ),
      ),
      status,
      result,
    );
  }
  const failed = createHlstatsMeHandler({
    session,
    load: async () => {
      throw new Error(id);
    },
  });
  await check(await failed(request(cookie)), 503, {
    available: false,
    reason: "unavailable",
  });
});

test("non-GET body is not consumed and cannot select identity", async () => {
  const handle = createHlstatsMeHandler({
    session: async () => assert.fail("must not authenticate"),
    load: async () => assert.fail("must not load"),
  });
  const response = await handle(
    new Request("https://lamateam.eu/api/stats/me", {
      method: "POST",
      body: JSON.stringify({ steamID: id }),
    }),
  );
  await check(response, 405, {
    available: false,
    reason: "method_not_allowed",
  });
});

test("endpoint wiring uses verified Steam session and server-only bindings", () => {
  const endpoint = readFileSync(new URL("./me.ts", import.meta.url), "utf8");
  assert.match(endpoint, /readSteamSession\(/);
  assert.match(endpoint, /env\.STEAM_API_KEY/);
  assert.match(endpoint, /statsEnv\.HLSTATS_WAF_BYPASS_TOKEN/);
  assert.match(endpoint, /prerender = false/);
  assert.doesNotMatch(endpoint, /searchParams|\.json\(|steam_user|console\./);
});
