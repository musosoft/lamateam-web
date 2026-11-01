import assert from "node:assert/strict";
import test from "node:test";
import {
  historyRange,
  historyTicks,
  historyNodes,
  historyLinks,
  historyEvents,
  historyAdmins,
  historyNetworkRows,
  relationshipKinds,
  historyMediaCandidates,
} from "../src/data/server-history.ts";

const node = (id) => {
  const item = historyNodes.find((item) => item.id === id);
  assert.ok(item, `missing node ${id}`);
  return item;
};
const event = (id) => {
  const item = historyEvents.find((item) => item.id === id);
  assert.ok(item, `missing event ${id}`);
  return item;
};
const link = (from, to, kind) => {
  const item = historyLinks.find(
    (item) => item.from === from && item.to === to && item.kind === kind,
  );
  assert.ok(item, `missing ${kind} edge ${from} → ${to}`);
  return item;
};

test("graph references, relationship types and chronology are internally consistent", () => {
  const ids = new Set(historyNodes.map((item) => item.id));
  assert.equal(ids.size, historyNodes.length);
  assert.equal(
    new Set(historyEvents.map((item) => item.id)).size,
    historyEvents.length,
  );
  assert.deepEqual(historyRange, { start: 2006, end: 2026 });
  assert.equal(historyTicks[0], historyRange.start);
  assert.equal(historyTicks.at(-1), historyRange.end);
  for (const item of historyLinks) {
    assert.ok(ids.has(item.from), item.from);
    assert.ok(ids.has(item.to), item.to);
    assert.ok(item.kind in relationshipKinds, item.kind);
    assert.ok(item.account && item.period && item.provenance);
  }
  for (const item of historyEvents) {
    assert.ok(
      item.year === null ||
        (Number.isInteger(item.year) &&
          item.year >= historyRange.start &&
          item.year <= historyRange.end),
    );
    assert.ok(item.dateLabel && item.provenance);
    for (const id of item.nodeIds) assert.ok(ids.has(id), id);
  }
});

test("visual lanes expose all public branches, not just a false linear succession", () => {
  const rows = historyNetworkRows.map((row) => row.id);
  assert.equal(new Set(rows).size, rows.length);
  assert.deepEqual(
    [...rows].sort(),
    historyNodes
      .filter((item) => item.graph)
      .map((item) => item.id)
      .sort(),
  );
  for (const id of [
    "bedroom",
    "agteam",
    "zonax",
    "aggressive-zone",
    "battleforce",
    "red-skillers",
    "black-birds",
    "rivals",
    "rivals-srcds",
    "jzd",
    "lamateam",
    "vcielka",
    "vega",
    "noobstyle",
    "zaparit",
    "gamers-germany",
    "fakaheda",
    "tweakgaming",
  ]) {
    assert.ok(rows.includes(id), id);
  }
  for (const row of historyNetworkRows) {
    assert.ok(["main", "branch"].includes(row.lane));
    assert.ok(row.context);
  }
  for (const id of ["the-public", "noaco"]) {
    assert.ok(!historyNodes.some((item) => item.id === id));
    assert.ok(!historyEvents.some((item) => item.nodeIds.includes(id)));
    assert.ok(!historyLinks.some((item) => item.from === id || item.to === id));
  }
  assert.ok(
    !historyEvents.some((item) => item.id === "the-public-retrospective"),
  );
});

