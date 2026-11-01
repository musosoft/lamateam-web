import { safeSourceUrl } from "./safety.mjs";

type Timestamp = string | number;
type Player = {
  communityId: string;
  displayName?: string | null;
  lastSeen: Timestamp;
};
type Snapshot = {
  observedAt: Timestamp | null;
  players: Player[];
};
type SearchResult = {
  queriedAt: Timestamp;
  profileUrl: string;
  steamId64: string;
  cheater: boolean;
  trolling: boolean;
  bans: {
    total: number;
    active: number;
    sources: number;
    conduct: number;
    categories: string[];
    games: string[];
    lastAt: string | null;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isTime = (value: unknown): value is Timestamp =>
  (typeof value === "string" || typeof value === "number") &&
  Number.isFinite(new Date(value).getTime());
const isPlayer = (value: unknown): value is Player =>
  isRecord(value) &&
  typeof value.communityId === "string" &&
  /^7656119\d{10}$/.test(value.communityId) &&
  (value.displayName === undefined ||
    value.displayName === null ||
    typeof value.displayName === "string") &&
  isTime(value.lastSeen);
const isSnapshot = (value: unknown): value is Snapshot =>
  isRecord(value) &&
  Array.isArray(value.players) &&
  (isTime(value.observedAt) ||
    (value.observedAt === null && value.players.length === 0)) &&
  value.players.every(isPlayer);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isLabels = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 128 &&
  value.every(
    (label) =>
      typeof label === "string" &&
      label.trim().length > 0 &&
      label.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(label),
  );
const isSearchResult = (value: unknown): value is SearchResult => {
  if (!isRecord(value) || !isRecord(value.bans)) return false;
  const bans = value.bans;
  return (
    isTime(value.queriedAt) &&
    typeof value.profileUrl === "string" &&
    typeof value.steamId64 === "string" &&
    /^\d{17}$/.test(value.steamId64) &&
    typeof value.cheater === "boolean" &&
    typeof value.trolling === "boolean" &&
    isCount(bans.total) &&
    isCount(bans.active) &&
    bans.active <= bans.total &&
    isCount(bans.sources) &&
    isCount(bans.conduct) &&
    isLabels(bans.categories) &&
    isLabels(bans.games) &&
    (bans.lastAt === null ||
      (typeof bans.lastAt === "string" && isTime(bans.lastAt)))
  );
};

class RequestFailure extends Error {
  status: number;
  constructor(status: number) {
    super("Request unavailable");
    this.status = status;
  }
}

function initCheck() {
  const candidate = document.querySelector<HTMLElement>("[data-check-page]");
  if (!candidate || candidate.dataset.initialized) return;
  const root: HTMLElement = candidate;
  root.dataset.initialized = "true";
  const life = new AbortController();
  const { signal } = life;
  const get = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing check page element: ${selector}`);
    return element;
  };
  const refresh = get<HTMLButtonElement>("[data-check-refresh]");
  const playerStatus = get("[data-check-players-status]");
  const observed = get("[data-check-observed]");
  const stale = get("[data-check-stale]");
  const playerList = get<HTMLUListElement>("[data-check-players]");
  let snapshot: Snapshot | null = null;
  let active: ReturnType<typeof createResult> | null = null;
  let searchController: AbortController | null = null;
  let searchVersion = 0;
  let refreshing = false;
  let snapshotFailed = false;
  let queriedAt: Timestamp | null = null;

  async function request(
    path: string,
    body?: object,
    searchSignal?: AbortSignal,
  ) {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([
        signal,
        ...(searchSignal ? [searchSignal] : []),
        AbortSignal.timeout(30_000),
      ]),
    });
    if (!response.ok) throw new RequestFailure(response.status);
    return response;
  }

  function formatTime(value: Timestamp | undefined) {
    return isTime(value)
      ? new Date(value).toLocaleString(document.documentElement.lang || "en")
      : "Time unavailable";
  }

  function updateStaleness() {
    stale.hidden =
      !snapshot ||
      (!snapshotFailed &&
        (snapshot.observedAt === null ||
          Date.now() - new Date(snapshot.observedAt).getTime() <= 120_000));
    if (active)
      active.get("[data-check-result-stale]").hidden =
        queriedAt === null ||
        Date.now() - new Date(queriedAt).getTime() <= 120_000;
  }

  function createResult(button: HTMLButtonElement, index: number) {
    const panel = document.createElement("div");
    panel.className = "check-results";
    panel.id = `check-player-result-${index}`;
    panel.hidden = true;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", button.id);
    panel.setAttribute("aria-busy", "false");
    button.setAttribute("aria-controls", panel.id);
    button.setAttribute("aria-expanded", "false");
    const nodes = new Map<string, HTMLElement>();
    function add(
      tag: string,
      key: string,
      parent: HTMLElement = panel,
      text = "",
    ) {
      const node = document.createElement(tag);
      node.textContent = text;
      node.setAttribute(`data-check-${key}`, "");
      nodes.set(`[data-check-${key}]`, node);
      parent.appendChild(node);
      return node;
    }
    const status = add("p", "search-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const content = add("div", "result-content");
    content.hidden = true;
    add("p", "query-time", content);
    const old = add(
      "p",
      "result-stale",
      content,
      "Result is over two minutes old. Reopen to check again.",
    );
    old.hidden = true;
    const details = document.createElement("dl");
    content.appendChild(details);
    for (const [key, label] of [
      ["bans-active", "Active bans"],
      ["bans-total", "Total bans"],
      ["bans-sources", "Sources"],
      ["bans-conduct", "Conduct bans"],
      ["cheater", "Cheater"],
      ["trolling", "Trolling"],
      ["categories", "Categories"],
      ["games", "Games"],
      ["last-ban", "Last ban time"],
    ]) {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      group.appendChild(term);
      add("dd", key, group);
      details.appendChild(group);
    }
    add("a", "profile", content, "Verify on Mizan ↗").hidden = true;
    add(
      "p",
      "profile-unavailable",
      content,
      "Safe Mizan profile link unavailable.",
    ).hidden = true;
    return {
      panel,
      button,
      get: <T extends HTMLElement = HTMLElement>(key: string) =>
        nodes.get(key) as T,
    };
  }

  function closeResult() {
    searchController?.abort();
    searchVersion++;
    if (active) {
      active.panel.hidden = true;
      active.panel.setAttribute("aria-busy", "false");
      active.button.setAttribute("aria-expanded", "false");
    }
    active = null;
    queriedAt = null;
  }

  function playerIdentity(player: Player) {
    const name = player.displayName?.trim();
    return name ? `${name} (${player.communityId})` : player.communityId;
  }

  function renderIdentity(container: HTMLElement, player: Player) {
    const displayName = player.displayName?.trim();
    const name = document.createElement("strong");
    name.textContent = displayName || player.communityId;
    name.translate = false;
    container.replaceChildren(name);
    if (displayName) {
      const identifier = document.createElement("small");
      identifier.textContent = player.communityId;
      identifier.translate = false;
      container.appendChild(identifier);
    }
  }

  function renderPlayers(players: Player[]) {
    closeResult();
    playerList.replaceChildren();
    for (const [index, player] of players.entries()) {
      const row = document.createElement("li");
      const info = document.createElement("span");
      info.className = "check-player-info";
      renderIdentity(info, player);
      const time = document.createElement("small");
      time.textContent = `Last seen: ${formatTime(player.lastSeen)}`;
      info.appendChild(time);
      const button = document.createElement("button");
      button.type = "button";
      button.id = `check-player-toggle-${index}`;
      button.className = "check-player-toggle";
      button.setAttribute(
        "aria-label",
        `Mizan results for ${playerIdentity(player)}`,
      );
      button.appendChild(info);
      const indicator = document.createElement("span");
      indicator.textContent = "Mizan ▾";
      indicator.setAttribute("aria-hidden", "true");
      button.appendChild(indicator);
      const entry = createResult(button, index);
      button.addEventListener(
        "click",
        () => {
          const wasOpen = active === entry;
          closeResult();
          if (wasOpen) return;
          active = entry;
          entry.panel.hidden = false;
          button.setAttribute("aria-expanded", "true");
          void research(player, entry);
        },
        { signal },
      );
      row.appendChild(button);
      row.appendChild(entry.panel);
      playerList.appendChild(row);
    }
  }

  async function loadPlayers() {
    if (refreshing) return;
    refreshing = true;
    refresh.disabled = true;
    playerStatus.textContent = "Loading identities…";
    playerList.setAttribute("aria-busy", "true");
    try {
      const value: unknown = await (await request("/api/check/players")).json();
      if (signal.aborted) return;
      if (!isSnapshot(value)) throw new Error("Unexpected player response");
      snapshot = {
        observedAt: value.observedAt,
        players: [...value.players]
          .sort(
            (a, b) =>
              new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
          )
          .slice(0, 30),
      };
      snapshotFailed = false;
      renderPlayers(snapshot.players);
      observed.textContent =
        value.observedAt === null
          ? "No recent observations available."
          : `List updated: ${formatTime(value.observedAt)}`;
      updateStaleness();
      playerStatus.textContent = snapshot.players.length
        ? `${snapshot.players.length} recent ${snapshot.players.length === 1 ? "identity" : "identities"}.`
        : "No recent MOTD identities yet. Refresh after a player opens the MOTD.";
    } catch (error) {
      if (signal.aborted) return;
      playerStatus.textContent =
        error instanceof RequestFailure && error.status === 429
          ? "Too many requests. Wait a minute before refreshing."
          : "Could not load recent identities. Try refreshing.";
      snapshotFailed = true;
      if (snapshot) stale.hidden = false;
      else observed.textContent = "Snapshot unavailable";
    } finally {
      refreshing = false;
      refresh.disabled = false;
      playerList.setAttribute("aria-busy", "false");
    }
  }

  async function research(
    player: Player,
    entry: ReturnType<typeof createResult>,
  ) {
    const version = searchVersion;
    searchController = new AbortController();
    const get = entry.get;
    const results = entry.panel;
    const searchStatus = get("[data-check-search-status]");
    const resultContent = get("[data-check-result-content]");
    const started = Date.now();
    resultContent.hidden = true;
    results.setAttribute("aria-busy", "true");
    searchStatus.textContent = `Checking Mizan for ${playerIdentity(player)}…`;
    try {
      const value: unknown = await (
        await request(
          "/api/check/search",
          { communityId: player.communityId },
          searchController.signal,
        )
      ).json();
      if (signal.aborted || version !== searchVersion) return;
      if (!isSearchResult(value) || value.steamId64 !== player.communityId)
        throw new Error("Unexpected ban check response");
      queriedAt = value.queriedAt;
      get("[data-check-query-time]").textContent =
        `Query completed: ${formatTime(value.queriedAt)} · ${((Date.now() - started) / 1000).toFixed(1)} s`;
      for (const key of ["active", "total", "sources", "conduct"] as const) {
        get(`[data-check-bans-${key}]`).textContent = String(value.bans[key]);
      }
      for (const key of ["cheater", "trolling"] as const) {
        const flag = get(`[data-check-${key}]`);
        flag.textContent = value[key]
          ? "Flagged by Mizan"
          : "Not flagged by Mizan";
        flag.dataset.flagged = String(value[key]);
      }
      get("[data-check-categories]").textContent = value.bans.categories.length
        ? value.bans.categories.join(", ")
        : "None reported by Mizan";
      get("[data-check-games]").textContent = value.bans.games.length
        ? value.bans.games.join(", ")
        : "None reported by Mizan";
      get("[data-check-last-ban]").textContent =
        value.bans.lastAt === null
          ? "No last ban time reported"
          : formatTime(value.bans.lastAt);
      const profile = get<HTMLAnchorElement>("[data-check-profile]");
      const canonical = `https://mizan.ac/players/steam/${player.communityId}`;
      const safeProfile = safeSourceUrl(value.profileUrl) === canonical;
      profile.removeAttribute("href");
      profile.target = "_blank";
      profile.rel = "noopener noreferrer";
      profile.hidden = !safeProfile;
      if (safeProfile) profile.href = canonical;
      get("[data-check-profile-unavailable]").hidden = safeProfile;
      updateStaleness();
      resultContent.hidden = false;
      searchStatus.textContent =
        value.bans.total === 0 && !value.cheater && !value.trolling
          ? "No bans or flags reported by Mizan. This is not proof of innocence."
          : "Bans or flags reported. Verify on Mizan before acting.";
    } catch (error) {
      if (signal.aborted || version !== searchVersion) return;
      searchStatus.textContent =
        error instanceof RequestFailure && error.status === 429
          ? "Mizan rate limit reached. Wait a minute, then retry. No conclusion can be drawn."
          : "Mizan check unavailable or response invalid. Reopen to retry. No conclusion can be drawn.";
    } finally {
      if (version === searchVersion) results.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => void loadPlayers(), { signal });
  const timer = window.setInterval(updateStaleness, 15_000);
  document.addEventListener(
    "astro:before-swap",
    () => {
      life.abort();
      window.clearInterval(timer);
    },
    { once: true, signal },
  );
  void loadPlayers();
}

document.addEventListener("astro:page-load", initCheck);
