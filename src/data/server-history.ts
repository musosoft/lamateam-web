/**
 * Community oral history, not an independently verified chronology.
 * Primary-source claims are scoped to the metadata or text actually available.
 * Never infer a server's lifespan from its position in the diagram.
 */
export type Evidence = {
  label: string;
} & (
  | { url: string; kind: "archive" | "document" | "image" | "video" }
  | { url?: never; kind: "private-archive" }
);

export type HistoryNode = {
  id: string;
  name: string;
  kind: "community" | "server" | "person" | "project" | "provider";
  summary: string;
  period: string;
  sources: Evidence[];
  graph?: boolean;
};

export type HistoryLink = {
  from: string;
  to: string;
  kind: keyof typeof relationshipKinds;
  account: string;
  period: string;
  sources: Evidence[];
  provenance?: string;
  // Some player moves only name the wider thread, not a destination server.
  targetScope?: "community-thread";
};

export type HistoryEvent = {
  id: string;
  year: number | null;
  dateLabel: string;
  title: string;
  account: string;
  nodeIds: string[];
  sources: Evidence[];
  provenance?: string;
  relationship?: "identity-observation";
};

export const historyRange = { start: 2006, end: 2026 };
export const historyTicks = [2006, 2010, 2014, 2018, 2022, 2026];

// Editorial lanes, not dated lifespans. Every public community branch is exposed.
export const historyNetworkRows: {
  id: string;
  lane: "main" | "branch";
  context: string;
}[] = [
  {
    id: "bedroom",
    lane: "main",
    context: "Around 2006 · public bedroom server; merged into AGT in 2008",
  },
  {
    id: "agteam",
    lane: "main",
    context: "User joined 2008 · maintained code since then",
  },
  {
    id: "zonax",
    lane: "branch",
    context: "Separate community · codebase received · merge circa 2013–14",
  },
  {
    id: "vcielka",
    lane: "branch",
    context:
      "Independent coexisted with ZonaX · continued until ~2015 · members joined Rivals",
  },
  {
    id: "aggressive-zone",
    lane: "main",
    context: "AGT + ZonaX · circa 2013–14; Steam group founded 12 Nov 2013",
  },
  {
    id: "battleforce",
    lane: "branch",
    context:
      "Earlier independent line · later joins main AGT→AGZ→Battleforce→Rivals→LaMaTeAm",
  },
  {
    id: "vega",
    lane: "branch",
    context: "Vega’s Zly Kocur · parallel, later ended and participants joined",
  },
  {
    id: "fakaheda",
    lane: "branch",
    context: "Early AGT hosting/sponsor · AGT and Aggressive Zone partner",
  },
  {
    id: "tweakgaming",
    lane: "branch",
    context: "Independent NL server · maintained by Muso · Jailbreak hosting",
  },
  {
    id: "gamers-germany",
    lane: "branch",
    context: "Independent · GameME, promotion and player exchange",
  },
  {
    id: "black-birds",
    lane: "branch",
    context: "Improved by Muso · merges with Red Skillers, later into Rivals",
  },
  {
    id: "red-skillers",
    lane: "branch",
    context:
      "Independent rival · merges into Black Birds, reopens, merges into JZD",
  },
  {
    id: "rivals",
    lane: "main",
    context:
      "Black Birds + Red Skillers · one community/server circa 2015; later joins main line",
  },
  {
    id: "noobstyle",
    lane: "branch",
    context: "Ended 2016 · players later joined Rivals.cz; move date unknown",
  },
  {
    id: "zaparit",
    lane: "branch",
    context:
      "Servers ended · players joined AGZ/Battleforce line; date unknown",
  },
  {
    id: "rivals-srcds",
    lane: "branch",
    context: "Public code release · repository created 4 Apr 2018",
  },
  {
    id: "jzd",
    lane: "branch",
    context:
      "Partial unmaintained code fork · Red Skillers reopens and merges into JZD; JZD joins main LaMaTeAm",
  },
  {
    id: "lamateam",
    lane: "main",
    context:
      "JZD continuation · maintained code restored at handoff; date unknown",
  },
];

const oralProvenance = "User-supplied community oral account · needs evidence";
const oralNode = (
  id: string,
  name: string,
  summary: string,
  kind: HistoryNode["kind"] = "community",
  graph = kind === "community" || kind === "provider",
): HistoryNode => ({
  id,
  name,
  summary,
  kind,
  graph,
  period: "Undated · oral account",
  sources: [],
});
const oralLink = (
  from: string,
  to: string,
  kind: HistoryLink["kind"],
  account: string,
  period = "Undated · sequence recalled, not dated",
): HistoryLink => ({
  from,
  to,
  kind,
  account,
  period,
  sources: [],
  provenance: oralProvenance,
});
const oralEvent = (
  id: string,
  title: string,
  account: string,
  nodeIds: string[],
  year: number | null = null,
  dateLabel = "Undated · oral account",
): HistoryEvent => ({
  id,
  title,
  account,
  nodeIds,
  year,
  dateLabel,
  sources: [],
  provenance: oralProvenance,
});

