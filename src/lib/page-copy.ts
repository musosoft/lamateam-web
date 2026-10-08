import en from "./i18n/en.json" with { type: "json" };
import cs from "./i18n/cs.json" with { type: "json" };
import sk from "./i18n/sk.json" with { type: "json" };
import pl from "./i18n/pl.json" with { type: "json" };
import hu from "./i18n/hu.json" with { type: "json" };
import de from "./i18n/de.json" with { type: "json" };
import uk from "./i18n/uk.json" with { type: "json" };
import fr from "./i18n/fr.json" with { type: "json" };
import type { SiteLocale } from "./localized-content";
import { homeCopy, type HomeCopyKey } from "./home-copy.ts";

export type CopyKey = keyof typeof en | HomeCopyKey;
export type PageCopy = { [K in CopyKey]: string };
export const pageCopy: Record<SiteLocale, PageCopy> = {
  en: { ...en, ...homeCopy.en },
  cs: { ...cs, ...homeCopy.cs },
  sk: { ...sk, ...homeCopy.sk },
  pl: { ...pl, ...homeCopy.pl },
  hu: { ...hu, ...homeCopy.hu },
  de: { ...de, ...homeCopy.de },
  uk: { ...uk, ...homeCopy.uk },
  fr: { ...fr, ...homeCopy.fr },
};

/** Static, bundled copy only. Missing translations are an error, never English fallback. */
export function translator(locale: SiteLocale) {
  return (key: CopyKey): string => {
    const value = pageCopy[locale][key];
    if (!value?.trim()) throw new Error(`Missing ${locale} copy: ${key}`);
    return value;
  };
}

export const interactionKeys = [
  "Saving…",
  "Save rating",
  "No ratings yet.",
  "{average} / 5 · {count} ratings",
  "Selected map: {map}. {position} of {total} maps in this round.",
  "Loading map ratings…",
  "Ratings are up to date. Choose 1–5 stars, then save.",
  "Map ratings are temporarily unavailable. Please try again later.",
  "Ratings unavailable.",
  "Selection not saved yet.",
  "Saving your rating…",
  "Sign in with Steam to save your rating.",
  "Your rating is saved. You can change it anytime.",
  "Could not confirm your rating. Check your connection and try again.",
  "Command copied. Paste it into the CS:S console.",
  "Copy unavailable. The command is selected; copy it manually or type it into the console.",
] as const satisfies readonly CopyKey[];

export function clientCopy(locale: SiteLocale) {
  const t = translator(locale);
  return Object.fromEntries(interactionKeys.map((key) => [key, t(key)]));
}

export const chatKeys = [
  "In-game chat: do not press Space or Enter to send. Click Send; keyboard submission may close the MOTD.",
  "Invalid time",
  "No messages yet. Start the conversation.",
  "Chat is unavailable right now. Please try again shortly.",
  "Chat updates are temporarily unavailable.",
  "Sending…",
  "Message sent.",
  "Message not sent. Please try again.",
] as const satisfies readonly CopyKey[];
export function chatCopy(locale: SiteLocale) {
  const t = translator(locale);
  return Object.fromEntries(chatKeys.map((key) => [key, t(key)]));
}
