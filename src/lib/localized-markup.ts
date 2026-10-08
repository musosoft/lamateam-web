import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { localizedHref, type SiteLocale } from "./localized-content.ts";
import { pageCopy, translator, type CopyKey } from "./page-copy.ts";

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Server-only adapter for the shared shell. Source-offset edits keep SVGs,
 * forms, designer markup and scripts byte-for-byte except static copy/links.
 * Never traverse user text, code, scripts or third-party embeds. */
export function localizeShell(
  html: string,
  locale: SiteLocale,
  languageControl = false,
): string {
  // Parse <noscript> navigation as markup, not one giant untranslated text
  // node. Browsers without JS and crawlers need these real language links.
  const tree = parseFragment(html, {
    sourceCodeLocationInfo: true,
    scriptingEnabled: false,
  });
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const t = translator(locale);
  const nativeNames = new Set([
    "English",
    "Čeština",
    "Slovenčina",
    "Polski",
    "Magyar",
    "Deutsch",
    "Українська",
    "Français",
  ]);
  const translated = (value: string) => {
    const key = value.replace(/\s+/g, " ").trim();
    if (Object.hasOwn(pageCopy.en, key)) return t(key as CopyKey);
    if (locale !== "en" && /\p{L}/u.test(key) && !nativeNames.has(key)) {
      throw new Error(`Missing shell copy: ${key}`);
    }
    return undefined;
  };
  const walk = (node: DefaultTreeAdapterTypes.Node, excluded = false) => {
    if ("tagName" in node) {
      const location = node.sourceCodeLocation;
      const attrs = new Map(node.attrs.map((attr) => [attr.name, attr.value]));
      if (node.tagName === "script" && languageControl && location) {
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          value: "",
        });
        return;
      }
      const hardExcluded = [
        "script",
        "style",
        "svg",
        "code",
        "pre",
        "kbd",
      ].includes(node.tagName);
      if (!excluded && !hardExcluded) {
        for (const attr of node.attrs) {
          const pos = location?.attrs?.[attr.name];
          if (!pos) continue;
          let value: string | undefined;
          if (["aria-label", "title", "placeholder", "alt"].includes(attr.name))
            value = translated(attr.value);
          if (attr.name === "href" && !attrs.has("hreflang"))
            value = localizedHref(attr.value, locale);
          if (value !== undefined && value !== attr.value)
            edits.push({
              start: pos.startOffset,
              end: pos.endOffset,
              value: `${attr.name}="${escape(value)}"`,
            });
        }
      }
      excluded ||=
        hardExcluded ||
        node.tagName === "iframe" ||
        attrs.get("translate") === "no" ||
        attrs.has("data-no-translate");
    }
    if (
      "value" in node &&
      node.nodeName === "#text" &&
      !excluded &&
      node.sourceCodeLocation
    ) {
      const value = translated(node.value);
      if (value !== undefined) {
        const leading = node.value.match(/^\s*/)?.[0] || "";
        const trailing = node.value.match(/\s*$/)?.[0] || "";
        edits.push({
          start: node.sourceCodeLocation.startOffset,
          end: node.sourceCodeLocation.endOffset,
          value: leading + escape(value) + trailing,
        });
      }
    }
    if ("childNodes" in node)
      for (const child of node.childNodes) walk(child, excluded);
  };
  walk(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  }
  return html;
}
