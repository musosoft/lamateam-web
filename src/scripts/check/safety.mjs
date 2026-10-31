/** This is only a public search query, never an authorization check. */
export function googleSearchUrl(communityId) {
  const url = new URL("https://www.google.com/search");
  const raw = typeof communityId === "string" ? communityId.trim() : "";
  let query = raw.slice(0, 128);
  if (/^7656119\d{10}$/.test(raw)) {
    const account = BigInt(raw) - 76561197960265728n;
    if (account >= 0n && account <= 4294967295n) {
      query = `"${raw}" OR "STEAM_0:${account % 2n}:${account / 2n}" OR "[U:1:${account}]"`;
    }
  }
  url.searchParams.set("q", query || "Steam player");
  return url.href;
}

export function safeSourceUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
