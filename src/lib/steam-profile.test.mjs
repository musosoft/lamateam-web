import assert from "node:assert/strict";
import test from "node:test";
import { readSteamProfile } from "./steam-profile.ts";
import { issueSteamSession } from "./steam-session.ts";
const secret = "stable-render-offline-test-key";
const id = "76561198000000001";
const request = (token, display) =>
  new Request(
    "https://lamateam.eu/?communityid=76561198000000002&name=Imposter",
    {
      headers: {
        cookie: `steam_auth=${token}; session=${encodeURIComponent(JSON.stringify(display))}`,
      },
    },
  );
test("only verified session authorizes first HTML; query and display cookies cannot", async () => {
  const display = {
    steamID: id,
    playerName: "Signed Player",
    playerAvatar: "https://avatars.steamstatic.com/test.jpg",
  };
  for (const token of [
    "",
    "forged",
    await issueSteamSession(id, "wrong-key"),
    await issueSteamSession(id, secret, Date.now() - 86401000),
  ]) {
    assert.equal(await readSteamProfile(request(token, display), secret), null);
  }
  const signed = await issueSteamSession(id, secret);
  assert.deepEqual(
    await readSteamProfile(request(signed, display), secret),
    display,
  );
  assert.deepEqual(
    await readSteamProfile(
      request(signed, { ...display, steamID: "76561198000000002" }),
      secret,
    ),
    {
      steamID: id,
      playerName: "Steam player",
      playerAvatar: "/assets/default-avatar.webp",
    },
  );
  for (const avatar of [
    "javascript:alert(1)",
    "https://evil.test/a",
    "https://user@avatars.steamstatic.com/a",
    "https://avatars.steamstatic.com:8443/a",
  ]) {
    assert.equal(
      (
        await readSteamProfile(
          request(signed, { ...display, playerAvatar: avatar }),
          secret,
        )
      ).playerAvatar,
      "/assets/default-avatar.webp",
    );
  }
});
