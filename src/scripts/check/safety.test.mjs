import test from "node:test";
import assert from "node:assert/strict";
import { googleSearchUrl, safeSourceUrl } from "./safety.mjs";

test("public search uses a fixed Google origin and all three Steam identifiers", () => {
  const url = new URL(googleSearchUrl("76561197960265731"));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/search");
  assert.equal(
    url.searchParams.get("q"),
    '"76561197960265731" OR "STEAM_0:1:1" OR "[U:1:3]"',
  );
});

test("untrusted query values cannot change the search destination", () => {
  for (const input of [
    "https://evil.example/?q=x&redirect=y",
    '"><script>alert(1)</script>',
    null,
    "76561190000000000",
  ]) {
    assert.equal(
      new URL(googleSearchUrl(input)).origin,
      "https://www.google.com",
    );
  }
});

test("source links accept only absolute HTTP(S) URLs without credentials", () => {
  assert.equal(
    safeSourceUrl("https://example.com/a?q=steam"),
    "https://example.com/a?q=steam",
  );
  for (const input of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.example",
    "/relative",
    "https://user:secret@example.com",
    null,
  ]) {
    assert.equal(safeSourceUrl(input), null);
  }
});
