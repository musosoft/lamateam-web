import assert from "node:assert/strict";
import test from "node:test";
import { handleTranslationRequest, TARGET_LANGUAGES } from "./deepl.ts";

const security = { rateLimiter: { limit: async () => ({ success: true }) } };
function request(targetLang, origin = "https://lamateam.eu") {
  return new Request("https://lamateam.eu/api/translate", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.1",
    },
    body: JSON.stringify({ targetLang, texts: ["Connect to LaMaTeAm"] }),
  });
}
test("all seven documented DeepL codes reach the provider unchanged", async () => {
  assert.deepEqual(
    [...TARGET_LANGUAGES],
    ["CS", "SK", "PL", "HU", "DE", "UK", "FR"],
  );
  for (const code of TARGET_LANGUAGES) {
    const response = await handleTranslationRequest(
      request(code),
      "test-key:fx",
      security,
      async (url, init) => {
        assert.equal(url, "https://api-free.deepl.com/v2/translate");
        assert.equal(JSON.parse(init.body).target_lang, code);
        assert.equal(init.headers.Authorization, "DeepL-Auth-Key test-key:fx");
        assert.equal(init.redirect, "manual");
        assert.ok(!init.body.includes("test-key"));
        return Response.json({ translations: [{ text: "Translated" }] });
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { translations: ["Translated"] });
  }
});
test("unsupported aliases, cross-origin requests and rate-limit failures never reach DeepL", async () => {
  const never = async () => {
    assert.fail("provider must not be called");
  };
  for (const code of ["CZ", "UA", "EN", "cs"]) {
    assert.equal(
      (await handleTranslationRequest(request(code), "test", security, never))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await handleTranslationRequest(
        request("CS", "https://other.example"),
        "test",
        security,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleTranslationRequest(
        request("CS"),
        "test",
        { rateLimiter: undefined },
        never,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await handleTranslationRequest(
        request("CS"),
        "test",
        { rateLimiter: { limit: async () => ({ success: false }) } },
        never,
      )
    ).status,
    429,
  );
});
test("invalid provider output remains fail-safe", async () => {
  const response = await handleTranslationRequest(
    request("UK"),
    "test",
    security,
    async () => Response.json({ translations: [] }),
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("runtime missing secrets, malformed bodies, bounds and redirect failures never disclose credentials", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ translations: [{ text: "OK" }] });
  };
  for (const key of [undefined, null, "", "   "]) {
    const response = await handleTranslationRequest(
      request("DE"),
      key,
      security,
      fetcher,
    );
    assert.equal(response.status, 503);
  }
  const bodyRequest = (body, type = "application/json") =>
    new Request("https://lamateam.eu/api/translate", {
      method: "POST",
      headers: {
        origin: "https://lamateam.eu",
        "content-type": type,
        "cf-connecting-ip": "192.0.2.1",
      },
      body,
    });
  for (const [body, status] of [
    ["not JSON", 400],
    [JSON.stringify({ targetLang: "DE", texts: [] }), 400],
    [JSON.stringify({ targetLang: "DE", texts: [" "] }), 400],
    [JSON.stringify({ targetLang: "DE", texts: Array(51).fill("Text") }), 400],
    [JSON.stringify({ targetLang: "DE", texts: ["x".repeat(10_001)] }), 413],
    ["x".repeat(65_537), 413],
  ])
    assert.equal(
      (
        await handleTranslationRequest(
          bodyRequest(body),
          "synthetic-test-secret",
          security,
          fetcher,
        )
      ).status,
      status,
    );
  assert.equal(
    (
      await handleTranslationRequest(
        bodyRequest("{}", "text/plain"),
        "synthetic-test-secret",
        security,
        fetcher,
      )
    ).status,
    415,
  );
  assert.equal(calls, 0);
  for (const upstreamStatus of [301, 302, 307, 308, 403, 429, 456, 500]) {
    let init;
    const response = await handleTranslationRequest(
      request("DE"),
      "synthetic-test-secret",
      security,
      async (_url, options) => {
        init = options;
        return new Response("synthetic-test-secret private-provider-body", {
          status: upstreamStatus,
          headers: { Location: "https://untrusted.example" },
        });
      },
    );
    assert.equal(init.redirect, "manual");
    assert.equal(response.status, 502);
    assert.doesNotMatch(
      await response.text(),
      /synthetic-test-secret|private-provider-body/,
    );
  }
});

test("DeepL Pro uses header auth and invalid or empty translations fail closed", async () => {
  let endpoint;
  for (const translations of [
    [{ text: "" }],
    [{ text: " " }],
    [{ text: 42 }],
    [{}],
    null,
  ]) {
    const response = await handleTranslationRequest(
      request("FR"),
      "synthetic-pro-key",
      security,
      async (url) => {
        endpoint = url;
        return Response.json({ translations });
      },
    );
    assert.equal(response.status, 502);
  }
  assert.equal(endpoint, "https://api.deepl.com/v2/translate");
});

test("same-origin, trusted ingress and limiter errors fail closed before provider calls", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ translations: [{ text: "OK" }] });
  };
  for (const origin of [
    null,
    "null",
    "https://lamateam.eu.evil.example",
    "http://lamateam.eu",
  ]) {
    const req = request("CS");
    if (origin === null) req.headers.delete("origin");
    else req.headers.set("origin", origin);
    assert.equal(
      (
        await handleTranslationRequest(
          req,
          "synthetic-test-key",
          security,
          fetcher,
        )
      ).status,
      403,
    );
  }
  const req = request("CS");
  req.headers.delete("cf-connecting-ip");
  req.headers.set("x-forwarded-for", "192.0.2.1");
  assert.equal(
    (
      await handleTranslationRequest(
        req,
        "synthetic-test-key",
        security,
        fetcher,
      )
    ).status,
    503,
  );
  const response = await handleTranslationRequest(
    request("CS"),
    "synthetic-test-key",
    {
      rateLimiter: {
        limit: async () => {
          throw new Error("limiter unavailable");
        },
      },
    },
    fetcher,
  );
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("requests at the existing 50-string/10000-character bounds remain supported", async () => {
  const req = request("SK");
  const bounded = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      targetLang: "SK",
      texts: Array(50).fill("x".repeat(200)),
    }),
  });
  const response = await handleTranslationRequest(
    bounded,
    "synthetic-test-key",
    security,
    async (_url, init) => {
      const { text } = JSON.parse(init.body);
      return Response.json({
        translations: text.map(() => ({ text: "Translated" })),
      });
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).translations.length, 50);
});
