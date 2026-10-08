import type { FileEntry } from "@/features/file-system/types/app.types";
import type { FileTreeSortOrder } from "@/features/settings/types/settings.types";
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
  sortOrder?: FileTreeSortOrder;
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

/**
 * Filtered results per children array, for one set of filter options. Tree updates keep the
 * arrays of unchanged directories, so a refresh or an expanded folder only filters the path that
 * changed instead of re-matching every loaded entry against the ignore rules.
 */
export type FileTreeFilterCache = WeakMap<FileEntry[], FileEntry[]>;

export function filterFileTreeEntries(
  files: FileEntry[],
  options: FilterFileTreeEntriesOptions,
  cache?: FileTreeFilterCache,
): FileEntry[] {
  const cached = cache?.get(files);
  if (cached) return cached;

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
      ? filterFileTreeEntries(item.children, options, cache)
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

  const result = changed ? filteredItems : files;
  cache?.set(files, result);
  return result;
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

const fileTreeNameCollator = new Intl.Collator();
const sortedEntriesCache: Record<FileTreeSortOrder, WeakMap<readonly FileEntry[], FileEntry[]>> = {
  "folders-first": new WeakMap(),
  name: new WeakMap(),
};

/**
 * Directory children in display order. Sorted once per children array: expanding or collapsing a
 * folder rebuilds the visible rows, and re-sorting every open directory each time was the bulk of
 * that work in large trees.
 */
function sortFileTreeEntriesForDisplay(
  entries: FileEntry[],
  sortOrder: FileTreeSortOrder,
): FileEntry[] {
  const cache = sortedEntriesCache[sortOrder];
  const cached = cache.get(entries);
  if (cached) return cached;

  const sorted = entries
    .map((entry) => ({ entry, key: entry.name.toLowerCase() }))
    .sort((left, right) => {
      if (sortOrder === "folders-first" && left.entry.isDir !== right.entry.isDir) {
        return left.entry.isDir ? -1 : 1;
      }
      return fileTreeNameCollator.compare(left.key, right.key);
    })
    .map(({ entry }) => entry);
  cache.set(entries, sorted);
  return sorted;
}

/**
 * The rows of one children array: each entry's row, the expanded state of every folder that
 * decided it, and the nested segment of each expanded folder. Entries are immutable and tree
 * updates copy only the changed path, so a segment stays valid while its children array is the
 * same and the folders it consulted keep their expanded state.
 */
interface VisibleRowsSegment {
  depth: number;
  preserveOrder: boolean;
  rows: VisibleFileTreeRow[];
  /** Nested segment rendered after `rows[index]`, or null. */
  nested: Array<VisibleRowsSegment | null>;
  consultedPaths: string[];
  consultedExpanded: boolean[];
}

/** Per-tree memo of visible row segments; one per mounted tree. */
export interface VisibleFileTreeRowsCache {
  compactFolders: boolean;
  sortOrder: FileTreeSortOrder;
  segments: WeakMap<readonly FileEntry[], VisibleRowsSegment>;
}

export function createVisibleFileTreeRowsCache(): VisibleFileTreeRowsCache {
  return { compactFolders: false, sortOrder: "folders-first", segments: new WeakMap() };
}

function isSegmentValid(segment: VisibleRowsSegment, expandedPaths: ReadonlySet<string>): boolean {
  const { consultedPaths, consultedExpanded } = segment;
  for (let index = 0; index < consultedPaths.length; index++) {
    if (expandedPaths.has(consultedPaths[index]) !== consultedExpanded[index]) return false;
  }
  for (const nested of segment.nested) {
    if (nested && !isSegmentValid(nested, expandedPaths)) return false;
  }
  return true;
}

function appendSegmentRows(segment: VisibleRowsSegment, rows: VisibleFileTreeRow[]) {
  for (let index = 0; index < segment.rows.length; index++) {
    rows.push(segment.rows[index]);
    const nested = segment.nested[index];
    if (nested) appendSegmentRows(nested, rows);
  }
}

export function buildVisibleFileTreeRows(
  files: FileEntry[],
  expandedPaths: ReadonlySet<string>,
  options: BuildVisibleFileTreeRowsOptions = {},
  cache: VisibleFileTreeRowsCache = createVisibleFileTreeRowsCache(),
): VisibleFileTreeRow[] {
  const compactFolders = options.compactFolders === true;
  const hiddenRootPath = options.hiddenRootPath;
  const sortOrder = options.sortOrder ?? "folders-first";
  if (cache.compactFolders !== compactFolders || cache.sortOrder !== sortOrder) {
    cache.compactFolders = compactFolders;
    cache.sortOrder = sortOrder;
    cache.segments = new WeakMap();
  }
  const rootItems =
    hiddenRootPath && files.length === 1 && files[0]?.path === hiddenRootPath && files[0]?.isDir
      ? (files[0].children ?? [])
      : files;
  const preserveWorkspaceRootOrder =
    rootItems === files && files.length > 1 && files.every((item) => item.isDir);

  const buildSegment = (
    items: FileEntry[],
    depth: number,
    preserveOrder: boolean,
  ): VisibleRowsSegment => {
    const cached = cache.segments.get(items);
    if (
      cached &&
      cached.depth === depth &&
      cached.preserveOrder === preserveOrder &&
      isSegmentValid(cached, expandedPaths)
    ) {
      return cached;
    }

    const displayItems = preserveOrder ? items : sortFileTreeEntriesForDisplay(items, sortOrder);
    const segment: VisibleRowsSegment = {
      depth,
      preserveOrder,
      rows: [],
      nested: [],
      consultedPaths: [],
      consultedExpanded: [],
    };
    const isExpandedPath = (path: string) => {
      const expanded = expandedPaths.has(path);
      segment.consultedPaths.push(path);
      segment.consultedExpanded.push(expanded);
      return expanded;
    };

    for (const item of displayItems) {
      let rowFile = item;
      const displayNameParts = [item.name];
      let rowExpanded: boolean | null = null;

      if (compactFolders) {
        while ((rowExpanded = isExpandedPath(rowFile.path))) {
          const child = getCompactFolderChild(rowFile);
          if (!child) break;

          rowFile = child;
          displayNameParts.push(child.name);
          rowExpanded = null;
        }
      }

      const isExpanded = rowFile.isDir && (rowExpanded ?? isExpandedPath(rowFile.path));
      segment.rows.push({
        file: rowFile,
        depth,
        isExpanded,
        displayName: displayNameParts.length > 1 ? displayNameParts.join("/") : undefined,
      });

      const nested =
        isExpanded && rowFile.children ? buildSegment(rowFile.children, depth + 1, false) : null;
      segment.nested.push(nested);
    }

    cache.segments.set(items, segment);
    return segment;
  };

  const root = buildSegment(rootItems, 0, preserveWorkspaceRootOrder);
  const rows: VisibleFileTreeRow[] = [];
  appendSegmentRows(root, rows);
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

export interface VisibleFileTreeRowIndex {
  get: (path: string) => number | undefined;
}

const rowIndexByPathCache = new WeakMap<readonly VisibleFileTreeRow[], Map<string, number>>();

/**
 * Looks rows up by path. The path map is built on the first lookup into a rows array and shared
 * by every lookup into it, so building the rows does not pay for a map nobody reads.
 */
export function createVisibleFileTreeRowIndex(
  rows: readonly VisibleFileTreeRow[],
): VisibleFileTreeRowIndex {
  return {
    get: (path) => {
      let indexByPath = rowIndexByPathCache.get(rows);
      if (!indexByPath) {
        indexByPath = new Map();
        for (let index = 0; index < rows.length; index++) {
          indexByPath.set(rows[index].file.path, index);
        }
        rowIndexByPathCache.set(rows, indexByPath);
      }
      return indexByPath.get(path);
    },
  };
}

const parentRowIndexesCache = new WeakMap<readonly VisibleFileTreeRow[], Int32Array>();

/** For each row, the index of the nearest earlier row with a smaller depth, or -1. */
function getParentRowIndexes(rows: readonly VisibleFileTreeRow[]): Int32Array {
  const cached = parentRowIndexesCache.get(rows);
  if (cached) return cached;

  const parents = new Int32Array(rows.length);
  const stack: number[] = [];
  for (let index = 0; index < rows.length; index++) {
    const depth = rows[index].depth;
    while (stack.length > 0 && rows[stack[stack.length - 1]].depth >= depth) stack.pop();
    parents[index] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(index);
  }
  parentRowIndexesCache.set(rows, parents);
  return parents;
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
  const parents = getParentRowIndexes(rows);
  for (let index = parents[rowIndex]; index >= 0; index = parents[index]) {
    const candidate = rows[index];
    if (candidate.depth < row.depth) ancestors[candidate.depth] = candidate;
  }

  return ancestors;
}

export function getStickyAncestorRows(
  rows: readonly VisibleFileTreeRow[],
  rowIndex: number,
): VisibleFileTreeRow[] {
  return getGuideAncestorRows(rows, rowIndex).filter(
    (row): row is VisibleFileTreeRow => row !== null,
  );
}
