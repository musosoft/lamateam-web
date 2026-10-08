import assert from "node:assert/strict";
import test from "node:test";
import {
  createSourceTVLoader,
  parseSourceTVFiles,
  SOURCETV_URL,
  SOURCETV_MAX_BYTES,
  SOURCETV_TIMEOUT_MS,
} from "./sourcetv.ts";

const files = ["demos/match 01.dem", "match&02.dem"];
const json = (data = files) => new Response(JSON.stringify(data));
const noCache = () => undefined;
function memoryCache() {
  const entries = new Map();
  return {
    async match(key) {
      return entries.get(key.url)?.clone();
    },
    async put(key, value) {
      assert.equal(key.url, "https://lamateam.eu/_internal/sourcetv-list-v1");
      assert.equal(value.headers.get("Content-Type"), "application/json");
      assert.match(value.headers.get("Cache-Control"), /^public, max-age=\d+$/);
      entries.set(key.url, value.clone());
    },
  };
}

test("string-array contract preserves filenames, accepts empty, rejects malformed data", () => {
  assert.deepEqual(parseSourceTVFiles(files), files);
  assert.deepEqual(parseSourceTVFiles([]), []);
  for (const data of [
    null,
    {},
    "a.dem",
    [null],
    [1],
    [""],
    [" "],
    ["a\n.dem"],
    ["x".repeat(1025)],
    Array(5001).fill("a"),
  ])
    assert.throws(() => parseSourceTVFiles(data));
});

test("exact fixed fetch contract; memory and Worker Cache hits bypass upstream", async () => {
  const store = memoryCache();
  let calls = 0;
  const options = {
    cache: () => store,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, SOURCETV_URL);
      assert.equal(
        url,
        "https://wild-fire-819b.still-fog-235d.workers.dev/list",
      );
      assert.deepEqual(Object.keys(init).sort(), [
        "headers",
        "method",
        "redirect",
        "signal",
      ]);
      assert.equal(init.method, "GET");
      assert.deepEqual(init.headers, { Accept: "application/json" });
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal instanceof AbortSignal);
      return json();
    },
  };
  const load = createSourceTVLoader(options);
  const expected = { files, stale: false, error: false };
  assert.deepEqual(await load(), expected);
  assert.deepEqual(await load(), expected);
  assert.deepEqual(await createSourceTVLoader(options)(), expected);
  assert.equal(calls, 1);
});