const groupSource: Evidence = {
  label: "Steam Aggressive Zone group: Founded and About",
  url: "https://steamcommunity.com/groups/aggressivezone",
  kind: "document",
};
const battleforceSource: Evidence = {
  label: "21 Sep 2014 announcement: Info / Súťaže / IP…",
  url: "https://steamcommunity.com/groups/aggressivezone/announcements/detail/141058918492392685",
  kind: "document",
};
const rivalsReportedSource: Evidence = {
  label:
    "Announcement listing — 8 Aug 2015 reference supplied by contributor; exact post still needed",
  url: "https://steamcommunity.com/groups/aggressivezone/announcements",
  kind: "document",
};
const rivalsGroupSource: Evidence = {
  label: "Steam Rivals Community group: Founded 24 July 2015",
  url: "https://steamcommunity.com/groups/rivalscommunity",
  kind: "document",
};

// Identity observations only. Never retain archived player lists or infer uptime.
const identitySnapshots = [
  {
    id: "agteam-name-2009",
    year: 2009,
    dateLabel: "30 Mar 2009",
    nodeId: "agteam",
    name: "Aggressive Ghost Team",
    titleText:
      "Agressive ghost team Cz/Sk [agt.4game.cz] [css] Counter Strike Source",
    url: "https://web.archive.org/web/20090330071506id_/http://www.gametracker.com:80/server_info/81.0.217.174:27158/",
  },
  {
    id: "agteam-name-2012",
    year: 2012,
    dateLabel: "14 Jan 2012",
    nodeId: "agteam",
    name: "Aggressive Ghost Team",
    titleText: "Aggressive Ghost Team: [Public][agteam.4game.cz]",
    url: "https://web.archive.org/web/20120114133658id_/http://www.gametracker.com:80/server_info/81.0.217.174:27158/",
  },
  {
    id: "agteam-name-2013",
    year: 2013,
    dateLabel: "23 Mar 2013",
    nodeId: "agteam",
    name: "Aggressive Ghost Team",
    titleText:
      "Aggressive Ghost Team: [Public][agteam.cz] by Fakaheda.eu [css]",
    url: "https://web.archive.org/web/20130323093814id_/http://www.gametracker.com:80/server_info/81.0.217.174:27158",
  },
  {
    id: "aggressive-zone-name-2014",
    year: 2014,
    dateLabel: "10 Aug 2014",
    nodeId: "aggressive-zone",
    name: "Aggressive Zone",
    titleText: "AggressiveZone.com | Public | by fakaheda.eu [css]",
    url: "https://web.archive.org/web/20140810070209id_/http://www.gametracker.com:80/server_info/81.0.217.174:27158/",
  },
];
const snapshotSource = (
  snapshot: (typeof identitySnapshots)[number],
): Evidence => ({
  label: `GameTracker archived identity · ${snapshot.dateLabel}`,
  url: snapshot.url,
  kind: "archive",
});
const agteamSiteSource: Evidence = {
  label: "Aggressive Ghost Team site · Wayback capture 16 Sep 2012",
  url: "https://web.archive.org/web/20120916093638/http://agteam.4game.cz/",
  kind: "archive",
};
const agteamSite2011Source: Evidence = {
  label: "Aggressive Ghost Team Portal · Wayback capture 25 May 2011",
  url: "https://web.archive.org/web/20110525080820/http://agteam.4game.cz/",
  kind: "archive",
};

