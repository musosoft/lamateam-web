/** Public, read-only SourceBans adapter. Never forward visitor input upstream. */
export const SOURCEBANS_URL =
  "https://sourcebans.fakaheda.eu/sbans_336496/index.php?p=banlist";
const CACHE_KEY = "https://lamateam.eu/_internal/sourcebans-cache-v2";
const FRESH_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const RETRY_MS = 60_000;
const MAX_BYTES = 1_048_576;

export interface SourceBan {
  date: string;
  player: string;
  admin: string;
  length: string;
  steamId: string;
  reason: string;
  countryCode: string | null;
  flagUrl: string | null;
}

export interface BanList {
  bans: SourceBan[];
  total: number | null;
}

type Element = {
  tag: string;
  attrs: Record<string, string>;
  children: (Element | string)[];
};
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
};

function decode(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
    (entity, name: string) => {
      if (!name.startsWith("#")) return ENTITIES[name] ?? entity;
      const code =
        name[1]?.toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\uFFFD";
    },
  );
}

/** A bounded structural tokenizer, not a regex over nested table rows.
 * Upstream markup yields inert text and strictly allowlisted country flag URLs,
 * never raw HTML, scripts or arbitrary links. Unexpected structure fails closed.
 */
function parseHtml(html: string): Element {
  if (html.length > MAX_BYTES) throw new Error("SourceBans document too large");
  const root: Element = { tag: "root", attrs: {}, children: [] };
  const stack = [root];
  const tokens =
    /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</gi;
  let count = 0;
  for (const match of html.matchAll(tokens)) {
    if (++count > 50_000) throw new Error("SourceBans document too complex");
    const token = match[0];
    const parent = stack[stack.length - 1]!;
    if (token.startsWith("<!")) continue;
    if (!/^<\/?[a-z]/i.test(token)) {
      parent.children.push(token);
      continue;
    }
    const tag = /^<\/?([a-z][\w:-]*)/i.exec(token)![1]!.toLowerCase();
    if (token.startsWith("</")) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const node: Element = { tag, attrs: {}, children: [] };
    const attributes = token.slice(tag.length + 1, -1);
    for (const attr of attributes.matchAll(
      /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      node.attrs[attr[1]!.toLowerCase()] = decode(
        attr[2] ?? attr[3] ?? attr[4] ?? "",
      );
    }
    parent.children.push(node);
    if (!VOID_TAGS.has(tag) && !token.endsWith("/>")) stack.push(node);
    if (stack.length > 100)
      throw new Error("SourceBans document too deeply nested");
  }
  return root;
}

function children(node: Element, tag?: string): Element[] {
  return node.children.filter(
    (child): child is Element =>
      typeof child !== "string" && (!tag || child.tag === tag),
  );
}

function descendants(node: Element): Element[] {
  return children(node).flatMap((child) => [child, ...descendants(child)]);
}

function text(node: Element): string {
  if (["script", "style", "textarea"].includes(node.tag)) return "";
  return node.children
    .map((child) => (typeof child === "string" ? decode(child) : text(child)))
    .join(" ")
    .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
    .trim();
}

function rows(table: Element): Element[] {
  return children(table).flatMap((child) =>
    child.tag === "tr"
      ? [child]
      : ["tbody", "thead", "tfoot"].includes(child.tag)
        ? children(child, "tr")
        : [],
  );
}

// ISO 3166-1 alpha-2 only: unknown/placeholder flags must not invent a country.
const COUNTRY_CODES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

function countryFlag(
  cell: Element,
): Pick<SourceBan, "countryCode" | "flagUrl"> {
  const flags = descendants(cell).flatMap((node) => {
    if (node.tag !== "img") return [];
    // Accept only the observed SourceBans flag directory, never arbitrary URLs,
    // traversal, query strings, alternate origins or upstream event attributes.
    const match =
      /^(?:images\/country\/|\/sbans_336496\/images\/country\/|https:\/\/sourcebans\.fakaheda\.eu\/sbans_336496\/images\/country\/)([a-z]{2})\.gif$/.exec(
        node.attrs.src ?? "",
      );
    if (!match) return [];
    const code = match[1]!.toUpperCase();
    if (
      !COUNTRY_CODES.has(code) ||
      (node.attrs.alt && node.attrs.alt.toUpperCase() !== code)
    )
      return [];
    return [code];
  });
  if (flags.length !== 1) return { countryCode: null, flagUrl: null };
  const countryCode = flags[0]!;
  return {
    countryCode,
    flagUrl: new URL(
      `images/country/${countryCode.toLowerCase()}.gif`,
      SOURCEBANS_URL,
    ).href,
  };
}

export function parseSourceBans(html: string): BanList {
  if (html.length > MAX_BYTES) throw new Error("SourceBans document too large");
  // Remove raw-text bodies before tokenization, so script strings cannot spoof markup.
  const document = parseHtml(
    html.replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ""),
  );
  const all = descendants(document);
  const containers = all.filter(
    (node) => node.tag === "div" && node.attrs.id === "banlist",
  );
  if (containers.length !== 1) throw new Error("SourceBans ban list missing");
  const tables = children(containers[0]!, "table");
  if (tables.length !== 1) throw new Error("SourceBans ban table missing");
  const listRows = rows(tables[0]!);
  const header = listRows[0];
  const headings = header ? children(header).map(text) : [];
  if (headings.join("|") !== "MOD/Country|Date|Player|Admin|Length") {
    throw new Error("SourceBans columns changed");
  }
  const bans: SourceBan[] = [];
  for (let index = 1; index < listRows.length; index++) {
    const row = listRows[index]!;
    if (!(row.attrs.class ?? "").split(/\s+/).includes("opener")) {
      if (
        listRows.length === 2 &&
        /\bno bans (?:found|in (?:the )?database)\b/i.test(text(row))
      )
        continue;
      throw new Error("SourceBans unexpected ban row");
    }
    const cells = children(row, "td");
    if (cells.length !== 5) throw new Error("SourceBans ban columns changed");
    const detailRow = listRows[++index];
    const details = detailRow
      ? descendants(detailRow).filter((node) => node.tag === "table")
      : [];
    if (details.length !== 1) throw new Error("SourceBans ban details missing");
    const fields = new Map(
      rows(details[0]!).flatMap((detail) => {
        const columns = children(detail, "td");
        return columns.length >= 2
          ? [[text(columns[0]!), text(columns[1]!)] as const]
          : [];
      }),
    );
    if (!fields.has("Steam ID") || !fields.has("Reason"))
      throw new Error("SourceBans detail columns changed");
    const ban = {
      date: text(cells[1]!),
      player: text(cells[2]!),
      admin: text(cells[3]!),
      length: text(cells[4]!),
      steamId: fields.get("Steam ID")!,
      reason: fields.get("Reason")!,
      ...countryFlag(cells[0]!),
    };
    if (
      !ban.date ||
      !ban.player ||
      !ban.length ||
      Object.values(ban).some(
        (value) => typeof value === "string" && value.length > 4096,
      )
    ) {
      throw new Error("SourceBans invalid ban row");
    }
    bans.push(ban);
    if (bans.length > 30) throw new Error("SourceBans unexpected page size");
  }
  const nav = all
    .filter((node) => node.attrs.id === "banlist-nav")
    .map(text)
    .join(" ");
  const totalMatch = /Total Bans:\s*(\d+)/i.exec(nav);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  if (
    !bans.length &&
    total !== 0 &&
    !/\bno bans (?:found|in (?:the )?database)\b/i.test(text(tables[0]!))
  ) {
    throw new Error("SourceBans empty table not recognized");
  }
  return { bans, total };
}

