export type MizanSummary = {
  state: "clear" | "review" | "pending" | "unavailable";
  queriedAt: number | null;
};

export function mizanBadge(value: unknown) {
  const item = value as Partial<MizanSummary> | null;
  const state =
    item &&
    ["clear", "review", "pending", "unavailable"].includes(item.state ?? "")
      ? item.state!
      : "unavailable";
  const labels = {
    clear: ["✓", "Clear — no Mizan leads reported; not proof of innocence"],
    review: ["⚠", "Review — Mizan lead; verify before any action"],
    pending: ["…", "Pending — Mizan check not completed; no conclusion"],
    unavailable: ["?", "Unavailable — Mizan check failed; no conclusion"],
  };
  const [icon, label] = labels[state];
  return {
    state,
    icon,
    label,
    queriedAt:
      typeof item?.queriedAt === "number" &&
      Number.isSafeInteger(item.queriedAt) &&
      item.queriedAt > 0
        ? item.queriedAt
        : null,
  };
}