test("bedroom origin, AGT contribution and AGT/ZonaX merger are separate claims", () => {
  assert.equal(event("bedroom-origin").year, 2006);
  assert.match(event("bedroom-origin").account, /public bedroom-hosted/);
  assert.match(node("bedroom").period, /Around 2006/);
  assert.equal(event("agt-join-code").year, 2008);
  assert.match(
    event("agt-join-code").account,
    /maintained.*2008 to the present/,
  );
  assert.match(node("agteam").period, /community launch unknown/);
  assert.match(
    link("agteam", "zonax", "code-maintenance").account,
    /separate parallel communities.*received.*codebase/,
  );
  link("agteam", "zonax", "parallel");
  for (const id of ["agteam", "zonax"]) {
    const merger = link(id, "aggressive-zone", "merge");
    assert.match(merger.period, /2013–14.*approximate/);
    assert.deepEqual(merger.sources, []);
  }
  link("bedroom", "agteam", "participant-move");
  const serverMerge = link("bedroom", "agteam", "merge");
  assert.match(serverMerge.period, /2008.*exact date unknown/);
  assert.match(serverMerge.account, /public CS:S server merged into AGT/);
  assert.match(serverMerge.account, /separate from his participant move/);
  assert.match(
    serverMerge.account,
    /not evidence of a legal ownership transfer/,
  );
  assert.deepEqual(serverMerge.sources, []);
  assert.match(serverMerge.provenance, /oral account/);
  const mergeEvent = event("bedroom-agt-server-merge");
  assert.equal(mergeEvent.year, 2008);
  assert.deepEqual(mergeEvent.nodeIds, ["bedroom", "agteam"]);
  assert.match(mergeEvent.account, /merged into AGT when Muso joined in 2008/);
  assert.match(mergeEvent.account, /no legal ownership transfer is inferred/);
  assert.deepEqual(mergeEvent.sources, []);
  assert.match(mergeEvent.provenance, /oral account/);
});

test("tracker captures are identity observations, never founding or transition evidence", () => {
  for (const [id, date, identity] of [
    ["agteam-name-2009", "30 Mar 2009", "agt.4game.cz"],
    ["agteam-name-2012", "14 Jan 2012", "agteam.4game.cz"],
    ["agteam-name-2013", "23 Mar 2013", "agteam.cz"],
    ["aggressive-zone-name-2014", "10 Aug 2014", "AggressiveZone.com"],
  ]) {
    const snapshot = event(id);
    assert.equal(snapshot.dateLabel, date);
    assert.equal(snapshot.relationship, "identity-observation");
    assert.ok(snapshot.account.includes(identity));
    assert.match(
      snapshot.account,
      /point-in-time identity observation, not proof/,
    );
    assert.match(
      snapshot.sources[0].url,
      /^https:\/\/web\.archive\.org\/web\/\d{14}/,
    );
    assert.ok(
      !historyLinks.some((item) =>
        item.sources.some((source) => source.url === snapshot.sources[0].url),
      ),
    );
  }
  assert.match(
    event("agteam-name-2009").account,
    /15 July 2008.*not a server start/,
  );
  assert.match(
    event("agteam-site-2011").account,
    /18 May 2011.*capture date is 25 May/,
  );
});

test("Battleforce joining and closure remain oral claims, separate from dated addresses", () => {
  const joining = link("aggressive-zone", "battleforce", "community-join");
  assert.match(joining.period, /Sep 2014/);
  assert.match(
    joining.account,
    /organizational dispute, funding problems and lost IPs/,
  );
  assert.match(joining.account, /discontinued as Muso left the head role/);
  assert.match(joining.account, /exact closure date is unknown/);
  assert.deepEqual(joining.sources, []);
  const addresses = event("battleforce-addresses");
  assert.equal(addresses.dateLabel, "21 Sep 2014");
  assert.match(addresses.sources[0].url, /141058918492392685$/);
  assert.match(
    event("aggressive-zone-group").account,
    /No earlier server origin/,
  );
  assert.equal(event("aggressive-zone-group").dateLabel, "12 Nov 2013");
});

test("independent rivals combine into one Rivals, not a direct Battleforce rename", () => {
  assert.match(
    node("red-skillers").summary,
    /independent rival.*copying servers and bans/i,
  );
  assert.match(
    node("red-skillers").summary,
    /first merged into Black Birds.*later merged into Rivals/,
  );
  assert.match(
    node("red-skillers").summary,
    /reopened later and merged into JZD/,
  );
  link("aggressive-zone", "red-skillers", "rival");
  link("battleforce", "red-skillers", "participant-move");
  assert.match(
    event("rivals-merge").account,
    /Muso improved Black Birds.*trimmed customized base.*Noaco/,
  );
  assert.match(
    event("rivals-merge").account,
    /Red Skillers first merged into Black Birds/,
  );
  assert.match(
    event("rivals-merge").account,
    /one Rivals.cz community\/server.*neither remained separate/,
  );
  assert.equal(event("rivals-merge").year, 2015);
  assert.match(
    link("red-skillers", "black-birds", "merge").period,
    /Undated.*sequence recalled, not dated/,
  );
  assert.match(
    link("black-birds", "rivals", "merge").period,
    /2015.*approximate/,
  );
  assert.ok(
    !historyLinks.some(
      (item) => item.from === "battleforce" && item.to === "rivals",
    ),
  );
  assert.equal(
    link("aggressive-zone", "rivals", "community-reference").kind,
    "community-reference",
  );
  assert.match(
    event("rivals-group-founded").account,
    /Steam group's foundation date only/,
  );
  assert.match(
    event("rivals-continuity").provenance,
    /not independently retrieved/,
  );
});