test("simultaneous cold requests coalesce into one fetch", async () => {
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const load = createSourceTVLoader({
    cache: noCache,
    fetch: () => {
      calls++;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const first = load();
  const others = [load(), load(), load()];
  await ready;
  release(json());
  assert.deepEqual(
    await Promise.all([first, ...others]),
    Array(4).fill({ files, stale: false, error: false }),
  );
  assert.equal(calls, 1);
});

test("stale fallback, persisted failure backoff, recovery and hard one-hour expiry", async () => {
  const store = memoryCache();
  let time = 1_000_000;
  let fail = false;
  let calls = 0;
  const options = {
    cache: () => store,
    now: () => time,
    fetch: async () => {
      calls++;
      if (fail) throw new Error("offline");
      return json();
    },
  };
  const load = createSourceTVLoader(options);
  await load();
  time += 5 * 60_000;
  fail = true;
  assert.deepEqual(await load(), { files, stale: true, error: true });
  assert.deepEqual(await createSourceTVLoader(options)(), {
    files,
    stale: true,
    error: true,
  });
  assert.equal(calls, 2);
  time += 30_000;
  fail = false;
  assert.deepEqual(await load(), { files, stale: false, error: false });
  assert.equal(calls, 3);
  time += 60 * 60_000;
  fail = true;
  assert.deepEqual(await load(), { files: [], stale: false, error: true });
  assert.deepEqual(await createSourceTVLoader(options)(), {
    files: [],
    stale: false,
    error: true,
  });
  assert.equal(calls, 4);
});

test("empty lists are cached successfully, not treated as an outage", async () => {
  let calls = 0;
  const load = createSourceTVLoader({
    cache: noCache,
    fetch: async () => {
      calls++;
      return json([]);
    },
  });
  assert.deepEqual(await load(), { files: [], stale: false, error: false });
  await load();
  assert.equal(calls, 1);
});

test("cold failures are cached briefly; corrupt/unavailable cache is fail safe", async () => {
  for (const cache of [
    noCache,
    () => ({
      match: async () => {
        throw Error();
      },
      put: async () => {
        throw Error();
      },
    }),
    () => ({
      match: async () =>
        json({ files: [42], fetchedAt: Date.now(), retryAt: 0 }),
      put: async () => {},
    }),
  ]) {
    let calls = 0;
    const load = createSourceTVLoader({
      cache,
      fetch: async () => {
        calls++;
        throw Error();
      },
    });
    assert.deepEqual(await load(), { files: [], stale: false, error: true });
    await load();
    assert.equal(calls, 1);
  }
});

test("timeout bounds fetch even if it ignores abort; background budget is 8000ms", async () => {
  assert.equal(SOURCETV_TIMEOUT_MS, 8000);
  let signal;
  const load = createSourceTVLoader({
    cache: noCache,
    timeoutMs: 20,
    fetch: (_, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  const start = performance.now();
  assert.deepEqual(await load(), { files: [], stale: false, error: true });
  assert.ok(performance.now() - start < 500);
  assert.equal(signal.aborted, true);
});

test("timeout covers stalled body reading and cancels the stream", async () => {
  let cancelled = false;
  const load = createSourceTVLoader({
    cache: noCache,
    timeoutMs: 20,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  assert.deepEqual(await load(), { files: [], stale: false, error: true });
  assert.equal(cancelled, true);
});

test("cold background response is fast; runtime awaits refresh including cache write", async () => {
  const store = memoryCache();
  let release;
  let calls = 0;
  const scheduled = [];
  const context = {
    waitUntil(work) {
      scheduled.push(work);
    },
  };
  const options = {
    cache: () => store,
    fetch: () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const load = createSourceTVLoader(options);
  const start = performance.now();
  const results = await Promise.all([
    load(context),
    load(context),
    load(context),
  ]);
  assert.ok(performance.now() - start < 100);
  for (const result of results)
    assert.deepEqual(result, {
      files: [],
      stale: false,
      error: false,
      refreshing: true,
    });
  assert.equal(calls, 1);
  assert.equal(scheduled.length, 3);
  assert.equal(scheduled[0], scheduled[1]);
  release(json());
  await Promise.all(scheduled);
  assert.deepEqual(await load(context), { files, stale: false, error: false });
  assert.deepEqual(await createSourceTVLoader(options)(context), {
    files,
    stale: false,
    error: false,
  });
  assert.equal(calls, 1);
});

test("stale response returns immediately; failed background refresh backs off and never extends data age", async () => {
  let time = 1_000_000;
  let release;
  let calls = 0;
  const load = createSourceTVLoader({
    cache: noCache,
    now: () => time,
    fetch: async () => {
      calls++;
      if (calls === 1) return json();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await load();
  time += 5 * 60_000;
  let work;
  const context = {
    waitUntil(promise) {
      work = promise;
    },
  };
  const start = performance.now();
  assert.deepEqual(await load(context), {
    files,
    stale: true,
    error: false,
    refreshing: true,
  });
  assert.ok(performance.now() - start < 100);
  release(new Response("bad", { status: 503 }));
  await work;
  assert.deepEqual(await load(context), { files, stale: true, error: true });
  assert.equal(calls, 2);
  time += 55 * 60_000;
  assert.deepEqual(await load(context), {
    files: [],
    stale: false,
    error: false,
    refreshing: true,
  });
  release(new Response("bad", { status: 503 }));
  await work;
  assert.deepEqual(await load(context), {
    files: [],
    stale: false,
    error: true,
  });
});

test("background tasks time out, abort, settle, and respect failure backoff", async () => {
  let signal;
  let work;
  let calls = 0;
  const context = {
    waitUntil(promise) {
      work = promise;
    },
  };
  const load = createSourceTVLoader({
    cache: noCache,
    timeoutMs: 20,
    fetch: (_, init) => {
      calls++;
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  assert.equal((await load(context)).refreshing, true);
  await work;
  assert.equal(signal.aborted, true);
  assert.deepEqual(await load(context), {
    files: [],
    stale: false,
    error: true,
  });
  assert.equal(calls, 1);
});

test("cache stalls cannot make response or background refresh unbounded", async () => {
  const store = {
    match: () => new Promise(() => {}),
    put: () => new Promise(() => {}),
  };
  let release;
  let work;
  const load = createSourceTVLoader({
    cache: () => store,
    fetch: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const start = performance.now();
  assert.equal(
    (
      await load({
        waitUntil(promise) {
          work = promise;
        },
      })
    ).refreshing,
    true,
  );
  assert.ok(performance.now() - start < 300);
  release(json());
  await work;
  assert.ok(performance.now() - start < 500);
  assert.deepEqual(await load(), { files, stale: false, error: false });
});

test("absent or throwing execution context awaits bounded refresh instead of detaching work", async () => {
  for (const context of [
    undefined,
    {
      waitUntil() {
        throw new Error("unsupported");
      },
    },
  ]) {
    let release;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const load = createSourceTVLoader({
      cache: noCache,
      timeoutMs: 100,
      fetch: () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    let returned = false;
    const response = load(context).then((result) => {
      returned = true;
      return result;
    });
    await ready;
    assert.equal(returned, false);
    release(json());
    assert.deepEqual(await response, { files, stale: false, error: false });
  }
});

test("manual redirects are rejected even with a valid demo list body", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const load = createSourceTVLoader({
      cache: noCache,
      fetch: async (url, init) => {
        calls++;
        assert.equal(url, SOURCETV_URL);
        assert.equal(init.redirect, "manual");
        return new Response(JSON.stringify(files), {
          status,
          headers: { Location: "https://elsewhere.invalid/" },
        });
      },
    });
    assert.deepEqual(await load(), { files: [], stale: false, error: true });
    await load();
    assert.equal(calls, 1);
  }
});

test("rejects HTTP errors, malformed JSON/contracts, declared and streamed oversized bodies", async () => {
  let cancelled = false;
  const responses = [
    () => new Response("offline", { status: 503 }),
    () => new Response("{"),
    () => json({ files }),
    () => json(["good.dem", 42]),
    () =>
      new Response("[]", {
        headers: { "Content-Length": String(SOURCETV_MAX_BYTES + 1) },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(SOURCETV_MAX_BYTES));
            controller.enqueue(new Uint8Array(1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  ];
  for (const response of responses) {
    const load = createSourceTVLoader({
      cache: noCache,
      fetch: async () => response(),
    });
    assert.deepEqual(await load(), { files: [], stale: false, error: true });
  }
  assert.equal(cancelled, true);
});