export const historyNodes: HistoryNode[] = [
  {
    id: "lamateam",
    name: "LaMaTeAm",
    kind: "community",
    summary:
      "JZD continued as the same server/community into LaMaTeAm. At the undated handoff, Muso switched back to his own maintained code. Zuzule is recalled as inviting Muso back; no separate community merger is implied.",
    period: "JZD continuation and code handoff · date unknown",
    sources: [
      {
        label:
          "Recent LaMaTeAm video candidate · exact publication date unknown; not historical proof",
        url: "https://www.youtube.com/watch?v=Zwn0kI4YuJQ",
        kind: "video",
      },
    ],
    graph: true,
  },
  {
    id: "aggressive-zone",
    name: "Aggressive Zone",
    kind: "community",
    summary:
      "AGT and the separate ZonaX community merged around 2013–14 into Aggressive Zone, according to the owner. Aggressive Zone joined Battleforce in September 2014 after organizational dispute, funding problems and lost IPs; it discontinued as Muso left the head role. Steam dates only the group foundation to 12 November 2013, and the tracker is only an identity snapshot.",
    period: "Merge circa 2013–14 · Battleforce move Sep 2014 · closure undated",
    sources: [groupSource, snapshotSource(identitySnapshots[3])],
    graph: true,
  },
  {
    id: "battleforce",
    name: "Battleforce",
    kind: "server",
    summary:
      "Battleforce existed earlier on its own server line and later merged/joined the main AGT→AGZ→Battleforce→Rivals→LaMaTeAm line. An Aggressive Zone announcement lists new Battleforce addresses for Dust2, Public and DeathMatch on 21 Sep 2014; this does not by itself establish an ownership transfer or a community merger.",
    period:
      "Earlier own line · joins main line Sep 2014 · exact earlier origin unknown",
    sources: [battleforceSource],
    graph: true,
  },
  {
    id: "rivals",
    name: "Rivals Community",
    kind: "community",
    summary:
      "Black Birds and Red Skillers combined into one Rivals.cz community/server around 2015; neither remained separate. Rivals later joined the main LaMaTeAm line. The original server gradually shut down as credits ran out. Steam dates the group only to 24 July 2015. The undated Aggressive Zone About text directs people to Rivals, not proof of a direct server or ownership succession. The README’s retrospective 2008 refers to the code core under another name, not the Rivals brand.",
    period:
      "Combined community circa 2015 · later joins main line · shutdown gradual, exact date unknown",
    sources: [rivalsGroupSource, groupSource],
    graph: true,
  },
  {
    ...oralNode(
      "bedroom",
      "Bedroom-hosted server",
      "The first public bedroom-hosted CS:S server dates to circa 2006. According to the owner, that server merged into AGT when Muso joined in 2008. Muso has maintained the codebase since 2008. The server merge and participant move are separate oral claims; no legal ownership transfer is inferred.",
      "server",
      true,
    ),
    period: "Around 2006 · public bedroom server; merged into AGT 2008",
  },
  {
    ...oralNode(
      "agteam",
      "Aggressive Ghost Team",
      "Aggressive Ghost Team, aG^Team and agteam.fakaheda.eu are names recalled together in the account. The hostname is historical text, not a verified live link.",
      "community",
      true,
    ),
    summary:
      "Aggressive Ghost Team, aG^Team and agteam.fakaheda.eu are names recalled together in the account. The user's codebase line began in 2008 and continues to the present, distinct from the community's earlier origin. Archived GameTracker titles document name/hostname snapshots on 30 March 2009, 14 January 2012 and 23 March 2013 at 81.0.217.174:27158. Portal captures on 25 May 2011 and 16 September 2012 document agteam.4game.cz and contemporary community-authored server references. These observations do not establish continuous operation, ownership, founding dates or a formal FakaHeda partnership. The recalled agteam.fakaheda.eu hostname remains historical text, not a verified live link.",
    period:
      "User joined 2008 · code maintained 2008–present; community launch unknown",
    sources: [
      ...identitySnapshots
        .filter((snapshot) => snapshot.nodeId === "agteam")
        .map(snapshotSource),
      agteamSiteSource,
      agteamSite2011Source,
    ],
  },
  oralNode(
    "zonax",
    "ZonaX",
    "A separate community that also received the codebase. ZonaX remained separate from AGT until the merge around 2013–14 into Aggressive Zone.",
    "community",
    true,
  ),
  oralNode(
    "crystall",
    "Crystall",
    "The account credits Crystall with an introduction to MAX_007.",
    "person",
  ),
  oralNode(
    "max-007",
    "MAX_007",
    "Named in the introduction recalled through Crystall; no tenure or ownership is inferred.",
    "person",
  ),
  oralNode(
    "vcielka",
    "Vcielka",
    "Vcielka coexisted separately with ZonaX, continued from the ZonaX community after its merger with AGT/Aggressive Zone, and ended around 2015. Its members joined Rivals. This is not an ownership merger; the exact date is unknown.",
  ),
  oralNode(
    "vega",
    "Vega",
    "Vega's Zly Kocur ran alongside Aggressive Zone, later ended and its participants joined. The exact date is unknown; no organizational merger or invented sequence is implied.",
  ),
  oralNode(
    "noobstyle",
    "noobstyle.sk",
    "noobstyle.sk ended in 2016 and its players joined Rivals.cz. The exact player-movement date is unknown; this was not an organizational merger.",
  ),
  oralNode(
    "zaparit",
    "Zaparit.cz",
    "After its servers ended, Zaparit.cz players joined the Aggressive Zone/Battleforce line. The date is unknown; this was participant movement, not an organizational merger.",
  ),
  oralNode(
    "gamers-germany",
    "Gamers of Germany",
    "Gamers of Germany remained independent, hosted GameME, promoted the community and exchanged players. Collaboration does not imply an organizational merger; dates are unknown.",
  ),
  oralNode(
    "fakaheda",
    "FakaHeda",
    "The user recalls an official FakaHeda partnership in the Aggressive Zone community thread, separately from the earlier agteam.fakaheda.eu hostname. FakaHeda sponsored and hosted AGT early. Official is the participant's description, not independently verified status; neither implies ownership.",
    "provider",
  ),
  oralNode(
    "tweakgaming",
    "tweakgaming.com",
    "A separate NL server maintained by the user that hosted the Aggressive Zone Jailbreak server. The user recalls a tweakgaming.com partnership after the FakaHeda partnership. The sequence is oral history; dates and commercial terms are unverified. Partnership, not merger.",
  ),
  oralNode(
    "black-birds",
    "Black Birds",
    "The user joined and improved Black Birds. Black Birds later merged with Red Skillers into Rivals.cz around 2015. Named among the rivals who collectively became friends in the user's account.",
  ),
  oralNode(
    "red-skillers",
    "Red Skillers",
    "An independent rival community. The user recalls Red Skillers copying servers and bans. Red Skillers first merged into Black Birds, which later merged into Rivals. Red Skillers reopened later and merged into JZD, which then joined the main LaMaTeAm line.",
  ),
  oralNode(
    "jzd",
    "JZD",
    "Used a partial fork of rivals-srcds (half or more of the base), not maintained by the user. The JZD server/community continued into LaMaTeAm.",
  ),
  {
    ...oralNode(
      "rivals-srcds",
      "rivals-srcds",
      "Muso released musosoft/rivals-srcds so others could consolidate the declining CZ/SK CS:S community. The repository was created on 4 April 2018; this is not a verified deployment or exact public release timestamp. The README retrospective ‘Rivals (2008*–2018)’ refers to the code core under another name, not the Rivals brand start.",
      "project",
      true,
    ),
    period: "Repository created · 4 Apr 2018; public code release",
    sources: [
      {
        label: "musosoft/rivals-srcds GitHub repository created",
        url: "https://github.com/musosoft/rivals-srcds",
        kind: "document",
      },
    ],
  },
];

