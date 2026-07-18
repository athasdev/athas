import type { FileEntry } from "@/features/file-system/types/app.types";
import { getBaseName, getRelativePath, joinPath, pathStartsWithRoot } from "@/utils/path-helpers";

export interface VisibleFileTreeRow {
  file: FileEntry;
  depth: number;
  isExpanded: boolean;
  displayName?: string;
  guideAncestors?: Array<VisibleFileTreeRow | null>;
}

export interface BuildVisibleFileTreeRowsOptions {
  compactFolders?: boolean;
  hiddenRootPath?: string;
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

export interface FilterFileTreeForFffHitsOptions {
  rootPath?: string | null;
}

export interface FilterFileTreeEntriesOptions {
  isAlwaysHidden: (name: string) => boolean;
  isGitIgnored: (path: string, isDir: boolean) => boolean;
  isHiddenName: (name: string) => boolean;
  isUserHidden: (path: string, isDir: boolean) => boolean;
  showGitignoredFiles: boolean;
  showHiddenFiles: boolean;
}

export function filterFileTreeEntries(
  files: FileEntry[],
  options: FilterFileTreeEntriesOptions,
): FileEntry[] {
  let changed = false;
  const filteredItems: FileEntry[] = [];

  for (const item of files) {
    const ignored = options.isGitIgnored(item.path, item.isDir);

    if (options.isAlwaysHidden(item.name) || options.isUserHidden(item.path, item.isDir)) {
      changed = true;
      continue;
    }

    if (!options.showHiddenFiles && options.isHiddenName(item.name)) {
      changed = true;
      continue;
    }

    if (!options.showGitignoredFiles && ignored) {
      changed = true;
      continue;
    }

    const filteredChildren = item.children
      ? filterFileTreeEntries(item.children, options)
      : undefined;
    const childrenChanged = filteredChildren !== item.children;
    const ignoredChanged = item.ignored !== ignored && (ignored || item.ignored !== undefined);

    if (childrenChanged || ignoredChanged) {
      changed = true;
      filteredItems.push({
        ...item,
        ignored,
        children: filteredChildren,
      });
      continue;
    }

    filteredItems.push(item);
  }

  return changed ? filteredItems : files;
}

export function collectFileTreeSearchHits(
  files: FileEntry[],
  query: string,
  limit: number,
): FileTreeSearchHit[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const hits: FileTreeSearchHit[] = [];
  const walk = (items: FileEntry[]) => {
    for (const item of items) {
      if (hits.length >= limit) return;

      const searchableText = `${item.name} ${item.path}`.toLowerCase();
      if (searchableText.includes(normalizedQuery)) {
        hits.push({ path: item.path });
      }

      if (item.children) {
        walk(item.children);
      }
    }
  };

  walk(files);
  return hits;
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
  const hiddenRootPath = options.hiddenRootPath;
  const rootItems =
    hiddenRootPath && files.length === 1 && files[0]?.path === hiddenRootPath && files[0]?.isDir
      ? (files[0].children ?? [])
      : files;

  const walk = (
    items: FileEntry[],
    depth: number,
    guideAncestors: Array<VisibleFileTreeRow | null>,
  ) => {
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
      const row: VisibleFileTreeRow = {
        file: rowFile,
        depth,
        isExpanded,
        displayName: displayNameParts.length > 1 ? displayNameParts.join("/") : undefined,
        guideAncestors,
      };
      rows.push(row);

      if (rowFile.isDir && isExpanded && rowFile.children) {
        walk(rowFile.children, depth + 1, [...guideAncestors, row]);
      }
    }
  };

  walk(rootItems, 0, []);
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
  options: FilterFileTreeForFffHitsOptions = {},
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

