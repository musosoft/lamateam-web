import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("compact player accordions trigger manual checks without a separate result panel", () => {
  const component = readFileSync(
    new URL("../../components/PlayerReview.astro", import.meta.url),
    "utf8",
  );
  const client = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
  assert.match(component, />\s*Check recent players\s*<\/h2>/);
  assert.doesNotMatch(
    component + client,
    /data-check-results|data-check-profile|innerHTML|steamProfile/,
  );
  assert.equal((component.match(/<button\b/g) || []).length, 1);
  assert.doesNotMatch(client, /createElement\("button"\)/);
  assert.match(client, /createElement\(["']details["']\)/);
  assert.match(client, /createElement\(["']summary["']\)/);
  assert.match(client, /if \(details.open\)/);
  assert.match(client, /\/api\/check\/search/);
  assert.match(client, /fetch\("\/api\/check\/players"/);
});
