import assert from "node:assert/strict";
import test from "node:test";
import { reserveSteamPrefill } from "./reserve-identity.ts";
import { readSteamProfile } from "./steam-profile.ts";
import { issueSteamSession } from "./steam-session.ts";

const id = "76561197960265731";
const other = "76561197960265733";
const secret = "reserve-offline-test-secret";
function request({ query = "", game = false, cookie = "" } = {}) {
  return new Request(`https://lamateam.eu/vip${query}`, {
    headers: {
      "user-agent": game ? "Valve Steam GameOverlay" : "Mozilla/5.0",
      cookie,
    },
  });
}

test("verified Steam session wins over query and cookie hints", async () => {
  const token = await issueSteamSession(id, secret);
  for (const game of [false, true]) {
    const req = request({
      game,
      query: `?communityid=${other}&communityid=invalid`,
      cookie: `steam_auth=${token}; communityid=${other}`,
    });
    assert.equal(
      reserveSteamPrefill(req, await readSteamProfile(req, secret)),
      id,
    );
  }
});

test("browser query, legacy display cookie and forged auth never prefill", async () => {
  const req = request({
    query: `?communityid=${id}`,
    cookie: `communityid=${id}; session=${encodeURIComponent(JSON.stringify({ steamID: id }))}; steam_auth=forged`,
  });
  const profile = await readSteamProfile(req, secret);
  assert.equal(profile, null);
  assert.equal(reserveSteamPrefill(req, profile), "");
  assert.equal(reserveSteamPrefill(request(), null), "");
});

test("MOTD hints normalize Steam64/3/2; query precedes cookie", () => {
  for (const value of [id, "[U:1:3]", "STEAM_0:1:1"]) {
    assert.equal(
      reserveSteamPrefill(
        request({
          game: true,
          query: `?communityid=${encodeURIComponent(value)}`,
          cookie: `communityid=${other}`,
        }),
        null,
      ),
      id,
    );
  }
  assert.equal(
    reserveSteamPrefill(
      request({ game: true, cookie: `communityid=${id}` }),
      null,
    ),
    id,
  );
});

test("ambiguous, empty and invalid MOTD hints fail closed without cookie fallback", () => {
  for (const query of [
    `?communityid=${id}&communityid=${other}`,
    "?communityid=",
    "?communityid=invalid",
    "?communityid=STEAM_0:0:0",
    "?communityid=%5BU%3A1%3A4294967296%5D",
    `?communityid=${"1".repeat(33)}`,
  ])
    assert.equal(
      reserveSteamPrefill(
        request({ game: true, query, cookie: `communityid=${id}` }),
        null,
      ),
      "",
    );
});
