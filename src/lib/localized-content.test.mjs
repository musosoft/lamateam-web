import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  content,
  locales,
  localePath,
  equivalentPage,
  siteUrl,
  pageKinds,
  routeManifest,
  untranslatedPublicRoutes,
  allLocales,
  localizedSlugs,
  pageFromSlug,
  legacyLocaleRedirect,
} from "./localized-content.ts";
import { GET as sitemap } from "../pages/sitemap.xml.ts";
import { GET as robots } from "../pages/robots.txt.ts";

test("seven complete natural-copy dictionaries and only real equivalent routes", () => {
  assert.equal(locales.length, 7);
  for (const locale of locales) {
    for (const value of Object.values(content[locale]))
      assert.ok(value.trim().length > 0);
    assert.match(content[locale].languageRule, /CZ\/SK\/EN/);
    assert.match(content[locale].requirements, /Counter-Strike: Source/);
    for (const kind of pageKinds)
      assert.equal(equivalentPage(localePath(locale, kind)), kind);
  }
  for (const path of [
    "/stats",
    "/cs/stats",
    "/home",
    "/cs/home/",
    "/xx/",
    "/de/connect/extra",
  ])
    assert.equal(equivalentPage(path), undefined);
  assert.equal(equivalentPage("/connect/"), "connect");
  assert.equal(siteUrl(), "https://lamateam.eu");
  assert.equal(
    new URL("/cs/", siteUrl("https://example.com/")).href,
    "https://example.com/cs/",
  );
});
test("sitemap and robots agree on origin, exclude APIs and untranslated locale dashboards", async () => {
  const xml = await (await sitemap({})).text();
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(locs).size, locs.length);
  assert.equal(
    locs.length,
    routeManifest.length + untranslatedPublicRoutes.length,
  );
  for (const locale of locales)
    for (const kind of pageKinds)
      assert.ok(
        locs.includes(new URL(localePath(locale, kind), siteUrl()).href),
      );
  assert.ok(
    locs.every(
      (loc) =>
        !loc.includes("/api/") && !/\/(cs|sk|pl|hu|de|uk|fr)\/stats/.test(loc),
    ),
  );
  assert.match(
    await (await robots({})).text(),
    /Sitemap: https:\/\/lamateam.eu\/sitemap.xml/,
  );
});
test("static pages, route-scoped metadata and privacy-safe selector remain wired", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const page of ["index"]) {
    const source = read(`../pages/[locale]/${page}.astro`);
    assert.match(source, /prerender = false/);
    assert.match(
      source,
      /import (Home|Connect) from '\.\.\/(index|connect)\.astro'/,
    );
    assert.match(source, /isLocale\(/);
  }
  const connect = read("../pages/[locale]/connect.astro");
  assert.match(connect, /isLocale\(locale\)/);
  assert.match(connect, /legacyLocaleRedirect\(Astro.url\)/);
  assert.match(connect, /Astro.redirect\(redirect, 308\)/);
  const route = read("../pages/[locale]/[page].astro");
  assert.match(route, /pageFromSlug\(locale, slug\)/);
  assert.match(route, /legacyLocaleRedirect\(Astro.url\)/);
  assert.match(route, /Astro.redirect\(redirect, 308\)/);
  assert.match(route, /import Connect from '\.\.\/connect.astro'/);
  const layout = read("../layouts/Layout.astro");
  assert.match(layout, /equivalentPage\(currentPath\)/);
  assert.match(layout, /hreflang="x-default"/);
  assert.match(layout, /BreadcrumbList/);
  assert.doesNotMatch(layout, /'@type': 'Organization'/);
  const selector = read("../components/LanguageSelector.astro");
  assert.match(selector, /if \(pageLanguage !== 'EN'\) return/);
  assert.match(selector, /data-no-translate/);
  assert.match(selector, /#shoutboxMessages/);
  assert.match(selector, /request !== generation/);
});

test("translated slug contract is complete, URL-safe, unique and does not shadow aliases or reserved routes", () => {
  const reserved = new Set([
    "api",
    "stats",
    "bans",
    "banlist",
    "sitemap.xml",
    "robots.txt",
    "dashboard",
    "auth",
    "login",
    "logout",
    "assets",
    "_astro",
    ...allLocales,
  ]);
  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(localizedSlugs[locale]).sort(),
      [...pageKinds].sort(),
    );
    assert.equal(localizedSlugs[locale].home, "");
    const slugs = pageKinds
      .filter((page) => page !== "home")
      .map((page) => localizedSlugs[locale][page]);
    assert.equal(new Set(slugs).size, 12, locale);
    for (const page of pageKinds.filter((page) => page !== "home")) {
      const slug = localizedSlugs[locale][page];
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(!reserved.has(slug), `${locale}: reserved ${slug}`);
      assert.ok(
        !pageKinds.includes(slug),
        `${locale}: English alias collision ${slug}`,
      );
      assert.equal(pageFromSlug(locale, slug), page);
      assert.equal(pageFromSlug(locale, page), page);
      assert.equal(equivalentPage(`/${locale}/${page}/`), page);
      assert.equal(equivalentPage(`/${locale}/${slug}`), page);
      assert.equal(equivalentPage(`/${slug}`), undefined);
    }
    assert.equal(pageFromSlug(locale, "unknown"), undefined);
    assert.equal(pageFromSlug(locale, "home"), undefined);
  }
  for (const page of pageKinds) {
    assert.equal(localePath("en", page), page === "home" ? "/" : `/${page}`);
  }
});

test("legacy localized English aliases permanently migrate without losing URL state; canonical routes do not loop", () => {
  for (const locale of locales) {
    for (const page of pageKinds) {
      const canonical = localePath(locale, page);
      assert.equal(
        legacyLocaleRedirect(new URL(canonical, siteUrl())),
        undefined,
      );
      if (page === "home") continue;
      for (const trailing of ["", "/"]) {
        const legacy = `/${locale}/${page}${trailing}?view=full&next=%2Fmaps#section`;
        assert.equal(
          legacyLocaleRedirect(new URL(legacy, siteUrl())),
          `${canonical}?view=full&next=%2Fmaps#section`,
        );
      }
    }
  }
  for (const path of [
    "/rules",
    "/en/rules",
    "/xx/rules",
    "/cs/unknown",
    "/cs/stats",
    "/api/maps",
    "/cs/rules/extra",
    "/cs//rules/",
  ]) {
    assert.equal(
      legacyLocaleRedirect(new URL(path, siteUrl())),
      undefined,
      path,
    );
  }
});
