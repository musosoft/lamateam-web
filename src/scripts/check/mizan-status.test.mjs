import assert from "node:assert/strict";
import test from "node:test";
import { mizanBadge } from "./mizan-status.ts";

test("Mizan badges have textual states, caveats, icons and timestamps", () => {
  for (const state of ["clear", "review", "pending", "unavailable"]) {
    const badge = mizanBadge({ state, queriedAt: 1800000000000 });
    assert.equal(badge.state, state);
    assert.match(badge.label.toLowerCase(), new RegExp(state));
    assert.ok(badge.icon);
    assert.equal(badge.queriedAt, 1800000000000);
  }
  assert.match(mizanBadge({ state: "clear" }).label, /not proof of innocence/);
  assert.match(
    mizanBadge({ state: "review" }).label,
    /verify before any action/,
  );
  for (const value of [null, {}, { state: "bad" }])
    assert.equal(mizanBadge(value).state, "unavailable");
});
