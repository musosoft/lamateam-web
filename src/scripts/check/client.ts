type Timestamp = string | number;
type Player = {
  communityId: string;
  displayName?: string | null;
  lastSeen: Timestamp;
};
type Snapshot = { observedAt: Timestamp | null; players: Player[] };

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

class RequestFailure extends Error {
  constructor(readonly status: number) {
    super("Request unavailable");
  }
}

function initCheck() {
  const root = document.querySelector<HTMLElement>("[data-check-page]");
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = "true";
  const life = new AbortController();
  const { signal } = life;
  const get = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing player list element: ${selector}`);
    return element;
  };
  const refresh = get<HTMLButtonElement>("[data-check-refresh]");
  const playerStatus = get("[data-check-players-status]");
  const observed = get("[data-check-observed]");
  const stale = get("[data-check-stale]");
  const playerList = get<HTMLUListElement>("[data-check-players]");
  let snapshot: Snapshot | null = null;
  let refreshing = false;
  let snapshotFailed = false;

  function formatTime(value: Timestamp) {
    return new Date(value).toLocaleString(
      document.documentElement.lang || "en",
    );
  }

  function updateStaleness() {
    stale.hidden =
      !snapshot ||
      (!snapshotFailed &&
        (snapshot.observedAt === null ||
          Date.now() - new Date(snapshot.observedAt).getTime() <= 120_000));
  }

  function renderPlayers(players: Player[]) {
    playerList.replaceChildren();
    for (const player of players) {
      const row = document.createElement("li");
      const info = document.createElement("div");
      info.className = "check-player-info";
      const name = document.createElement("strong");
      const displayName = player.displayName?.trim();
      name.textContent = displayName || player.communityId;
      name.translate = false;
      info.appendChild(name);
      if (displayName) {
        const identifier = document.createElement("small");
        identifier.textContent = player.communityId;
        identifier.translate = false;
        info.appendChild(identifier);
      }
      const time = document.createElement("small");
      time.textContent = `Last seen: ${formatTime(player.lastSeen)}`;
      info.appendChild(time);
      row.appendChild(info);
      playerList.appendChild(row);
    }
  }

  async function loadPlayers() {
    if (refreshing || signal.aborted) return;
    refreshing = true;
    refresh.disabled = true;
    playerStatus.textContent = "Loading players…";
    playerList.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/check/players", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new RequestFailure(response.status);
      const value: unknown = await response.json();
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
          : `Last updated: ${formatTime(value.observedAt)}`;
      updateStaleness();
      playerStatus.textContent = snapshot.players.length
        ? `${snapshot.players.length} recent ${snapshot.players.length === 1 ? "player" : "players"}.`
        : "No recent players yet.";
    } catch (error) {
      if (signal.aborted) return;
      playerStatus.textContent =
        error instanceof RequestFailure && error.status === 429
          ? "Too many requests. Wait a minute before refreshing."
          : "Could not load recent players. Try refreshing.";
      snapshotFailed = true;
      if (snapshot) stale.hidden = false;
      else observed.textContent = "List unavailable";
    } finally {
      refreshing = false;
      refresh.disabled = false;
      playerList.setAttribute("aria-busy", "false");
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
