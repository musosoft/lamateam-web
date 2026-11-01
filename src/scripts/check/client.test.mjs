import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("recent-player UI and client contain only the list, not hidden row actions or results", () => {
  const component = readFileSync(
    new URL("../../components/PlayerReview.astro", import.meta.url),
    "utf8",
  );
  const client = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
  assert.match(component, />\s*Check recent players\s*<\/h2>/);
  assert.doesNotMatch(
    component + client,
    /Mizan|mizan|\/api\/check\/search|data-check-results|data-check-profile|safeSourceUrl|innerHTML|steamProfile/,
  );
  assert.equal((component.match(/<button\b/g) || []).length, 1);
  assert.doesNotMatch(client, /createElement\("button"\)|method: "POST"/);
  assert.match(client, /fetch\("\/api\/check\/players"/);
});
