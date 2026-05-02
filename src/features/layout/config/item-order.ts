export const HEADER_LEADING_ITEM_IDS = ["menu", "sidebar"] as const;
export const HEADER_TRAILING_ITEM_IDS = [
  "run-actions",
  "notifications",
  "ai-chat",
  "account",
] as const;
export const SIDEBAR_ACTIVITY_ITEM_IDS = [
  "files",
  "search",
  "git",
  "debugger",
  "github-prs",
] as const;
export const FOOTER_LEADING_ITEM_IDS = [
  "branch",
  "terminal",
  "diagnostics",
  "extensions",
  "updates",
] as const;
export const FOOTER_TRAILING_ITEM_IDS = [] as const;

export type HeaderLeadingItemId = (typeof HEADER_LEADING_ITEM_IDS)[number];
export type HeaderTrailingItemId = (typeof HEADER_TRAILING_ITEM_IDS)[number];
export type SidebarActivityItemId = (typeof SIDEBAR_ACTIVITY_ITEM_IDS)[number];
export type FooterLeadingItemId = (typeof FOOTER_LEADING_ITEM_IDS)[number];
export type FooterTrailingItemId = (typeof FOOTER_TRAILING_ITEM_IDS)[number];

export function normalizeItemOrder<T extends string>(
  persistedOrder: readonly T[] | undefined,
  defaultOrder: readonly T[],
): T[] {
  if (!persistedOrder || persistedOrder.length === 0) {
    return [...defaultOrder];
  }

  const allowedIds = new Set(defaultOrder);
  const seen = new Set<T>();
  const normalized: T[] = [];

  for (const id of persistedOrder) {
    if (!allowedIds.has(id) || seen.has(id)) {
      continue;
    }

    normalized.push(id);
    seen.add(id);
  }

  for (const id of defaultOrder) {
    if (!seen.has(id)) {
      normalized.push(id);
    }
  }

  return normalized;
}