// Oral links describe only the recalled association, not proven legal succession.
export const historyLinks: HistoryLink[] = [
  oralLink(
    "bedroom",
    "agteam",
    "participant-move",
    "Muso joined AGT in 2008 after running the public bedroom server circa 2006. This records his participant move separately from the recalled server merge; no legal ownership transfer is inferred.",
    "2008 · owner account",
  ),
  oralLink(
    "bedroom",
    "agteam",
    "merge",
    "According to the owner, the circa-2006 bedroom-hosted public CS:S server merged into AGT when Muso joined in 2008. This is a recalled server merge, separate from his participant move, not evidence of a legal ownership transfer.",
    "2008 · owner account; exact date unknown",
  ),
  oralLink(
    "crystall",
    "max-007",
    "reported",
    "Crystall introduced Muso to MAX_007, according to the oral account. No organizational succession is implied.",
  ),
  oralLink(
    "agteam",
    "fakaheda",
    "partnership",
    "The remembered agteam.fakaheda.eu hostname associates aG^Team with FakaHeda. FakaHeda sponsored and hosted AGT early. Hosting dates and terms need evidence.",
  ),
  oralLink(
    "agteam",
    "zonax",
    "parallel",
    "AGT and ZonaX were separate communities running in parallel before their circa 2013–14 combination into Aggressive Zone.",
  ),
  oralLink(
    "agteam",
    "zonax",
    "code-maintenance",
    "AGT and ZonaX were separate parallel communities. ZonaX also received Muso's codebase; this code relationship is not a rename or merger. Both later merged into Aggressive Zone circa 2013–14.",
  ),
  oralLink(
    "zonax",
    "aggressive-zone",
    "merge",
    "ZonaX remained separate until the merge around 2013–14 into Aggressive Zone.",
    "Circa 2013–14 · approximate",
  ),
  oralLink(
    "agteam",
    "aggressive-zone",
    "merge",
    "AGT merged with ZonaX around 2013–14 into Aggressive Zone.",
    "Circa 2013–14 · approximate",
  ),
  oralLink(
    "vcielka",
    "aggressive-zone",
    "participant-move",
    "Vcielka coexisted separately with ZonaX, continued from the ZonaX community after its merger with AGT/Aggressive Zone, and ended around 2015. Members joined Rivals. This is not a takeover or organizational merger.",
  ),
  oralLink(
    "vega",
    "aggressive-zone",
    "parallel",
    "Vega's Zly Kocur ran alongside Aggressive Zone as a separate community before ending.",
  ),
  oralLink(
    "vega",
    "aggressive-zone",
    "participant-move",
    "Vega's Zly Kocur ran alongside Aggressive Zone, later ended and participants joined. Exact date unknown; not an organizational merger.",
  ),
  oralLink(
    "noobstyle",
    "rivals",
    "participant-move",
    "noobstyle.sk ended in 2016 and its players joined Rivals.cz. The exact player-movement date is unknown; no organizational merger is implied.",
    "After closure in 2016 · exact player-movement date unknown",
  ),
  oralLink(
    "zaparit",
    "battleforce",
    "participant-move",
    "After Zaparit.cz's servers ended, its players joined the Aggressive Zone/Battleforce line. The date is unknown; this is participant movement, not an organizational merger.",
  ),
  oralLink(
    "gamers-germany",
    "aggressive-zone",
    "partnership",
    "Gamers of Germany remained independent, hosted GameME, promoted the community and exchanged players. Dates unknown; no merger is asserted.",
  ),
  oralLink(
    "aggressive-zone",
    "fakaheda",
    "partnership",
    "The user describes an official FakaHeda partnership. This is distinct from the earlier aG^Team hostname association and does not imply ownership.",
  ),
  oralLink(
    "aggressive-zone",
    "tweakgaming",
    "partnership",
    "The user recalls a later tweakgaming.com partnership, after the FakaHeda partnership. Later expresses remembered relative order only, not an invented year, exclusive agreement or ownership merger.",
  ),
  oralLink(
    "aggressive-zone",
    "red-skillers",
    "rival",
    "Red Skillers was an independent rival; the owner recalls it copying servers and bans. This is an attributed recollection, not independently verified misconduct.",
  ),
  oralLink(
    "battleforce",
    "red-skillers",
    "participant-move",
    "Players and admins moved during Battleforce-era network/IP problems. This is participant movement, not a transfer of community ownership.",
  ),
  oralLink(
    "red-skillers",
    "black-birds",
    "merge",
    "Red Skillers first merged into Black Birds, which later merged into Rivals around 2015. The exact sequence and date are recalled, not independently verified.",
    "Undated · sequence recalled, not dated",
  ),
  oralLink(
    "black-birds",
    "rivals",
    "merge",
    "Black Birds later merged into Rivals around 2015. The exact sequence and date are recalled, not independently verified.",
    "Circa 2015 · approximate",
  ),
  oralLink(
    "red-skillers",
    "jzd",
    "merge",
    "Red Skillers reopened later and merged into JZD, which then joined the main LaMaTeAm line. The reopening date and merge sequence are recalled, not independently verified.",
    "Undated · sequence recalled, not dated",
  ),
  oralLink(
    "rivals-srcds",
    "jzd",
    "fork",
    "JZD used a partial fork of rivals-srcds (half or more of the base), not maintained by the user.",
  ),
  oralLink(
    "jzd",
    "lamateam",
    "server-continuation",
    "The JZD server/community continued into LaMaTeAm (same server/community continuation). At handoff the user switched back to their own maintained code.",
  ),
  oralLink(
    "rivals",
    "rivals-srcds",
    "code-release",
    "The rivals-srcds release was created to allow others to consolidate CZ/SK CS:S servers.",
  ),
  oralLink(
    "rivals-srcds",
    "lamateam",
    "code-maintenance",
    "At the JZD-to-LaMaTeAm handoff Muso switched back to his own maintained code, after the partial unmaintained fork. Zuzule invited him back. Exact date unknown; not a community merger with Rivals.",
  ),
  {
    from: "aggressive-zone",
    to: "battleforce",
    kind: "community-join",
    period: "Sep 2014 · oral account; 21 Sep addresses announced",
    account:
      "The owner recalls Aggressive Zone joining Battleforce after organizational dispute, funding problems and lost IPs. Aggressive Zone discontinued as Muso left the head role; its exact closure date is unknown. The announcement separately dates only the new Battleforce addresses to 21 September, not the dispute or closure.",
    sources: [],
    provenance: oralProvenance,
  },
  {
    from: "aggressive-zone",
    to: "rivals",
    kind: "community-reference",
    period: "Undated About · 8 Aug 2015 post reported",
    account:
      "The group About explicitly directs the community to Rivals. A contributor reports an 8 August 2015 announcement saying the community was still alive under the Rivals name; the exact dated post remains to be located. This is not a verified renaming date.",
    sources: [groupSource, rivalsReportedSource],
    provenance:
      "Primary About text; dated announcement supplied by contributor, not independently retrieved",
  },
];
export const historyEvents: HistoryEvent[] = [
  ...identitySnapshots.map((snapshot): HistoryEvent => ({
    id: snapshot.id,
    year: snapshot.year,
    dateLabel: snapshot.dateLabel,
    title: `${snapshot.name}: archived server-name snapshot`,
    account: `The dated GameTracker capture for 81.0.217.174:27158 records the title “${snapshot.titleText}”. This is a point-in-time identity observation, not proof of continuous operation, ownership succession, a migration date or a formal hosting partnership. The cited GameTracker snapshots concern the same endpoint; an unchanged address does not establish uninterrupted operation.${snapshot.id === "agteam-name-2009" ? " The 2009 page reports that the tracker listing was added on 15 July 2008. This is a tracker listing date reported in that capture, not a server start or community founding date." : ""} No player lists or player-count claims are used.`,
    nodeIds: [snapshot.nodeId],
    sources: [snapshotSource(snapshot)],
    provenance:
      "Archived primary listing · dated capture supplied and verified by contributor",
    relationship: "identity-observation",
  })),
  {
    id: "agteam-site-2011",
    year: 2011,
    dateLabel: "25 May 2011",
    title: "Aggressive Ghost Team Portal: Public / DeathMatch references",
    account:
      "The archived community-authored portal links the team's Steam group and contains a post dated 18 May 2011 about its Public and DeathMatch servers. The capture date is 25 May, distinct from the post's displayed date. This is a contemporary community account, not independent verification of a 2006 origin, and does not establish continuity between captures. Archived member and player lists are not used.",
    nodeIds: ["agteam"],
    sources: [agteamSite2011Source],
    provenance:
      "Archived community-authored portal · direct fetch supplied by contributor",
  },
  {
    id: "agteam-site-2012",
    year: 2012,
    dateLabel: "16 Sep 2012",
    title: "agteam.4game.cz: archived website identity",
    account:
      "The supplied Wayback capture documents the Aggressive Ghost Team portal at agteam.4game.cz, referencing CS:S and DeathMatch servers. This is an archived community-authored page, not independent evidence of a 2006 start. A capture dates an observed page, not the founding or lifetime of its server or community, and does not establish continuity between captures. Archived member and player lists are not used.",
    nodeIds: ["agteam"],
    sources: [agteamSiteSource],
    provenance:
      "Archived community website · dated capture supplied and verified by contributor",
  },
  oralEvent(
    "bedroom-origin",
    "Bedroom hosting and an early admin pack",
    "Around 2006, Muso ran the first public bedroom-hosted CS:S server. The year is approximate; no precise admin-tool adoption date is claimed.",
    ["bedroom"],
    2006,
    "Around 2006 · approximate",
  ),
  {
    id: "aggressive-zone-group",
    year: 2013,
    dateLabel: "12 Nov 2013",
    title: "Aggressive Zone Steam group founded",
    account:
      "The Steam group lists this founding date. No earlier server origin is inferred.",
    nodeIds: ["aggressive-zone"],
    sources: [groupSource],
    provenance: "Primary Steam group metadata",
  },
  {
    id: "battleforce-addresses",
    year: 2014,
    dateLabel: "21 Sep 2014",
    title: "Battleforce server addresses announced",
    account:
      "Aggressive Zone announces new Dust2, Public and DeathMatch addresses under Battleforce. The post is signed muso.sk; this does not establish an admin tenure.",
    nodeIds: ["aggressive-zone", "battleforce"],
    sources: [battleforceSource],
    provenance: "Primary dated announcement",
  },
  {
    id: "rivals-group-founded",
    year: 2015,
    dateLabel: "24 Jul 2015",
    title: "Rivals Community Steam group founded",
    account:
      "The Rivals Community Steam group lists Founded as 24 July 2015, with Czech language and Czech Republic location metadata. This establishes the Steam group's foundation date only, not a server founding, ownership change or community migration. The reported 8 August transition announcement remains separate and unverified.",
    nodeIds: ["rivals"],
    sources: [rivalsGroupSource],
    provenance:
      "Primary Steam group metadata · direct fetch supplied by contributor",
  },
  {
    id: "rivals-server-snapshot",
    year: 2015,
    dateLabel: "17 Oct 2015 · monitoring snapshot",
    title: "Game-Monitor lists a Rivals.cz public server",
    account:
      "The dated Game-Monitor server index lists [CZ/SK] RIVALS.CZ | Public. This is a point-in-time server observation, not evidence of the server's launch date or the Black Birds/Red Skillers merger date.",
    nodeIds: ["rivals"],
    sources: [
      {
        label: "Archived Game-Monitor CS:S server index · 17 Oct 2015",
        url: "https://web.archive.org/web/20151017210323/http://www.game-monitor.com/search.php?game=cstrike2%26pg=4",
        kind: "archive",
      },
    ],
    provenance:
      "Dated server-listing observation · not a launch or transition date",
    relationship: "identity-observation",
  },
  {
    id: "rivals-continuity",
    year: 2015,
    dateLabel: "8 Aug 2015 · reported",
    title: "Community continuity under the Rivals name",
    account:
      "A contributor identifies an announcement on this date saying the community remains alive as Rivals. The current About section supports the connection, but is undated; the exact announcement URL and date still need confirmation.",
    nodeIds: ["aggressive-zone", "rivals"],
    sources: [groupSource, rivalsReportedSource],
    provenance:
      "Contributor-supplied primary-source reference · dated post not independently retrieved",
  },
  oralEvent(
    "introduction",
    "An introduction through Crystall",
    "Crystall introduced Muso to MAX_007, according to the supplied account. The date and subsequent roles remain unverified.",
    ["crystall", "max-007"],
  ),
  oralEvent(
    "early-communities",
    "aG^Team, ZonaX and the wider scene",
    "The account recalls Aggressive Ghost Team / aG^Team / agteam.fakaheda.eu, ZonaX and Aggressive Zone. These names are preserved without assigning a precise transition date or treating every association as a rename.",
    ["agteam", "zonax", "aggressive-zone", "fakaheda"],
  ),
  oralEvent(
    "dm-ranking",
    "A remembered DeathMatch ranking",
    "The account claims a DM server reached #1 in Europe and #2 globally. Ranking service, snapshot date, metric and exact server identity need evidence. This is not an independently verified ranking.",
    ["agteam", "aggressive-zone"],
  ),
  oralEvent(
    "parallel-scene",
    "Communities beyond the main thread",
    "The user recalls additions, players and admins joining or partnering, and provider partnerships in the wider community thread. The specific associations are recorded below. Their dates are unknown; participation and partnership do not establish shared ownership or mergers.",
    [
      "vcielka",
      "vega",
      "noobstyle",
      "zaparit",
      "gamers-germany",
      "tweakgaming",
    ],
  ),
  oralEvent(
    "zonax-contributor-move",
    "Maintaining ZonaX, then joining Aggressive Zone",
    "The user recalls Muso maintaining ZonaX before joining Aggressive Zone. This is a contributor transition with relative order only, not a dated transfer of servers or ownership.",
    ["zonax", "aggressive-zone"],
  ),
  oralEvent(
    "vcielka-joining",
    "Vcielka continues until ~2015 and members join Rivals",
    "Vcielka coexisted separately with ZonaX, continued from the ZonaX community after its merger with AGT/Aggressive Zone, and ended around 2015. Members joined Rivals. The exact date is unknown; this does not imply acquisition of the former community.",
    ["vcielka", "aggressive-zone", "rivals"],
  ),
  oralEvent(
    "subsequent-additions",
    "Vega and noobstyle.sk: subsequent additions",
    "Vega's Zly Kocur ran alongside Aggressive Zone, later ended and participants joined. Separately, noobstyle.sk ended in 2016 and its players joined Rivals.cz; the exact movement date is unknown. No organizational merger or imposed sequence is implied.",
    ["vcielka", "vega", "noobstyle", "aggressive-zone"],
  ),
  oralEvent(
    "admins-players-collaboration",
    "Admins and players join or partner",
    "Zaparit players joined the Aggressive Zone/Battleforce line after its servers ended; the date is unknown. Gamers of Germany remained independent and exchanged players, hosted GameME and promoted the community. These are distinct participant movement and partnership claims, not ownership mergers.",
    ["zaparit", "gamers-germany", "battleforce"],
  ),
  oralEvent(
    "fakaheda-partnership",
    "A recalled official FakaHeda partnership",
    "The user describes an official FakaHeda partnership in the Aggressive Zone community thread. Official is the user's description and needs documentary evidence; no agreement date, terms or ownership are inferred.",
    ["aggressive-zone", "fakaheda"],
  ),
  oralEvent(
    "tweakgaming-partnership",
    "A later tweakgaming.com partnership",
    "The user recalls a tweakgaming.com partnership after the FakaHeda partnership. Relative order is preserved without assigning years or claiming contract terms, exclusivity or ownership mergers.",
    ["aggressive-zone", "fakaheda", "tweakgaming"],
  ),
  oralEvent(
    "bedroom-agt-server-merge",
    "Bedroom-hosted public server merges into AGT",
    "According to the owner, the public bedroom-hosted CS:S server begun circa 2006 merged into AGT when Muso joined in 2008. This records the server merge separately from the participant move and ongoing code maintenance; no legal ownership transfer is inferred.",
    ["bedroom", "agteam"],
    2008,
    "2008 · owner account; exact date unknown",
  ),
  oralEvent(
    "agt-join-code",
    "Muso joins AGT and maintains the codebase",
    "Muso joined AGT in 2008 and has maintained his codebase from 2008 to the present. This dates his contribution, not AGT's founding or the Rivals brand.",
    ["agteam", "rivals-srcds"],
    2008,
    "2008–present · owner account",
  ),
  oralEvent(
    "agt-zonax-merge",
    "Two separate communities become Aggressive Zone",
    "AGT and ZonaX were separate communities; ZonaX also received the codebase. They merged around 2013–14 into Aggressive Zone. Tracker identity captures do not date this merger.",
    ["agteam", "zonax", "aggressive-zone"],
    null,
    "Circa 2013–14 · exact date unknown",
  ),
  oralEvent(
    "battleforce-joining",
    "Aggressive Zone joins Battleforce",
    "After organizational dispute, funding problems and lost IPs, Aggressive Zone joined Battleforce in September 2014. Aggressive Zone discontinued as Muso left the head role; the exact closure date is unknown. Player/admin movement occurred during the network/IP problems.",
    ["aggressive-zone", "battleforce", "red-skillers"],
    2014,
    "Sep 2014 · joining; closure date unknown",
  ),
  oralEvent(
    "rivals-merge",
    "Black Birds and Red Skillers become one Rivals.cz",
    "Muso improved Black Birds, reusing a trimmed customized base from the short-lived Noaco side project. Red Skillers first merged into Black Birds, which later combined into one Rivals.cz community/server around 2015; neither remained separate. The exact sequence and date are recalled, not independently verified.",
    ["red-skillers", "black-birds", "rivals"],
    2015,
    "Circa 2015 · approximate",
  ),
  oralEvent(
    "red-skillers-reopen",
    "Red Skillers reopens and merges into JZD",
    "Red Skillers reopened later and merged into JZD, which then joined the main LaMaTeAm line. The reopening date and merge sequence are recalled, not independently verified.",
    ["red-skillers", "jzd", "lamateam"],
  ),
  oralEvent(
    "jzd-joins-main",
    "JZD joins the main LaMaTeAm line",
    "JZD, which had received the reopened Red Skillers, then merged into/joined the main LaMaTeAm line. The exact date is unknown; this is a recalled continuation, not proof of uninterrupted technical uptime.",
    ["jzd", "lamateam"],
  ),
  oralEvent(
    "noobstyle-closure",
    "noobstyle.sk closes; players later join",
    "noobstyle.sk ended in 2016 and its players later joined Rivals.cz. The closure year is known, but the exact player-movement date is not; this was not an organizational merger.",
    ["noobstyle", "rivals"],
    2016,
    "2016 · closure; player join date unknown",
  ),
  {
    id: "rivals-repository-created",
    year: 2018,
    dateLabel: "4 Apr 2018 · repository creation",
    title: "musosoft/rivals-srcds repository created",
    account:
      "GitHub repository metadata dates creation to 4 April 2018, not an exact public release or server shutdown time. The README retrospective ‘Rivals (2008*–2018)’ refers to the code core under another name, not a 2008 Rivals brand launch.",
    nodeIds: ["rivals-srcds"],
    sources: [
      {
        label: "musosoft/rivals-srcds repository metadata and README",
        url: "https://github.com/musosoft/rivals-srcds",
        kind: "document",
      },
    ],
    provenance:
      "Repository metadata and retrospective README · claims scoped separately",
  },
  oralEvent(
    "rivals-release",
    "Public code for a declining CZ/SK scene",
    "Muso released musosoft/rivals-srcds so people could consolidate the declining CZ/SK community. The original Rivals server gradually shut down as credits ran out; no precise shutdown date is established.",
    ["rivals", "rivals-srcds"],
  ),
  {
    id: "lamateam-video-candidate",
    year: null,
    dateLabel: "Recent-era candidate · exact publication date unknown",
    title: "Potentially relevant LaMaTeAm video (not historical proof)",
    account:
      "A YouTube video titled ‘Counter strike Source LaMaTeAm Nightfever’ appears on the Zuzulinka Zuzule channel. Its exact publication date and historical context have not been verified; it is listed as a candidate only, not evidence about earlier server eras.",
    nodeIds: ["lamateam"],
    sources: [
      {
        label:
          "Candidate video · recent-era LaMaTeAm title; publication date unverified",
        url: "https://www.youtube.com/watch?v=Zwn0kI4YuJQ",
        kind: "video",
      },
    ],
    provenance: "Unverified media candidate · not historical evidence",
  },
  oralEvent(
    "jzd-continuation",
    "JZD continues to LaMaTeAm; maintained code restored",
    "JZD ran a partial fork of rivals-srcds, half or more of the base, not maintained by Muso. The same JZD server/community continued to LaMaTeAm. At handoff Muso switched back to his own maintained code; the exact date is unknown.",
    ["rivals-srcds", "jzd", "lamateam"],
  ),
  oralEvent(
    "return-reunion",
    "An invitation back and a source-code reunion",
    "Zuzule invited Muso back to LaMaTeAm, followed by a reunion around the source code, according to the oral account. No year, merger or admin join date is inferred.",
    ["lamateam", "rivals-srcds"],
  ),
];

