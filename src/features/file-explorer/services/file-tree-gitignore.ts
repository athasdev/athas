import ignore from "ignore";
import type { FileEntry } from "@/features/file-system/types/app.types";
import {
  getDirName,
  getRelativePath,
  joinPath,
  normalizePath,
  pathStartsWithRoot,
  stripTrailingPathSeparators,
} from "@/utils/path-helpers";

const GITIGNORE_FILE_NAME = ".gitignore";

type IgnoreMatcher = ReturnType<typeof ignore>;

export interface GitIgnoreFileReference {
  path: string;
  directoryPath: string;
}

export interface GitIgnoreFileContent extends GitIgnoreFileReference {
  content: string;
}

interface GitIgnoreRuleSet {
  directoryPath: string;
  matcher: IgnoreMatcher;
}

type GitIgnoreReader = (path: string) => Promise<string>;
type GitIgnoreCacheListener = (path: string | undefined) => void;
interface GitIgnoreContentCacheEntry {
  promise: Promise<GitIgnoreFileContent | null>;
}

const referenceCache = new WeakMap<FileEntry, GitIgnoreFileReference[]>();
const contentCache = new Map<string, GitIgnoreContentCacheEntry>();
const matcherCache = new Map<string, { content: string; matcher: IgnoreMatcher }>();
const rulesCache = new Map<
  string,
  { ignoreFiles: readonly GitIgnoreFileContent[]; rules: FileTreeGitIgnoreRules | null }
>();
const cacheListeners = new Set<GitIgnoreCacheListener>();
const MAX_CACHED_GITIGNORE_FILES = 256;
const MAX_CACHED_GITIGNORE_ROOTS = 16;

export interface FileTreeGitIgnoreRules {
  rootFolderPath: string;
  ruleSets: GitIgnoreRuleSet[];
}

const pathDepth = (path: string): number =>
  normalizePath(stripTrailingPathSeparators(path)).split("/").filter(Boolean).length;

const compareIgnoreReferences = (
  left: GitIgnoreFileReference,
  right: GitIgnoreFileReference,
): number => {
  const depthDelta = pathDepth(left.directoryPath) - pathDepth(right.directoryPath);
  if (depthDelta !== 0) return depthDelta;
  return normalizePath(left.directoryPath).localeCompare(normalizePath(right.directoryPath));
};

function addGitIgnoreContent(matcher: IgnoreMatcher, content: string): void {
  for (const line of content.split(/\r?\n/)) {
    try {
      matcher.add(line);
    } catch {
      // Keep the rest of the file usable if a single malformed pattern is present.
    }
  }
}

function trimOldestCacheEntries<Key, Value>(cache: Map<Key, Value>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function getCachedIgnoreMatcher(file: GitIgnoreFileContent): IgnoreMatcher {
  const cacheKey = normalizePath(stripTrailingPathSeparators(file.path));
  const cached = matcherCache.get(cacheKey);
  if (cached?.content === file.content) {
    matcherCache.delete(cacheKey);
    matcherCache.set(cacheKey, cached);
    return cached.matcher;
  }

  const matcher = ignore({ allowRelativePaths: true });
  addGitIgnoreContent(matcher, file.content);
  matcherCache.set(cacheKey, { content: file.content, matcher });
  trimOldestCacheEntries(matcherCache, MAX_CACHED_GITIGNORE_FILES);
  return matcher;
}

function collectGitIgnoreReferencesForEntry(entry: FileEntry): GitIgnoreFileReference[] {
  const cached = referenceCache.get(entry);
  if (cached) return cached;

  const references: GitIgnoreFileReference[] = [];
  if (entry.name === GITIGNORE_FILE_NAME && !entry.isDir) {
    references.push({ path: entry.path, directoryPath: getDirName(entry.path) });
  }
  for (const child of entry.children ?? []) {
    references.push(...collectGitIgnoreReferencesForEntry(child));
  }
  referenceCache.set(entry, references);
  return references;
}

export function collectGitIgnoreFileReferences(
  files: FileEntry[],
  rootFolderPath: string | undefined,
): GitIgnoreFileReference[] {
  if (!rootFolderPath) return [];

  const references = new Map<string, GitIgnoreFileReference>();
  const addReference = (path: string) => {
    if (!pathStartsWithRoot(path, rootFolderPath)) return;

    const normalizedPath = normalizePath(stripTrailingPathSeparators(path));
    references.set(normalizedPath, {
      path,
      directoryPath: getDirName(path),
    });
  };

  addReference(joinPath(rootFolderPath, GITIGNORE_FILE_NAME));

  for (const entry of files) {
    for (const reference of collectGitIgnoreReferencesForEntry(entry)) {
      addReference(reference.path);
    }
  }

  return [...references.values()].sort(compareIgnoreReferences);
}

export async function readFileTreeGitIgnoreContents(
  references: readonly GitIgnoreFileReference[],
  read: GitIgnoreReader,
): Promise<GitIgnoreFileContent[]> {
  const ignoreFiles = await Promise.all(
    references.map((reference) => {
      const cacheKey = normalizePath(stripTrailingPathSeparators(reference.path));
      let entry = contentCache.get(cacheKey);
      if (!entry) {
        const newEntry: GitIgnoreContentCacheEntry = { promise: Promise.resolve(null) };
        newEntry.promise = read(reference.path)
          .then((content) =>
            contentCache.get(cacheKey) === newEntry ? { ...reference, content } : null,
          )
          .catch(() => null);
        entry = newEntry;
        contentCache.set(cacheKey, newEntry);
        trimOldestCacheEntries(contentCache, MAX_CACHED_GITIGNORE_FILES);
      } else {
        contentCache.delete(cacheKey);
        contentCache.set(cacheKey, entry);
      }
      return entry.promise;
    }),
  );

  return ignoreFiles.filter((file): file is GitIgnoreFileContent => file !== null);
}

export function invalidateFileTreeGitIgnoreCache(path?: string): void {
  if (path) {
    const cacheKey = normalizePath(stripTrailingPathSeparators(path));
    const pathParts = cacheKey.split("/");
    if (pathParts[pathParts.length - 1] !== GITIGNORE_FILE_NAME) return;
    contentCache.delete(cacheKey);
    matcherCache.delete(cacheKey);
    for (const [rootPath, cached] of rulesCache) {
      if (cached.ignoreFiles.some((file) => normalizePath(file.path) === cacheKey)) {
        rulesCache.delete(rootPath);
      }
    }
  } else {
    contentCache.clear();
    matcherCache.clear();
    rulesCache.clear();
  }

  for (const listener of cacheListeners) {
    listener(path);
  }
}

export function subscribeToFileTreeGitIgnoreCacheInvalidation(
  listener: GitIgnoreCacheListener,
): () => void {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
}

function hasSameIgnoreFiles(
  left: readonly GitIgnoreFileContent[],
  right: readonly GitIgnoreFileContent[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.path === right[index]?.path &&
        file.directoryPath === right[index]?.directoryPath &&
        file.content === right[index]?.content,
    )
  );
}

