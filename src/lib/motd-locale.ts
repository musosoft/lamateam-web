import type { SiteLocale } from "./localized-content";

const supported = new Set(["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"]);
const countryLocales: Record<string, SiteLocale> = {
  CZ: "cs",
  SK: "sk",
  PL: "pl",
  HU: "hu",
  DE: "de",
  UA: "uk",
  FR: "fr",
};

export function isGameUserAgent(userAgent: string | null): boolean {
  return /valve|steam/i.test(userAgent ?? "");
}

/** Positive quality only; equal qualities keep header order. Wildcards are not
 * an explicit supported language and therefore leave country fallback intact. */
export function preferredMotdLanguage(
  header: string | null,
): SiteLocale | undefined {
  let best: SiteLocale | undefined;
  let bestQuality = 0;
  for (const entry of (header ?? "").split(",")) {
    const [range, ...parameters] = entry.trim().split(";");
    if (!/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(range.trim())) continue;
    const language = range.trim().toLowerCase().split("-")[0];
    if (!supported.has(language)) continue;
    let quality = 1;
    // Ignore malformed entries, duplicate q parameters and unknown parameters.
    if (parameters.length) {
      if (parameters.length !== 1) continue;
      const match =
        /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?|\.\d{1,3})\s*$/i.exec(
          parameters[0],
        );
      if (!match) continue;
      quality = Number(match[1]);
    }
    if (quality > bestQuality) {
      best = language as SiteLocale;
      bestQuality = quality;
    }
  }
  return best;
}

export function selectHomeLocale({
  pathname,
  userAgent,
  acceptLanguage,
  country,
}: {
  pathname: string;
  userAgent: string | null;
  acceptLanguage: string | null;
  country?: string;
}): SiteLocale | undefined {
  // Undefined keeps explicit locale paths authoritative in the caller.
  if (pathname !== "/") return undefined;
  if (!isGameUserAgent(userAgent)) return "en";
  return (
    preferredMotdLanguage(acceptLanguage) ??
    countryLocales[country?.toUpperCase() ?? ""] ??
    "en"
  );
}
