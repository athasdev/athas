import { isPathInsideTreeEntry } from "@/features/file-system/services/file-tree-utils";

/**
 * The entries an action on a selection applies to: each path once, and nothing that lies inside
 * a selected folder, since acting on the folder already covers it.
 */
export function withoutNestedEntries<T extends { path: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  });
  return unique.filter(
    (entry) =>
      !unique.some((other) => other !== entry && isPathInsideTreeEntry(entry.path, other.path)),
  );
}

/**
 * What a row's action applies to: the whole selection when the row is part of it, else that row
 * alone.
 */
export function getSelectionActionTargets<T extends { path: string }>(
  row: T,
  selection: readonly T[] | null | undefined,
): T[] {
  if (!selection || selection.length < 2 || !selection.some((entry) => entry.path === row.path)) {
    return [row];
  }
  return withoutNestedEntries(selection);
}