export const historyAdmins = ["Muso", "Zuzule", "crazy69"].map((name) => ({
  name,
  role:
    name === "Zuzule"
      ? "Admin; recalled invitation back to LaMaTeAm"
      : "Admin named in the community account",
  period: "Join date unknown · tenure tentative / not established",
  sources: [] as Evidence[],
}));

// A discovery candidate only: never used as evidence for the historical graph.
export const historyMediaCandidates = [
  {
    title: "Counter strike Source LaMaTeAm Nightfever",
    channel: "Zuzulinka Zuzule",
    url: "https://www.youtube.com/watch?v=Zwn0kI4YuJQ",
    status: "recent-unverified",
    publishedAt: null,
    historicalProof: false,
    note: "Potentially relevant recent video; exact post date unverified. No verified old community-specific videos or screenshots have been found.",
  },
] as const;

export const relationshipKinds = {
  "participant-move": {
    label: "Participant movement",
    description:
      "A person or players/admins joining; not an organizational or ownership merger.",
  },
  "community-join": {
    label: "Community joins network",
    description:
      "A recalled community joining another network; legal ownership is not inferred.",
  },
  "community-reference": {
    label: "Community reference",
    description:
      "A page directs people to another community; not proof of direct succession.",
  },
  "server-continuation": {
    label: "Same server/community continuation",
    description:
      "An owner-recalled continuation, not proof of uninterrupted technical uptime.",
  },
  "code-maintenance": {
    label: "Code sharing / maintenance",
    description:
      "Shared or maintained code, not a community merger or server succession.",
  },
  "code-release": {
    label: "Public code release",
    description:
      "Software made available for reuse; not a community launch or merger.",
  },
  "identity-observation": {
    label: "Identity observation",
    description:
      "A dated identity snapshot only, not a launch or transition date.",
  },
  reported: {
    label: "Reported association",
    description:
      "An oral-account connection; not proof of a merger, rename or shared ownership.",
  },
  lineage: {
    label: "Lineage / succession",
    description:
      "A reported continuation, move or split; not automatically shared ownership.",
  },
  parallel: {
    label: "Parallel community",
    description: "A reported community alongside another, not its successor.",
  },
  rival: {
    label: "Rival server",
    description:
      "Rivalry as recalled by participants, not a present-day judgement.",
  },
  merge: {
    label: "Merger",
    description:
      "An owner-recalled community or server combination; does not establish legal ownership transfer.",
  },
  partnership: {
    label: "Partnership",
    description:
      "A recalled partnership or hosting arrangement; does not imply ownership merger.",
  },
  fork: {
    label: "Fork",
    description:
      "A partial or full codebase fork; not maintained by the original author.",
  },
} as const;
