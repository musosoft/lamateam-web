import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "parse5";
import { pageCopy } from "../src/lib/page-copy.ts";
import {
  equivalentPage,
  localePath,
  locales,
  untranslatedPublicRoutes,
} from "../src/lib/localized-content.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("shared shell bypasses request-time HTML localization; only localized home content needs the adapter", () => {
  const layout = read("../src/layouts/Layout.astro");
  assert.match(
    layout,
    /<LocalizedMarkup locale=\{locale\} localized>\s*<CommunityNav/,
  );
  assert.match(
    layout,
    /<LocalizedMarkup locale=\{locale\} languageControl localized>\s*<LanguageSelector[^>]*serverLocalized/,
  );
  assert.match(
    layout,
    /pageKind === 'home' && locale !== 'en' \? \(\s*<LocalizedMarkup locale=\{locale\}>/,
  );
  const adapter = read("../src/components/LocalizedMarkup.astro");
  assert.match(adapter, /localized\s*\? rendered\s*:\s*localizeShell\(/);
  const nav = read("../src/components/CommunityNav.astro");
  assert.match(nav, /href=\{localizedHref\(href, locale\)\}/);
  assert.match(nav, /: t\(label\)/);
  const selector = read("../src/components/LanguageSelector.astro");
  assert.match(selector, /!serverLocalized && <script>/);
});