test("Red Skillers reopens and merges into JZD, which joins LaMaTeAm", () => {
  const reopen = event("red-skillers-reopen");
  assert.equal(reopen.year, null);
  assert.match(reopen.dateLabel, /Undated/);
  assert.match(reopen.account, /reopened later and merged into JZD/);
  assert.deepEqual(reopen.nodeIds, ["red-skillers", "jzd", "lamateam"]);
  assert.deepEqual(reopen.sources, []);
  assert.match(reopen.provenance, /oral account/);
  const jzdJoin = event("jzd-joins-main");
  assert.equal(jzdJoin.year, null);
  assert.match(jzdJoin.dateLabel, /Undated/);
  assert.match(jzdJoin.account, /JZD.*merged into.*main LaMaTeAm line/);
  assert.deepEqual(jzdJoin.nodeIds, ["jzd", "lamateam"]);
  assert.deepEqual(jzdJoin.sources, []);
  assert.match(jzdJoin.provenance, /oral account/);
  const redToJzd = link("red-skillers", "jzd", "merge");
  assert.match(redToJzd.period, /Undated.*sequence recalled, not dated/);
  assert.match(redToJzd.account, /reopened later and merged into JZD/);
  assert.match(redToJzd.account, /not independently verified/);
  assert.deepEqual(redToJzd.sources, []);
  assert.match(redToJzd.provenance, /oral account/);
  assert.ok(
    !historyLinks.some(
      (item) => item.from === "red-skillers" && item.to === "rivals",
    ),
  );
});

test("public code release, repository creation and gradual shutdown are not brand launch dates", () => {
  link("rivals", "rivals-srcds", "code-release");
  const creation = event("rivals-repository-created");
  assert.equal(creation.year, 2018);
  assert.equal(creation.dateLabel, "4 Apr 2018 · repository creation");
  assert.match(
    creation.account,
    /not an exact public release or server shutdown/,
  );
  assert.match(
    creation.account,
    /2008.*code core under another name, not a 2008 Rivals brand launch/,
  );
  assert.match(
    event("rivals-release").account,
    /consolidate the declining CZ\/SK community/,
  );
  assert.match(
    event("rivals-release").account,
    /gradually shut down as credits ran out/,
  );
  assert.equal(event("rivals-release").year, null);
});

