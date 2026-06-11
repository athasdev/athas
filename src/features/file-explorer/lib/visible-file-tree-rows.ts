import type { FileEntry } from "@/features/file-system/types/app.types";

export interface VisibleFileTreeRow {
  file: FileEntry;
  depth: number;
  isExpanded: boolean;
  displayName?: string;
}

export interface BuildVisibleFileTreeRowsOptions {
  compactFolders?: boolean;
}

export interface FilterFileTreeForSearchResult {
  files: FileEntry[];
  expandedPaths: Set<string>;
  matchedPaths: Set<string>;
  orderedMatchedPaths: string[];
  matchCount: number;
}

export interface FileTreeSearchHit {
  path: string;
}

function getCompactFolderChild(item: FileEntry): FileEntry | null {
  if (!item.isDir || item.isEditing || item.isRenaming || item.isNewItem || !item.children) {
    return null;
  }

  if (item.children.length !== 1) {
    return null;
  }

  const child = item.children[0];
  if (!child.isDir || child.isEditing || child.isRenaming || child.isNewItem) {
    return null;
  }

  return child;
}

export function buildVisibleFileTreeRows(
  files: FileEntry[],
  expandedPaths: ReadonlySet<string>,
  options: BuildVisibleFileTreeRowsOptions = {},
): VisibleFileTreeRow[] {
  const rows: VisibleFileTreeRow[] = [];
  const compactFolders = options.compactFolders === true;

  const walk = (items: FileEntry[], depth: number) => {
    for (const item of items) {
      let rowFile = item;
      const displayNameParts = [item.name];

      if (compactFolders) {
        while (expandedPaths.has(rowFile.path)) {
          const child = getCompactFolderChild(rowFile);
          if (!child) break;

          rowFile = child;
          displayNameParts.push(child.name);
        }
      }

      const isExpanded = rowFile.isDir && expandedPaths.has(rowFile.path);
      rows.push({
        file: rowFile,
        depth,
        isExpanded,
        displayName: displayNameParts.length > 1 ? displayNameParts.join("/") : undefined,
      });

      if (rowFile.isDir && isExpanded && rowFile.children) {
        walk(rowFile.children, depth + 1);
      }
    }
  };

  walk(files, 0);
  return rows;
}

function normalizeSearchPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/g, "");
}

export function filterFileTreeForFffHits(
  files: FileEntry[],
  hits: readonly FileTreeSearchHit[],
): FilterFileTreeForSearchResult {
  const expandedPaths = new Set<string>();
  const matchedPaths = new Set<string>();
  const hitPaths = hits.map((hit) => normalizeSearchPath(hit.path));
  const hitPathSet = new Set(hitPaths);
  const matchedTreePathByHitPath = new Map<string, string>();

  if (hitPathSet.size === 0) {
    return {
      files: [],
      expandedPaths,
      matchedPaths,
      orderedMatchedPaths: [],
      matchCount: 0,
    };
  }

  const walk = (items: FileEntry[]): FileEntry[] =>
    items.flatMap((item) => {
      const matchingChildren = item.children ? walk(item.children) : [];
      const normalizedPath = normalizeSearchPath(item.path);
      const isMatch = hitPathSet.has(normalizedPath);

      if (!isMatch && matchingChildren.length === 0) {
        return [];
      }

      if (isMatch) {
        matchedPaths.add(item.path);
        matchedTreePathByHitPath.set(normalizedPath, item.path);
      }

      if (item.isDir && matchingChildren.length > 0) {
        expandedPaths.add(item.path);
      }

      return [
        {
          ...item,
          children: matchingChildren.length > 0 ? matchingChildren : item.children,
        },
      ];
    });

  const filteredFiles = walk(files);
  const orderedMatchedPaths: string[] = [];
  const seenOrderedPaths = new Set<string>();

  for (const hitPath of hitPaths) {
    const treePath = matchedTreePathByHitPath.get(hitPath);
    if (!treePath || seenOrderedPaths.has(treePath)) continue;
    seenOrderedPaths.add(treePath);
    orderedMatchedPaths.push(treePath);
  }

  return {
    files: filteredFiles,
    expandedPaths,
    matchedPaths,
    orderedMatchedPaths,
    matchCount: matchedPaths.size,
  };
}

export function getStickyAncestorRow(
  rows: readonly VisibleFileTreeRow[],
  firstVisibleIndex: number,
): VisibleFileTreeRow | null {
  const ancestors = getStickyAncestorRows(rows, firstVisibleIndex);
  return ancestors[ancestors.length - 1] ?? null;
}

export function getStickyAncestorRows(
  rows: readonly VisibleFileTreeRow[],
  firstVisibleIndex: number,
): VisibleFileTreeRow[] {
  const firstVisibleRow = rows[firstVisibleIndex];
  if (!firstVisibleRow || firstVisibleRow.depth === 0) {
    return [];
  }

  const ancestors: Array<VisibleFileTreeRow | null> = Array.from(
    { length: firstVisibleRow.depth },
    () => null,
  );
  let remaining = firstVisibleRow.depth;

  for (let index = firstVisibleIndex - 1; index >= 0 && remaining > 0; index--) {
    const candidate = rows[index];
    if (candidate.depth < firstVisibleRow.depth && ancestors[candidate.depth] === null) {
      ancestors[candidate.depth] = candidate;
      remaining--;
    }
  }

  return ancestors.filter((row): row is VisibleFileTreeRow => row !== null);
}

export function getGuideAncestorRows(
  rows: readonly VisibleFileTreeRow[],
  rowIndex: number,
): Array<VisibleFileTreeRow | null> {
  const row = rows[rowIndex];
  if (!row || row.depth === 0) {
    return [];
  }

  const ancestors: Array<VisibleFileTreeRow | null> = Array.from({ length: row.depth }, () => null);
  let remaining = row.depth;

  for (let index = rowIndex - 1; index >= 0 && remaining > 0; index--) {
    const candidate = rows[index];
    if (candidate.depth < row.depth && ancestors[candidate.depth] === null) {
      ancestors[candidate.depth] = candidate;
      remaining--;
    }
  }

  return ancestors;
}
