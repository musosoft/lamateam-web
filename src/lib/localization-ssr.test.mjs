import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import {
  routeManifest,
  allLocales,
  untranslatedPublicRoutes,
  locales,
  pageKinds,
  localePath,
  equivalentPage,
} from "./localized-content.ts";
import { pageCopy } from "./page-copy.ts";
import { routeSeo } from "./locale-seo.ts";

const base = process.env.SSR_BASE_URL;
function inspect(html) {
  const copy = [];
  const nodes = [];
  function walk(node, excluded = false) {
    if (node.tagName) {
      nodes.push(node);
      excluded ||=
        ["script", "style", "svg", "code", "pre", "kbd", "noscript"].includes(
          node.tagName,
        ) ||
        node.attrs.some((a) => a.name === "translate" && a.value === "no") ||
        node.attrs.some((a) => a.name === "data-no-translate");
      if (!excluded)
        for (const attr of node.attrs)
          if (["aria-label", "title", "placeholder", "alt"].includes(attr.name))
            copy.push(attr.value);
    }
    if (node.nodeName === "#text" && !excluded)
      copy.push(node.value.replace(/\s+/g, " ").trim());
    for (const child of node.childNodes || []) walk(child, excluded);
  }
  walk(parse(html));
  return {
    nodes,
    copy: new Set(copy),
    attr: (node, name) => node.attrs.find((a) => a.name === name)?.value,
  };
}

test(
  "all manifest pages render translated static copy and reciprocal SEO without browser translation",
  { skip: !base, timeout: 180_000 },
  async () => {
    // Bound concurrency: SourceTV may consult an upstream service on first load.
    for (const locale of allLocales) {
      await Promise.all(
        routeManifest
          .filter((r) => r.locale === locale)
          .map(async ({ path, page }) => {
            const response = await fetch(new URL(path, base));
            assert.equal(response.status, 200, path);
            const html = await response.text();
            assert.match(
              html,
              /<\/body>\s*<\/html>/,
              `${path}: incomplete streamed response`,
            );
            const { nodes, copy, attr } = inspect(html);
            assert.equal(
              attr(
                nodes.find((n) => n.tagName === "html"),
                "lang",
              ),
              locale,
              path,
            );
            const seo = routeSeo(path);
            const canonical = nodes.find(
              (n) => n.tagName === "link" && attr(n, "rel") === "canonical",
            );
            assert.equal(attr(canonical, "href"), seo.canonical, path);
            const alternates = nodes.filter(
              (n) => n.tagName === "link" && attr(n, "rel") === "alternate",
            );
            assert.equal(alternates.length, 9, path);
            for (const { locale: language, url } of seo.alternates)
              assert.ok(
                alternates.some(
                  (n) =>
                    attr(n, "hreflang") === language && attr(n, "href") === url,
                ),
                path,
              );
            assert.ok(
              alternates.some(
                (n) =>
                  attr(n, "hreflang") === "x-default" &&
                  attr(n, "href") === seo.xDefault,
              ),
              path,
            );
            assert.ok(
              nodes.some((n) => n.tagName === "h1"),
              path,
            );
            assert.match(html, /data-session-render="request"/, path);
            assert.doesNotMatch(
              html,
              /api\/translate|data-translation-status/,
              path,
            );
            for (const node of nodes.filter((n) => n.tagName === "a")) {
              const href = attr(node, "href");
              if (!href?.startsWith("/") || href.startsWith("//")) continue;
              const target = new URL(href, "https://lamateam.eu");
              const linkedPage = equivalentPage(target.pathname);
              if (linkedPage && !attr(node, "hreflang"))
                assert.equal(
                  target.pathname,
                  localePath(locale, linkedPage),
                  `${path}: stale internal link ${href}`,
                );
            }
            if (locale !== "en")
              for (const key of Object.keys(pageCopy.en)) {
                if (key.length > 12 && pageCopy[locale][key] !== key)
                  assert.ok(
                    !copy.has(key),
                    `${path}: English copy remains: ${key}`,
                  );
              }
            if (page === "home") {
              assert.ok(
                nodes.some((n) => attr(n, "id") === "server-player-count"),
                path,
              );
              assert.ok(
                nodes.some(
                  (n) =>
                    n.tagName === "iframe" &&
                    attr(n, "src")?.includes("borderColor=121c25"),
                ),
                path,
              );
            }
          }),
      );
    }
  },
);

test(
  "invalid locale and untranslated dashboard equivalents are real 404s",
  { skip: !base },
  async () => {
    for (const path of [
      "/xx/",
      "/cs/unknown/",
      "/cs/regles/",
      "/cs/home/",
      "/cs/mapy/extra/",
      ...untranslatedPublicRoutes.map((p) => `/cs${p}/`),
    ]) {
      const response = await fetch(new URL(path, base));
      assert.equal(response.status, 404, path);
    }
  },
);

test(
  "every old localized English URL redirects permanently to its canonical translated page with the query intact",
  { skip: !base, timeout: 180_000 },
  async () => {
    for (const locale of locales) {
      await Promise.all(
        pageKinds
          .filter((page) => page !== "home")
          .map(async (page) => {
            for (const trailing of ["", "/"]) {
              const response = await fetch(
                new URL(
                  `/${locale}/${page}${trailing}?view=full&next=%2Fmaps`,
                  base,
                ),
                { redirect: "manual" },
              );
              assert.equal(
                response.status,
                308,
                `${locale}/${page}${trailing}`,
              );
              const target = new URL(response.headers.get("location"), base);
              assert.equal(target.pathname, localePath(locale, page));
              assert.equal(target.search, "?view=full&next=%2Fmaps");
            }
          }),
      );
    }
  },
);