  const walk = (items: FileEntry[]): FileEntry[] => {
    const filteredItems: FileEntry[] = [];

    for (const item of items) {
      const matchingChildren = item.children ? walk(item.children) : [];
      const normalizedPath = normalizeSearchPath(item.path);
      const isMatch = hitPathSet.has(normalizedPath);

      if (!isMatch && matchingChildren.length === 0) {
        continue;
      }

      if (isMatch) {
        matchedPaths.add(item.path);
        matchedTreePathByHitPath.set(normalizedPath, item.path);
      }

      if (item.isDir && matchingChildren.length > 0) {
        expandedPaths.add(item.path);
      }

      filteredItems.push({
        ...item,
        children: matchingChildren.length > 0 ? matchingChildren : item.children,
      });
    }

    return filteredItems;
  };

  const filteredFiles = walk(files);

  const cloneByPath = new Map<string, FileEntry>();
  const getMutableItem = (item: FileEntry): FileEntry => {
    const existing = cloneByPath.get(item.path);
    if (existing) return existing;

    const clone = {
      ...item,
      children: item.children ? [...item.children] : item.isDir ? [] : undefined,
    };
    cloneByPath.set(item.path, clone);
    return clone;
  };
  const findRootForHit = (hitPath: string): FileEntry | undefined => {
    const candidates = files.filter(
      (item) =>
        item.isDir &&
        pathStartsWithRoot(hitPath, item.path) &&
        (!options.rootPath ||
          pathStartsWithRoot(item.path, options.rootPath) ||
          item.path === options.rootPath),
    );
    return candidates.sort((a, b) => b.path.length - a.path.length)[0];
  };
  const ensureRootInFilteredTree = (root: FileEntry): FileEntry => {
    const existingIndex = filteredFiles.findIndex((item) => item.path === root.path);
    if (existingIndex >= 0) {
      const clone = getMutableItem(filteredFiles[existingIndex]!);
      filteredFiles[existingIndex] = clone;
      return clone;
    }

    const clone = getMutableItem({ ...root, children: [] });
    filteredFiles.push(clone);
    return clone;
  };
  const ensureSyntheticHit = (hitPath: string) => {
    const root = findRootForHit(hitPath);
    if (!root) {
      const file = {
        name: getBaseName(hitPath, hitPath),
        path: hitPath,
        isDir: false,
      };
      filteredFiles.push(file);
      matchedPaths.add(hitPath);
      matchedTreePathByHitPath.set(normalizeSearchPath(hitPath), hitPath);
      return;
    }

    const rootClone = ensureRootInFilteredTree(root);
    expandedPaths.add(rootClone.path);

    const relativePath = getRelativePath(hitPath, rootClone.path);
    const segments = relativePath.split("/").filter(Boolean);
    let parent = rootClone;
    let parentPath = rootClone.path;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      const isLast = index === segments.length - 1;
      const childPath = joinPath(parentPath, segment);
      const children = parent.children ?? [];
      const existingIndex = children.findIndex((item) => item.path === childPath);
      let child: FileEntry;

      if (existingIndex >= 0) {
        child = getMutableItem(children[existingIndex]!);
        children[existingIndex] = child;
      } else {
        child = {
          name: segment,
          path: childPath,
          isDir: !isLast,
          children: isLast ? undefined : [],
        };
        children.push(child);
      }

      parent.children = children;
      if (isLast) {
        matchedPaths.add(child.path);
        matchedTreePathByHitPath.set(normalizeSearchPath(hitPath), child.path);
        return;
      }

      expandedPaths.add(child.path);
      parent = child;
      parentPath = child.path;
    }
  };

  for (const hitPath of hitPaths) {
    if (!matchedTreePathByHitPath.has(hitPath)) {
      ensureSyntheticHit(hitPath);
    }
  }

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

export function getGuideAncestorRows(
  rows: readonly VisibleFileTreeRow[],
  rowIndex: number,
): Array<VisibleFileTreeRow | null> {
  const row = rows[rowIndex];
  if (!row || row.depth === 0) {
    return [];
  }

  if (row.guideAncestors) {
    return row.guideAncestors;
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