export function createFileTreeGitIgnoreRules(
  rootFolderPath: string | undefined,
  ignoreFiles: GitIgnoreFileContent[],
): FileTreeGitIgnoreRules | null {
  if (!rootFolderPath || ignoreFiles.length === 0) return null;

  const ruleSets = ignoreFiles
    .filter((file) => pathStartsWithRoot(file.directoryPath, rootFolderPath))
    .sort(compareIgnoreReferences)
    .map((file) => ({
      directoryPath: file.directoryPath,
      matcher: getCachedIgnoreMatcher(file),
    }));

  if (ruleSets.length === 0) return null;

  return {
    rootFolderPath,
    ruleSets,
  };
}

export function getCachedFileTreeGitIgnoreRules(
  rootFolderPath: string | undefined,
  ignoreFiles: GitIgnoreFileContent[],
): FileTreeGitIgnoreRules | null {
  if (!rootFolderPath) return null;

  const cacheKey = normalizePath(stripTrailingPathSeparators(rootFolderPath));
  const cached = rulesCache.get(cacheKey);
  if (cached && hasSameIgnoreFiles(cached.ignoreFiles, ignoreFiles)) {
    return cached.rules;
  }

  const rules = createFileTreeGitIgnoreRules(rootFolderPath, ignoreFiles);
  rulesCache.set(cacheKey, { ignoreFiles: [...ignoreFiles], rules });
  trimOldestCacheEntries(rulesCache, MAX_CACHED_GITIGNORE_ROOTS);
  return rules;
}

function toMatcherPath(fullPath: string, directoryPath: string, isDir: boolean): string | null {
  if (!pathStartsWithRoot(fullPath, directoryPath)) return null;

  let relative = getRelativePath(fullPath, directoryPath);
  if (!relative || relative.trim() === "") return null;

  relative = normalizePath(relative);
  if (isDir && !relative.endsWith("/")) {
    relative += "/";
  }

  return relative;
}

function isPathIgnoredByOwnRules(
  rules: FileTreeGitIgnoreRules | null,
  fullPath: string,
  isDir: boolean,
): boolean {
  if (!rules || !pathStartsWithRoot(fullPath, rules.rootFolderPath)) return false;

  let rootRelative = getRelativePath(fullPath, rules.rootFolderPath);
  if (!rootRelative || rootRelative.trim() === "") return false;
  rootRelative = normalizePath(rootRelative);
  if (rootRelative === ".git" || rootRelative === ".git/") return false;

  let ignored = false;

  for (const ruleSet of rules.ruleSets) {
    const matcherPath = toMatcherPath(fullPath, ruleSet.directoryPath, isDir);
    if (!matcherPath) continue;

    const result = ruleSet.matcher.test(matcherPath);
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      ignored = false;
    }
  }

  return ignored;
}

function getAncestorDirectoryPaths(fullPath: string, rootFolderPath: string): string[] {
  const ancestors: string[] = [];
  const normalizedRootPath = normalizePath(stripTrailingPathSeparators(rootFolderPath));
  let currentPath = getDirName(fullPath);

  while (currentPath && pathStartsWithRoot(currentPath, rootFolderPath)) {
    if (normalizePath(stripTrailingPathSeparators(currentPath)) === normalizedRootPath) {
      break;
    }

    ancestors.unshift(currentPath);
    currentPath = getDirName(currentPath);
  }

  return ancestors;
}

export function isPathGitIgnoredByFileTreeRules(
  rules: FileTreeGitIgnoreRules | null,
  fullPath: string,
  isDir: boolean,
): boolean {
  if (!rules || !pathStartsWithRoot(fullPath, rules.rootFolderPath)) return false;

  for (const ancestorPath of getAncestorDirectoryPaths(fullPath, rules.rootFolderPath)) {
    if (isPathIgnoredByOwnRules(rules, ancestorPath, true)) {
      return true;
    }
  }

  return isPathIgnoredByOwnRules(rules, fullPath, isDir);
}