interface CacheStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<unknown>;
}
interface Snapshot {
  data: BanList | null;
  fetchedAt: number;
  retryAt: number;
}
export interface BanListResult {
  data: BanList | null;
  fetchedAt: number | null;
  stale: boolean;
}

async function readHtml(response: Response): Promise<string> {
  if (
    !response.ok ||
    !/\btext\/html\b/i.test(response.headers.get("content-type") ?? "")
  ) {
    throw new Error("SourceBans HTTP error");
  }
  if (
    Number(response.headers.get("content-length")) > MAX_BYTES ||
    !response.body
  ) {
    throw new Error("SourceBans response invalid");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("SourceBans response too large");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed-key edge cache, one in-flight refresh per isolate, five-minute refresh
 * interval and one-minute negative caching. Stale data is retained for at most
 * one hour. Cache API is per-colo; this is not a global distributed lock.
 */
export function createSourceBansLoader(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    cache?: () => CacheStore | undefined;
  } = {},
) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache =
    options.cache ??
    (() =>
      (globalThis as typeof globalThis & { caches?: { default?: CacheStore } })
        .caches?.default);
  let snapshot: Snapshot | undefined;
  let pending: Promise<BanListResult> | undefined;
  function result(value: Snapshot): BanListResult {
    const usable = value.data !== null && now() - value.fetchedAt < STALE_MS;
    return {
      data: usable ? value.data : null,
      fetchedAt: usable ? value.fetchedAt : null,
      stale: usable && now() - value.fetchedAt >= FRESH_MS,
    };
  }
  async function load(): Promise<BanListResult> {
    let store: CacheStore | undefined;
    try {
      store = cache();
    } catch {
      /* Local runtime may not have Cache API. */
    }
    const key = new Request(CACHE_KEY);
    if (!snapshot || now() >= snapshot.retryAt) {
      try {
        const cached = await store?.match(key);
        if (cached) {
          const candidate = (await cached.json()) as Snapshot;
          if (
            Number.isFinite(candidate.fetchedAt) &&
            Number.isFinite(candidate.retryAt) &&
            candidate.fetchedAt <= now() &&
            candidate.retryAt <= now() + FRESH_MS &&
            (candidate.data === null
              ? candidate.retryAt > now()
              : now() - candidate.fetchedAt < STALE_MS &&
                Array.isArray(candidate.data?.bans))
          ) {
            snapshot = candidate;
          }
        }
      } catch {
        /* Cache failure must not break the page. */
      }
    }
    if (snapshot && now() < snapshot.retryAt) return result(snapshot);
    try {
      const response = await fetcher(SOURCEBANS_URL, {
        headers: { Accept: "text/html" },
        // workerd rejects "error"; readHtml rejects 3xx without following them.
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      const data = parseSourceBans(await readHtml(response));
      snapshot = { data, fetchedAt: now(), retryAt: now() + FRESH_MS };
    } catch {
      const previous =
        snapshot && now() - snapshot.fetchedAt < STALE_MS
          ? snapshot
          : undefined;
      snapshot = {
        data: previous?.data ?? null,
        fetchedAt: previous?.fetchedAt ?? 0,
        retryAt: now() + RETRY_MS,
      };
    }
    try {
      await store?.put(
        key,
        new Response(JSON.stringify(snapshot), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${STALE_MS / 1000}`,
          },
        }),
      );
    } catch {
      /* Per-isolate cache still bounds refreshes if edge storage fails. */
    }
    return result(snapshot);
  }
  return (): Promise<BanListResult> => {
    if (snapshot && now() < snapshot.retryAt)
      return Promise.resolve(result(snapshot));
    if (!pending)
      pending = load().finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

export const loadSourceBans = createSourceBansLoader();
