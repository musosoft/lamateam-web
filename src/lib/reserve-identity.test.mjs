import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
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

test("verified Steam session wins over query and cookie hints in either context", async () => {
  const token = await issueSteamSession(id, secret);
  for (const game of [false, true]) {
    const req = request({
      game,
      query: `?communityid=${other}&communityid=invalid`,
      cookie: `steam_auth=${token}; communityid=${other}`,
    });
    const profile = await readSteamProfile(req, secret);
    assert.equal(reserveSteamPrefill(req, profile), id);
  }
});

test("browser query, legacy display cookie and forged auth never prefill a login", async () => {
  const req = request({
    query: `?communityid=${id}`,
    cookie: `communityid=${id}; session=${encodeURIComponent(JSON.stringify({ steamID: id }))}; steam_auth=forged`,
  });
  const profile = await readSteamProfile(req, secret);
  assert.equal(profile, null);
  assert.equal(reserveSteamPrefill(req, profile), "");
  assert.equal(reserveSteamPrefill(request(), null), "");
});

test("MOTD hint accepts normalized Steam64/3/2 and query precedes cookie", () => {
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

test("ambiguous, empty and invalid MOTD hints fail closed, without cookie fallback", () => {
  for (const query of [
    `?communityid=${id}&communityid=${other}`,
    "?communityid=",
    "?communityid=invalid",
    "?communityid=STEAM_0:0:0",
    "?communityid=%5BU%3A1%3A4294967296%5D",
    `?communityid=${"1".repeat(33)}`,
  ]) {
    assert.equal(
      reserveSteamPrefill(
        request({ game: true, query, cookie: `communityid=${id}` }),
        null,
      ),
      "",
    );
  }
});

test("VIP wires middleware identity to an editable prefill, preserving review invalidation", () => {
  const page = readFileSync(
    new URL("../pages/vip.astro", import.meta.url),
    "utf8",
  );
  const frontmatter = page.split("---")[1].replace(/^import[\s\S]*?;\n/gm, "");
  const req = request({ game: true, query: `?communityid=${other}` });
  const result = vm.runInNewContext(
    `(() => { ${stripTypeScriptTypes(frontmatter, { mode: "transform" })}; return steamPrefill; })()`,
    {
      Astro: {
        props: {},
        url: new URL(req.url),
        request: req,
        locals: { steamProfile: { steamID: id } },
      },
      localeFromPath: () => "en",
      translator: () => (value) => value,
      reserveSteamPrefill,
    },
  );
  assert.equal(result, id);
  const input = page.match(/<input\s+id="reserve-steam"[\s\S]*?\/>/)[0];
  assert.match(input, /value=\{steamPrefill\}/);
  assert.match(input, /required/);
  assert.doesNotMatch(input, /readonly|disabled/);
  assert.match(page, /checkout\.addEventListener\('input', invalidate\)/);
  assert.match(page, /!checkout\.reportValidity\(\)/);
  assert.match(page, /throw new Error\('Changed checkout'\)/);
});