const base = process.env.SSR_BASE_URL;
test(
  "production shell retains localized navigation, flags and selector without the legacy DOM translator",
  { skip: !base },
  async () => {
    for (const [path, locale, headers] of [
      ["/", "en"],
      ["/rules", "en"],
      ["/contact", "en"],
      ...locales.map((locale) => [localePath(locale, "rules"), locale]),
      ...locales.map((locale) => [localePath(locale, "home"), locale]),
      ["/", "cs", { "User-Agent": "Valve Steam", "Accept-Language": "cs" }],
    ]) {
      const response = await fetch(new URL(path, base), { headers });
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.match(html, /<\/body>\s*<\/html>/, path);
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node.childNodes || []) walk(child);
      };
      walk(parse(html, { scriptingEnabled: false }));
      const attr = (node, name) =>
        node.attrs?.find((a) => a.name === name)?.value;
      const text = (node) =>
        node.value || (node.childNodes || []).map(text).join("");
      const nav = nodes.find((n) => attr(n, "id") === "community-nav");
      const navNodes = [];
      const visitNav = (node) => {
        navNodes.push(node);
        for (const child of node.childNodes || []) visitNav(child);
      };
      assert.ok(nav, path);
      visitNav(nav);
      const rules = navNodes.find(
        (n) => attr(n, "data-menu-route") === "/rules",
      );
      assert.equal(attr(rules, "href"), localePath(locale, "rules"), path);
      assert.ok(text(rules).includes(pageCopy[locale].Rules), path);
      const menuLinks = navNodes.filter((n) => attr(n, "data-menu-route"));
      assert.equal(menuLinks.length, 13, path);
      for (const link of menuLinks) {
        const route = attr(link, "data-menu-route");
        if (route.startsWith("https://")) {
          const externalLabel = {
            "https://stats.lamateam.eu/": "HLstatsX",
          }[route];
          assert.ok(externalLabel, path);
          assert.equal(attr(link, "href"), route, path);
          assert.equal(attr(link, "rel"), "external", path);
          assert.equal(
            text(link.childNodes.find((n) => n.tagName === "span")),
            externalLabel,
            path,
          );
          assert.equal(attr(link, "aria-current"), undefined, path);
          continue;
        }
        if (untranslatedPublicRoutes.includes(route)) {
          const localLabel = {
            "/stats": "HLstatsX",
            "/banlist": "SourceBans",
          }[route];
          assert.ok(localLabel, path);
          assert.equal(attr(link, "href"), route, path);
          assert.equal(
            text(link.childNodes.find((n) => n.tagName === "span")),
            localLabel,
            path,
          );
          assert.equal(attr(link, "aria-current"), undefined, path);
          continue;
        }
        const kind = equivalentPage(route);
        assert.ok(kind, path);
        assert.equal(attr(link, "href"), localePath(locale, kind), path);
        const label = link.childNodes.find((n) => n.tagName === "span");
        const key =
          kind === "sourcetv"
            ? "SourceTV"
            : kind === "vip"
              ? "VIP"
              : kind[0].toUpperCase() + kind.slice(1);
        assert.equal(text(label), pageCopy[locale][key], path);
        assert.equal(
          attr(link, "aria-current"),
          kind === equivalentPage(path) ? "page" : undefined,
          path,
        );
      }
      const brand = navNodes.find((n) =>
        attr(n, "class")?.split(" ").includes("brand"),
      );
      assert.equal(attr(brand, "href"), localePath(locale, "home"), path);
      assert.equal(
        attr(brand, "aria-label"),
        pageCopy[locale]["LaMaTeAm community"],
        path,
      );
      const connect = navNodes.find((n) =>
        attr(n, "class")?.split(" ").includes("connect-button"),
      );
      assert.equal(attr(connect, "href"), localePath(locale, "connect"), path);
      assert.equal(text(connect).trim(), pageCopy[locale].Connect, path);
      const languages = navNodes.find(
        (n) => attr(n, "class") === "header-language-options",
      );
      assert.equal(
        attr(languages, "aria-label"),
        pageCopy[locale].Languages,
        path,
      );
      const shortcuts = navNodes.filter((n) =>
        attr(n, "data-language-shortcut"),
      );
      assert.equal(shortcuts.length, 8, path);
      for (const shortcut of shortcuts) {
        const language = attr(shortcut, "lang");
        assert.equal(
          attr(shortcut, "href"),
          localePath(language, equivalentPage(path)),
          path,
        );
        assert.equal(
          attr(shortcut, "aria-current"),
          language === locale ? "true" : undefined,
          path,
        );
      }
      assert.ok(
        nodes.some(
          (n) =>
            attr(n, "aria-label") === pageCopy[locale]["Pull down navigation"],
        ),
        path,
      );
      const label = nodes.find(
        (n) => n.tagName === "label" && attr(n, "for") === "language",
      );
      assert.equal(text(label).trim(), pageCopy[locale].Language, path);
      assert.equal(nodes.filter((n) => n.tagName === "option").length, 8, path);
      const selector = nodes.find((n) => attr(n, "id") === "language");
      assert.equal(
        attr(selector, "data-current-language"),
        locale.toUpperCase(),
        path,
      );
      const selected = nodes.filter(
        (n) => n.tagName === "option" && attr(n, "selected") !== undefined,
      );
      assert.equal(selected.length, 1, path);
      assert.equal(attr(selected[0], "value"), locale.toUpperCase(), path);
      for (const option of nodes.filter((n) => n.tagName === "option")) {
        assert.equal(
          attr(option, "data-path"),
          localePath(attr(option, "value").toLowerCase(), equivalentPage(path)),
          path,
        );
      }
      const noscriptNav = nodes.find(
        (n) =>
          n.tagName === "noscript" &&
          n.childNodes.some((child) => child.tagName === "nav"),
      );
      assert.ok(noscriptNav, path);
      const fallback = noscriptNav.childNodes.find((n) => n.tagName === "nav");
      assert.equal(
        attr(fallback, "aria-label"),
        pageCopy[locale].Languages,
        path,
      );
      assert.equal(
        fallback.childNodes.filter((n) => n.tagName === "a").length,
        8,
        path,
      );
      // parse5 does not yet retain customizable-select children. The Worker
      // must preserve the source markup for browsers that support them.
      assert.match(html, /<selectedcontent>/, path);
      const rawSelector = html.match(
        /<select\b[^>]*id="language"[\s\S]*?<\/select>/,
      )?.[0];
      assert.ok(rawSelector, path);
      assert.equal((rawSelector.match(/<svg\b/g) || []).length, 8, path);
      assert.equal(
        (rawSelector.match(/language-native-flag/g) || []).length,
        8,
        path,
      );
      assert.ok(
        nodes.some(
          (n) =>
            n.tagName === "script" &&
            attr(n, "src")?.includes("LocalizedMarkup"),
        ),
        path,
      );
      assert.ok(
        !nodes.some(
          (n) =>
            n.tagName === "script" &&
            attr(n, "src")?.includes("LanguageSelector"),
        ),
        path,
      );
    }
  },
);
