import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// No credentials, production mutations, redirects, or response bodies in logs.
const production = process.argv.includes("--production");
const port = 8789;
const base = production ? "https://lamateam.eu" : `http://127.0.0.1:${port}`;
let worker;
async function probe(path, expected, locale) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "Cache-Control": "no-cache" },
  });
  assert.equal(
    response.status,
    expected,
    `${path}: expected ${expected}, got ${response.status}`,
  );
  const html = await response.text();
  if (expected === 200) {
    assert.match(
      response.headers.get("content-type") || "",
      /text\/html/,
      path,
    );
    assert.match(html, /<\/body>\s*<\/html>/, path);
    assert.match(html, /id="community-nav"/, path);
    if (locale)
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`), path);
  }
}
try {
  if (!production) {
    worker = spawn(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "dev",
        "--local",
        "--config",
        "dist/server/wrangler.json",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        "0",
        "--var",
        "STEAM_API_KEY:stable-render-offline-test-key",
      ],
      { stdio: "ignore" },
    );
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (worker.exitCode !== null)
        throw new Error("Local Worker exited before readiness");
      try {
        await probe("/rules", 200, "en");
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    assert.ok(ready, "Local Worker did not become ready");
  }
  for (let attempt = 1; attempt <= (production ? 6 : 1); attempt++) {
    try {
      // Repeat to exercise warm isolates, not just one successful cold request.
      for (let repeat = 0; repeat < 3; repeat++) {
        await probe("/", 200, "en");
        await probe("/rules", 200, "en");
      }
      if (!production) {
        await probe("/de/", 200, "de");
        await probe("/en/", 404);
      }
      console.log(
        `${production ? "Production" : "Local Worker"} SSR smoke passed`,
      );
      break;
    } catch (error) {
      if (!production || attempt === 6) throw error;
      console.log(`Production SSR smoke attempt ${attempt}/6 failed; retrying`);
      await delay(10_000);
    }
  }
  if (!production) {
    const regressions = spawn(
      process.execPath,
      [
        "--test",
        "tests/shell-rendering.test.mjs",
        "tests/stable-first-render.test.mjs",
        "src/lib/localization-ssr.test.mjs",
        "src/lib/motd-locale.test.mjs",
      ],
      {
        stdio: "inherit",
        env: { ...process.env, SSR_BASE_URL: base, STABLE_RENDER_URL: base },
      },
    );
    const status = await new Promise((resolve, reject) => {
      regressions.once("error", reject);
      regressions.once("exit", resolve);
    });
    assert.equal(status, 0, "Worker rendering regressions failed");
  }
} finally {
  if (worker && worker.exitCode === null) {
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    const timer = setTimeout(() => worker.kill("SIGKILL"), 5_000);
    await stopped;
    clearTimeout(timer);
  }
}
