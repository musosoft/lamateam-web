// src/pages/api/steamGroup.ts
import type { APIRoute } from "astro";

const GROUP_ID_RE = /^\d{1,20}$/;
const TAG_RE =
  /<span\s+[^>]*class\s*=\s*(["'])[^"']*\bgrouppage_header_abbrev\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i;
const MAX_BODY_CHARS = 256 * 1024; // 256 KB bound on response text
const MAX_TAG_LEN = 15;
const FETCH_TIMEOUT_MS = 6000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; LamateamBot/1.0; +https://lamateam.eu)";

function json(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Decode common HTML entities without external dependencies. */
function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00A0",
    copy: "\u00A9",
    reg: "\u00AE",
    trade: "\u2122",
  };

  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = parseInt(body.slice(2), 16);
        return Number.isNaN(code) || code > 0x10ffff
          ? match
          : String.fromCodePoint(code);
      }
      if (lower.startsWith("#")) {
        const code = parseInt(body.slice(1), 10);
        return Number.isNaN(code) || code > 0x10ffff
          ? match
          : String.fromCodePoint(code);
      }
      return named[lower] ?? match;
    },
  );
}

/** Decode entities, normalize whitespace, strip unsafe chars, and cap length. */
function sanitizeTag(input: string): string {
  const decoded = decodeHtmlEntities(input);
  const collapsed = decoded.replace(/[\s\u00A0]+/g, " ").trim();
  const cleaned = collapsed.replace(/[\u0000-\u001F\u007F"\\;]/g, "").trim();
  return cleaned.slice(0, MAX_TAG_LEN).trim();
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const groupIds = url.searchParams.getAll("groupid");

  // Reject arrays, missing, or non-digit group ids.
  if (groupIds.length !== 1 || !GROUP_ID_RE.test(groupIds[0])) {
    return json({ error: "Invalid request" }, 400);
  }

  const groupid = groupIds[0];
  const groupUrl = `https://steamcommunity.com/gid/${groupid}`;

  let response: Response;
  try {
    response = await fetch(groupUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Error fetching Steam group page:", error);
    return json({ error: "Upstream fetch failed" }, 502);
  }

  if (!response.ok) {
    return json({ error: "Upstream returned non-OK status" }, 502);
  }

  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    console.error("Error reading Steam group page:", error);
    return json({ error: "Upstream read failed" }, 502);
  }

  if (html.length > MAX_BODY_CHARS) {
    return json({ error: "Upstream response too large" }, 502);
  }

  const match = TAG_RE.exec(html);
  if (!match) {
    return json({ error: "Group tag not found" }, 404);
  }

  const tag = sanitizeTag(match[2]);
  if (!tag) {
    return json({ error: "Group tag not found" }, 404);
  }

  return json({ tag, groupid }, 200, {
    "Cache-Control": "public, max-age=3600",
  });
};