test("Rivals tracker listing is a dated observation, not a launch date", () => {
  const snapshot = event("rivals-server-snapshot");
  assert.equal(snapshot.dateLabel, "17 Oct 2015 · monitoring snapshot");
  assert.equal(snapshot.relationship, "identity-observation");
  assert.match(snapshot.account, /point-in-time server observation/);
  assert.match(snapshot.account, /not evidence of the server's launch date/);
  assert.match(snapshot.sources[0].url, /web\.archive\.org\/web\/20151017/);
  assert.deepEqual(snapshot.nodeIds, ["rivals"]);
});

test("JZD fork is distinct from server continuation and restored maintained code", () => {
  assert.match(
    link("rivals-srcds", "jzd", "fork").account,
    /half or more.*not maintained/,
  );
  const continuation = link("jzd", "lamateam", "server-continuation");
  assert.match(continuation.period, /Undated/);
  assert.match(continuation.account, /same server\/community continuation/);
  assert.match(
    link("rivals-srcds", "lamateam", "code-maintenance").account,
    /switched back to his own maintained code/,
  );
  assert.match(event("jzd-continuation").account, /exact date is unknown/);
  assert.ok(
    !historyLinks.some(
      (item) => item.to === "lamateam" && item.kind === "merge",
    ),
  );
});

test("participant joins and independent partnerships never become ownership mergers", () => {
  for (const id of ["vcielka", "vega", "noobstyle", "zaparit"]) {
    const moves = historyLinks.filter(
      (item) => item.from === id && item.kind !== "parallel",
    );
    assert.ok(moves.length);
    assert.ok(moves.every((item) => item.kind === "participant-move"));
  }
  assert.match(node("vcielka").summary, /around the AGT\/ZonaX merge/);
  assert.match(node("vega").summary, /Zly Kocur ran alongside Aggressive Zone/);
  link("vega", "aggressive-zone", "parallel");
  assert.match(node("noobstyle").summary, /ended in 2016/i);
  assert.match(node("noobstyle").summary, /players joined Rivals\.cz/i);
  const noobstyleMove = link("noobstyle", "rivals", "participant-move");
  assert.match(noobstyleMove.account, /exact player-movement date is unknown/i);
  assert.match(noobstyleMove.period, /After closure in 2016.*date unknown/);
  assert.match(
    historyNetworkRows.find((row) => row.id === "noobstyle").context,
    /Ended 2016.*later joined Rivals\.cz.*move date unknown/,
  );
  assert.equal(noobstyleMove.targetScope, undefined);
  assert.equal(event("noobstyle-closure").year, 2016);
  assert.match(
    event("noobstyle-closure").account,
    /players later joined Rivals\.cz/,
  );
  assert.match(
    link("zaparit", "battleforce", "participant-move").period,
    /Undated/,
  );
  assert.match(
    link("zaparit", "battleforce", "participant-move").account,
    /Aggressive Zone\/Battleforce line.*date is unknown/i,
  );
  assert.match(
    link("zaparit", "battleforce", "participant-move").account,
    /After Zaparit\.cz's servers ended.*players joined/,
  );
  assert.match(
    historyNetworkRows.find((row) => row.id === "zaparit").context,
    /Servers ended.*players joined AGZ\/Battleforce line.*date unknown/,
  );
  assert.match(
    node("zaparit").summary,
    /joined the Aggressive Zone\/Battleforce line/i,
  );
  link("agteam", "fakaheda", "partnership");
  link("aggressive-zone", "fakaheda", "partnership");
  link("aggressive-zone", "tweakgaming", "partnership");
  link("gamers-germany", "aggressive-zone", "partnership");
  assert.match(
    node("gamers-germany").summary,
    /remained independent.*GameME.*exchanged players/,
  );
  assert.match(
    node("tweakgaming").summary,
    /separate NL server maintained by the user.*Jailbreak/,
  );
});

test("aliases and scoped citations survive without invented tenure or old media claims", () => {
  for (const name of ["Crystall", "MAX_007"])
    assert.ok(
      historyNodes.some((item) => item.name === name && item.kind === "person"),
    );
  assert.deepEqual(
    historyAdmins.map((item) => item.name),
    ["Muso", "Zuzule", "crazy69"],
  );
  for (const admin of historyAdmins)
    assert.match(admin.period, /Join date unknown.*not established/);
  for (const item of [
    ...historyNodes,
    ...historyLinks,
    ...historyEvents,
    ...historyAdmins,
  ]) {
    for (const source of item.sources) {
      assert.ok(source.label);
      if (source.kind === "private-archive")
        assert.equal(source.url, undefined);
      else assert.equal(new URL(source.url).protocol, "https:");
      if (source.kind === "image") assert.fail("no historical images verified");
      if (source.kind === "video") {
        assert.equal(source.url, "https://www.youtube.com/watch?v=Zwn0kI4YuJQ");
        assert.match(source.label, /candidate/i);
      }
    }
  }
  const videoEvent = event("lamateam-video-candidate");
  assert.equal(videoEvent.year, null);
  assert.match(videoEvent.dateLabel, /exact publication date unknown/);
  assert.match(videoEvent.account, /not evidence about earlier server eras/);
  assert.equal(videoEvent.sources[0].kind, "video");
  assert.equal(historyMediaCandidates.length, 1);
  const candidate = historyMediaCandidates[0];
  assert.equal(candidate.url, "https://www.youtube.com/watch?v=Zwn0kI4YuJQ");
  assert.equal(candidate.title, "Counter strike Source LaMaTeAm Nightfever");
  assert.equal(candidate.channel, "Zuzulinka Zuzule");
  assert.equal(candidate.status, "recent-unverified");
  assert.equal(candidate.publishedAt, null);
  assert.equal(candidate.historicalProof, false);
  assert.match(
    candidate.note,
    /No verified old community-specific videos or screenshots/,
  );
});
