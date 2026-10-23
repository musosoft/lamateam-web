import assert from "node:assert/strict";
import test from "node:test";
import { handleDonationProxy } from "./donations-proxy.ts";
import { ALL as denyStandalone } from "../pages/donations/[...path].ts";

const secret = "offline-test-only-".padEnd(48, "x");
const env = {
  DONATIONS_BACKEND_ORIGIN: "https://payments-origin.example.net",
  DONATIONS_PROXY_SECRET: secret,
  DONATIONS_CHECKOUT_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const never = async () => assert.fail("must not contact upstream");
test("standalone donations surface is denied regardless of path or method", async () => {
  for (const path of [
    "",
    "/",
    "/index.php",
    "/donate.php",
    "/scripts/ipn.php",
  ]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = denyStandalone({
        request: new Request(`https://lamateam.eu/donations${path}`, {
          method,
        }),
      });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});
function request({
  path = "checkout",
  method = "POST",
  body = "offer=1&steamid_user=STEAM_0%3A1%3A123",
  headers = {},
} = {}) {
  return new Request(`https://lamateam.eu/api/donations/${path}`, {
    method,
    headers: {
      origin: "https://lamateam.eu",
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "192.0.2.1",
      ...headers,
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
}
function payload() {
  return {
    action: "https://www.paypal.com/cgi-bin/webscr",
    offerName: "Reserve - 1 month",
    amount: "100.00",
    steamId: "STEAM_0:1:123",
    estimatedExpiry: "2026-11-22T12:00:00+01:00",
    fields: {
      cmd: "_xclick",
      business: "merchant@example.net",
      amount: "100.00",
      currency_code: "CZK",
      item_name: "Reserve - 1 month",
      item_number: "reserve-1",
      custom: "STEAM_0:1:123|1|offer:1",
      no_note: "1",
      no_shipping: "1",
      rm: "2",
      return: "https://lamateam.eu/vip",
      notify_url: "https://lamateam.eu/api/donations/ipn",
      cancel_return: "https://lamateam.eu/vip",
    },
  };
}
test("fixed allowlist, method, type, origin, shape and byte limits reject before upstream", async () => {
  const cases = [
    [{ path: "anything" }, 404],
    [{ path: "checkout?url=https://evil.example" }, 400],
    [{ method: "GET" }, 405],
    [{ method: "PUT" }, 405],
    [{ headers: { "content-type": "application/json" } }, 415],
    [{ headers: { origin: "https://evil.example" } }, 403],
    [{ headers: { origin: "" } }, 403],
    [{ headers: { "sec-fetch-site": "cross-site" } }, 403],
    [{ body: "offer=3&steamid_user=x" }, 400],
    [{ body: "offer=1&steamid_user=x&amount=1" }, 400],
    [{ body: "offer=1&offer=6&steamid_user=x" }, 400],
    [{ body: "offer=1&steamid_user=" }, 400],
    [{ body: "offer=1&steamid_user=%00bad" }, 400],
    [{ body: "x".repeat(2049) }, 413],
    [{ headers: { "content-length": "2049" } }, 413],
    [{ path: "ipn", body: "x".repeat(65537) }, 413],
    [{ path: "ipn", headers: { "content-type": "multipart/form-data" } }, 415],
  ];
  for (const [input, status] of cases)
    assert.equal(
      (await handleDonationProxy(request(input), env, never)).status,
      status,
      JSON.stringify(input).slice(0, 100),
    );
});
test("trusted IP checkout limiter fails closed, never applies to IPN", async () => {
  let key;
  const denied = {
    ...env,
    DONATIONS_CHECKOUT_RATE_LIMITER: {
      limit: async (input) => {
        key = input.key;
        return { success: false };
      },
    },
  };
  assert.equal(
    (
      await handleDonationProxy(
        request({
          headers: {
            "x-forwarded-for": "evil",
            "cf-connecting-ip": "2001:db8::1",
          },
        }),
        denied,
        never,
      )
    ).status,
    429,
  );
  assert.equal(key, "checkout:2001:db8::1");
  for (const overrides of [
    { DONATIONS_CHECKOUT_RATE_LIMITER: undefined },
    {
      DONATIONS_CHECKOUT_RATE_LIMITER: {
        limit: async () => {
          throw Error("down");
        },
      },
    },
    { DONATIONS_PROXY_SECRET: undefined },
    { DONATIONS_PROXY_SECRET: "short" },
    ...[
      "https://lamateam.eu",
      "http://example.net",
      "https://user@example.net",
      "https://example.net/path",
      "https://example.net?x=1",
      "https://127.0.0.1",
    ].map((DONATIONS_BACKEND_ORIGIN) => ({ DONATIONS_BACKEND_ORIGIN })),
  ]) {
    assert.equal(
      (await handleDonationProxy(request(), { ...env, ...overrides }, never))
        .status,
      503,
    );
  }
  assert.equal(
    (
      await handleDonationProxy(
        request({ headers: { "cf-connecting-ip": "" } }),
        env,
        never,
      )
    ).status,
    503,
  );
  const result = await handleDonationProxy(
    request({ path: "ipn", headers: { origin: "", "cf-connecting-ip": "" } }),
    denied,
    async () =>
      new Response("ack", { headers: { "content-type": "text/plain" } }),
  );
  assert.equal(result.status, 200);
});
test("checkout uses only fixed upstream + explicit headers; response projected and cookies stripped", async () => {
  const data = payload();
  const result = await handleDonationProxy(
    request({
      headers: {
        cookie: "session=sensitive",
        authorization: "bad",
        "x-donations-proxy-secret": "attacker",
        "x-forwarded-host": "evil",
        "x-forwarded-for": "evil",
      },
    }),
    env,
    async (url, init) => {
      assert.equal(
        url,
        "https://payments-origin.example.net/donations/checkout.php",
      );
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(init.headers, {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-Donations-Proxy-Secret": secret,
      });
      return Response.json(
        { ...data, backend: "must not escape" },
        { headers: { "set-cookie": "bad=1" } },
      );
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), data);
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("IPN forwards exact bytes and type to only fixed IPN path; strips diagnostic body and headers, preserves status", async () => {
  const raw =
    "txn_id=a%2Bb&custom=STEAM_0%3A1%3A123%7C1%7Coffer%3A1&x=%FF&x=+%20";
  for (const status of [200, 400, 403, 500, 503]) {
    const response = await handleDonationProxy(
      request({
        path: "ipn",
        body: raw,
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      }),
      env,
      async (url, init) => {
        assert.equal(
          url,
          "https://payments-origin.example.net/donations/scripts/ipn.php",
        );
        assert.equal(new TextDecoder().decode(init.body), raw);
        assert.equal(
          init.headers["Content-Type"],
          "application/x-www-form-urlencoded; charset=UTF-8",
        );
        return new Response("private backend diagnostics", {
          status,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "set-cookie": "bad=1",
          },
        });
      },
    );
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("set-cookie"), null);
  }
});
test("upstream redirects, unexpected types/status, overflows, malformed or unsafe fields and failures are safely fenced", async () => {
  const bad = [];
  for (const mutate of [
    (d) => {
      d.action = "https://evil.example";
    },
    (d) => {
      d.amount = "1.00";
    },
    (d) => {
      d.fields.notify_url = "https://backend.example/ipn";
    },
    (d) => {
      d.fields.extra = "bad";
    },
    (d) => {
      d.fields.return = "https://evil.example";
    },
    (d) => {
      d.fields.custom = "STEAM_0:1:999|1|offer:1";
    },
    (d) => {
      d.fields.amount = "300.00";
    },
  ]) {
    const d = payload();
    mutate(d);
    bad.push(() => Response.json(d));
  }
  bad.push(
    () => Response.redirect("https://evil.example", 302),
    () =>
      new Response("<html>secret</html>", {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("bad", { headers: { "content-type": "application/json" } }),
    () =>
      new Response("x".repeat(16385), {
        headers: { "content-type": "application/json" },
      }),
    () => {
      throw new Error("private backend address");
    },
    () => {
      throw new DOMException("timeout", "AbortError");
    },
    () =>
      new Response("private", {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  );
  for (const factory of bad) {
    const response = await handleDonationProxy(request(), env, async () =>
      factory(),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Checkout unavailable" });
  }
  assert.equal(
    (
      await handleDonationProxy(request(), env, async () =>
        Response.json({ error: "private" }, { status: 503 }),
      )
    ).status,
    503,
  );
});
test("10-second upstream deadline aborts the fetch and gives a safe retryable failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let signal;
  const pending = handleDonationProxy(request(), env, async (_url, init) => {
    signal = init.signal;
    enter();
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("private timeout", "AbortError")),
        { once: true },
      );
    });
  });
  await entered;
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Checkout unavailable" });
});
