import {
  equivalentPage,
  localeFromPath,
  localePath,
  routeManifest,
  siteUrl,
} from "./localized-content.ts";

/** Only manifest-backed equivalents may appear in head metadata. */
export function routeSeo(path: string, origin = siteUrl()) {
  const page = equivalentPage(path);
  const locale = localeFromPath(path);
  const canonicalPath = page ? localePath(locale, page) : path;
  return {
    page,
    locale,
    canonicalPath,
    canonical: new URL(canonicalPath, origin).href,
    alternates: page
      ? routeManifest
          .filter((route) => route.page === page)
          .map((route) => ({
            locale: route.locale,
            url: new URL(route.path, origin).href,
          }))
      : [],
    xDefault: page ? new URL(localePath("en", page), origin).href : undefined,
  };
}

export const openGraphLocales = {
  en: "en_GB",
  cs: "cs_CZ",
  sk: "sk_SK",
  pl: "pl_PL",
  hu: "hu_HU",
  de: "de_DE",
  uk: "uk_UA",
  fr: "fr_FR",
} as const;
