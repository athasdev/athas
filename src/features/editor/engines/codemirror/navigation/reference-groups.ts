import type { LspLocation } from "./code-lens";

export interface ReferenceEntry {
  /** Position in the flattened, display-ordered list, for keyboard navigation. */
  index: number;
  filePath: string;
  location: LspLocation;
}

interface ReferenceGroup {
  filePath: string;
  fileName: string;
  directory: string;
  entries: ReferenceEntry[];
}

function splitPath(filePath: string) {
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return separator === -1
    ? { fileName: filePath, directory: "" }
    : { fileName: filePath.slice(separator + 1), directory: filePath.slice(0, separator) };
}

/** The file path of a location's URI, decoded the way `filePathFromUri` does; other schemes stay as they are. */
function locationPath(uri: string) {
  if (!uri.startsWith("file://")) return uri;
  try {
    const url = new URL(uri);
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") return `//${url.hostname}${path}`;
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return uri;
  }
}

/**
 * Reference locations grouped by file, the source file first and the rest by path, each group in
 * document order, with duplicate locations dropped.
 */
export function groupReferenceLocations(
  locations: readonly LspLocation[],
  sourceFilePath?: string,
): { groups: ReferenceGroup[]; entries: ReferenceEntry[] } {
  const byFile = new Map<string, LspLocation[]>();
  const seen = new Set<string>();
  for (const location of locations) {
    const filePath = locationPath(location.uri);
    const { start, end } = location.range;
    const key = `${filePath}:${start.line}:${start.character}:${end.line}:${end.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = byFile.get(filePath) ?? [];
    group.push(location);
    byFile.set(filePath, group);
  }

  const paths = Array.from(byFile.keys()).sort((a, b) => {
    if (a === sourceFilePath) return -1;
    if (b === sourceFilePath) return 1;
    return a.localeCompare(b);
  });

  const entries: ReferenceEntry[] = [];
  const groups = paths.map((filePath) => {
    const sorted = [...(byFile.get(filePath) ?? [])].sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    );
    const groupEntries = sorted.map((location) => {
      const entry = { index: entries.length, filePath, location };
      entries.push(entry);
      return entry;
    });
    return { filePath, ...splitPath(filePath), entries: groupEntries };
  });

  return { groups, entries };
}
