/** Server-side authorization only; accept canonical public individual Steam64 IDs. */
export function isCheckAdmin(
  steamID: string | null | undefined,
  allowlist: string | undefined,
): boolean {
  const canonical = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length === 17 &&
    /^\d{17}$/.test(value) &&
    BigInt(value) > 76561197960265728n &&
    BigInt(value) <= 76561202255233023n;
  if (!canonical(steamID) || typeof allowlist !== "string" || !allowlist)
    return false;
  const ids = allowlist.split(",");
  // Validate the entire configuration, including entries after a matching ID.
  if (!ids.every(canonical) || new Set(ids).size !== ids.length) return false;
  return ids.includes(steamID);
}
