export const SIDEBAR_ACTIVITY_ITEM_IDS = [
  "files",
  "git",
  "github-prs",
  "views",
  "debugger",
  "databases",
  "docker",
  "extensions",
] as const;
export const GIT_SIDEBAR_TAB_IDS = ["changes", "history", "review"] as const;

export type SidebarActivityItemId = (typeof SIDEBAR_ACTIVITY_ITEM_IDS)[number];
export type GitSidebarTabId = (typeof GIT_SIDEBAR_TAB_IDS)[number];

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
