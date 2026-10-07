import assert from "node:assert/strict";
import test from "node:test";
import {
  issueSteamSession,
  readSteamSession,
  STEAM_AUTH_COOKIE,
  STEAM_SESSION_SECONDS,
} from "./steam-session.ts";

const steamID = "76561198000000001";
const secret = "offline-test-key-not-a-real-secret";
const now = 1_800_000_000_000;
const request = (cookie) =>
  new Request("https://lamateam.eu/api/map-ratings", { headers: { cookie } });

test("server-issued expiring MAC authorizes the Steam identity only", async () => {
  const token = await issueSteamSession(steamID, secret, now);
  const req = request(`${STEAM_AUTH_COOKIE}=${token}`);
  assert.equal(await readSteamSession(req, secret, now), steamID);
  assert.equal(
    await readSteamSession(req, secret, now + STEAM_SESSION_SECONDS * 1000),
    null,
  );
  assert.equal(await readSteamSession(req, "rotated-key", now), null);
  assert.equal(await readSteamSession(req, undefined, now), null);
});

test("unsigned, malformed, tampered and future-dated cookies cannot authorize", async () => {
  const token = await issueSteamSession(steamID, secret, now);
  const legacy = `session=${encodeURIComponent(JSON.stringify({ steamID, playerName: "Forged" }))}`;
  assert.equal(await readSteamSession(request(legacy), secret, now), null);
  for (const value of [
    "",
    "{}",
    token.replace(steamID, "76561198000000002"),
    `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
  ]) {
    assert.equal(
      await readSteamSession(
        request(`${STEAM_AUTH_COOKIE}=${value}; ${legacy}`),
        secret,
        now,
      ),
      null,
    );
  }
  const future = await issueSteamSession(steamID, secret, now + 1000);
  assert.equal(
    await readSteamSession(
      request(`${STEAM_AUTH_COOKIE}=${future}`),
      secret,
      now,
    ),
    null,
  );
  await assert.rejects(issueSteamSession("invalid", secret, now));
  await assert.rejects(issueSteamSession(steamID, "", now));
});
