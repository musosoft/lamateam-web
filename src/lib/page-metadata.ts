import type { PageKind } from "./localized-content";
import type { CopyKey } from "./page-copy";

export const guideDescriptions = {
  rules: "LaMaTeAm CS:S server rules — prohibited actions and penalties.",
  maps: "Explore the LaMaTeAm CS:S map collection, view community ratings and rate your favorite Counter-Strike: Source maps.",
  commands:
    "Useful LaMaTeAm CS:S player commands for map voting, statistics, demos and server information.",
  money:
    "CS:S money rewards, round bonuses and penalties for Counter-Terrorists and Terrorists.",
  hitreg:
    "Understand CS:S hit registration, tickrate, ping and the network settings enforced on LaMaTeAm.",
  fixes:
    "Fix common CS:S FPS, sound and radar problems with quick console commands and configuration repair.",
  speed:
    "Compare CS:S movement speeds by weapon, from Scout and pistols to rifles and machine guns.",
  sourcetv:
    "Browse and download LaMaTeAm SourceTV demos by map and recording date.",
  admins:
    "Meet the LaMaTeAm admins and read the rules for moderation, evidence and fair play.",
  vip: "Support the LaMaTeAm CS:S server, see VIP prices and reserved-slot instructions, and meet our supporters.",
  contact:
    "Contact the LaMaTeAm team through Discord, in-game admin chat or the contact form.",
} satisfies Partial<Record<PageKind, CopyKey>>;
