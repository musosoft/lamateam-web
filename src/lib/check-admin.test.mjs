import assert from "node:assert/strict";
import test from "node:test";
import { isCheckAdmin } from "./check-admin.ts";

// Synthetic public individual account IDs, never the production allowlist.
const id = "76561197960265732";
const other = "76561197960265733";

test("only canonical IDs in a fully valid, unique allowlist are admins", () => {
  assert.equal(isCheckAdmin(id, id), true);
  assert.equal(isCheckAdmin(id, `${other},${id}`), true);
  assert.equal(isCheckAdmin(other, id), false);
  for (const identity of [
    undefined,
    null,
    "",
    "BOT",
    "STEAM_0:0:2",
    "[U:1:4]",
    ` ${id}`,
    `${id}\n`,
    "76561197960265728",
    "76561202255233024",
  ])
    assert.equal(isCheckAdmin(identity, id), false);
  for (const allowlist of [
    undefined,
    "",
    " ",
    ` ${id}`,
    `${id} `,
    `${id}\n`,
    `${id},`,
    `,${id}`,
    `${id},,${other}`,
    `${id},${id}`,
    `${id},${other},${other}`,
    `${id}, ${other}`,
    `${id};${other}`,
    `${id},BOT`,
    `${id},STEAM_0:0:2`,
    `${id},[U:1:4]`,
    `${id},76561197960265728`,
    `${id},76561202255233024`,
  ])
    assert.equal(isCheckAdmin(id, allowlist), false, String(allowlist));
});
