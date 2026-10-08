import {
  isBinaryFile,
  isImageFile,
  isPdfFile,
  getDatabaseTypeFromPath,
} from "@/features/file-system/controllers/file-utils";
import { buildSearchRegex } from "@/features/editor/utils/search";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import type { useProjectStore } from "@/features/workspace/stores/project.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type {
  FileSearchResult,
  SearchFilesResponse,
} from "@/features/file-search/lib/file-search-api";
import { shouldIgnoreSearchEntry } from "@/features/file-search/utils/file-search-filtering";
import type { ContentSearchOptions } from "../types/global-search.types";
import type { ProviderIgnoreRule } from "../workers/search-worker-protocol";
import { createSearchWorkerSession } from "./search-worker-client";
import { createPathFilterPredicate } from "../utils/path-filters";

const FILE_BATCH_LIMIT = 250;
const READ_CONCURRENCY = 8;

function isTextSearchFile(path: string): boolean {
  return (
    !isBinaryFile(path) && !isImageFile(path) && !isPdfFile(path) && !getDatabaseTypeFromPath(path)
  );
}
function searchPath(path: string): string {
  const normalized =
    /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") ? path.replace(/\\/g, "/") : path;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}
function searchPathIdentity(path: string): string {
  const normalized = searchPath(path);
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
    ? normalized.toLowerCase()
    : normalized;
}
interface SearchDirectory {
  path: string;
  root: string;
  rules: ProviderIgnoreRule[];
}
function validateSearchEntries(directory: SearchDirectory, entries: FileEntry[]) {
  const rootIdentity = searchPathIdentity(directory.root);
  const rootPrefix = rootIdentity === "/" ? "/" : `${rootIdentity}/`;
  const directoryIdentity = searchPathIdentity(directory.path);
  const prefix = directoryIdentity === "/" ? "/" : `${directoryIdentity}/`;
  for (const entry of entries) {
    const identity = searchPathIdentity(entry.path);
    if (
      !identity.startsWith(rootPrefix) ||
      identity.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error(
        `Directory ${directory.path} returned a path outside its search root: ${entry.path}`,
      );
    const name = searchPath(entry.path).slice(prefix.length);
    if (!identity.startsWith(prefix) || name.includes("/") || !name || name !== entry.name)
      throw new Error(`Directory ${directory.path} returned an invalid entry: ${entry.path}`);
  }
}
async function readSearchDirectory(directory: SearchDirectory) {
  try {
    const entries = await getWorkspaceResourceProvider(directory.path).readDirectory(
      directory.path,
      directory.root,
    );
    validateSearchEntries(directory, entries);
    return entries;
  } catch (error) {
    throw new Error(
      `Failed to search directory ${directory.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function readIgnoreContent(entry: FileEntry) {
  try {
    const content = await getWorkspaceResourceProvider(entry.path).readText(entry.path);
    if (content.includes("\0")) throw new Error("Ignore rules must be a UTF-8 text file.");
    if (new TextEncoder().encode(content).length > 1024 * 1024)
      throw new Error("Ignore rules exceed the 1 MiB limit.");
    return content;
  } catch (error) {
    throw new Error(
      `Failed to read search ignore rules ${entry.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function readRepositoryExcludes(
  directory: SearchDirectory,
  entries: FileEntry[],
  isCancelled: () => boolean,
  relativeDirectory: string,
): Promise<ProviderIgnoreRule[]> {
  const git = entries.find((entry) => entry.name === ".git");
  if (!git || git.isSymlink || !git.isDir || isCancelled()) return [];
  const gitDirectory = { ...directory, path: git.path };
  const gitEntries = await readSearchDirectory(gitDirectory);
  if (isCancelled()) return [];
  const info = gitEntries.find((entry) => entry.name === "info" && entry.isDir && !entry.isSymlink);
  if (!info) return [];
  const infoEntries = await readSearchDirectory({ ...directory, path: info.path });
  if (isCancelled()) return [];
  const exclude = infoEntries.find(
    (entry) => entry.name === "exclude" && !entry.isDir && !entry.isSymlink,
  );
  if (!exclude) return [];
  return [
    { directory: relativeDirectory, content: await readIgnoreContent(exclude), kind: "exclude" },
  ];
}
export async function loadProviderSearchFiles(
  store: ReturnType<typeof useProjectStore.getStore>,
  { isCancelled = () => false }: { isCancelled?: () => boolean } = {},
): Promise<FileEntry[] | null> {
  const snapshot = store.getState();
  const candidates = [
    ...new Set(
      [snapshot.rootFolderPath, ...snapshot.workspaceFolders.map((folder) => folder.path)].filter(
        (path): path is string => !!path,
      ),
    ),
  ];
  const roots = candidates.filter(
    (candidate, index) =>
      !candidates.some((parent, parentIndex) => {
        if (index === parentIndex) return false;
        const identity = searchPathIdentity(candidate);
        const parentIdentity = searchPathIdentity(parent);
        return identity === parentIdentity
          ? parentIndex < index
          : identity.startsWith(parentIdentity === "/" ? "/" : `${parentIdentity}/`);
      }),
  );
  const visited = new Set<string>();
  const files = new Map<string, FileEntry>();
  const directories: SearchDirectory[] = roots.map((root) => ({ path: root, root, rules: [] }));
  const worker = createSearchWorkerSession({ isCancelled });
  let offset = 0;
  try {
    while (offset < directories.length) {
      if (isCancelled()) return null;
      const batch: SearchDirectory[] = [];
      while (offset < directories.length && batch.length < READ_CONCURRENCY) {
        const directory = directories[offset++];
        const identity = searchPathIdentity(directory.path);
        if (visited.has(identity)) continue;
        visited.add(identity);
        batch.push(directory);
      }
      const listings = await Promise.all(
        batch.map(async (directory) => {
          const entries = await readSearchDirectory(directory);
          if (isCancelled()) return null;
          const rootPath = searchPath(directory.root);
          const rootPrefix = rootPath === "/" ? "/" : `${rootPath}/`;
          const relativeDirectory =
            searchPathIdentity(directory.path) === searchPathIdentity(directory.root)
              ? ""
              : searchPath(directory.path).slice(rootPrefix.length);
          const repository = entries.some((entry) => entry.name === ".git" && !entry.isSymlink);
          const rules = directory.rules.filter((rule) => !repository || rule.kind === "ignore");
          if (repository)
            rules.push(
              ...(await readRepositoryExcludes(directory, entries, isCancelled, relativeDirectory)),
            );
          for (const entry of entries) {
            if (isCancelled()) return null;
            if (
              (entry.name === ".gitignore" || entry.name === ".ignore") &&
              !entry.isDir &&
              !entry.isSymlink
            )
              rules.push({
                directory: relativeDirectory,
                content: await readIgnoreContent(entry),
                kind: entry.name === ".ignore" ? "ignore" : "gitignore",
              });
          }
          if (isCancelled()) return null;
          const available = entries.filter(
            (entry) =>
              !entry.ignored &&
              !entry.isSymlink &&
              !shouldIgnoreSearchEntry(entry.name, entry.isDir) &&
              !(entry.name === ".ignore" && !entry.isDir),
          );
          const indices = rules.length
            ? await worker.run({
                kind: "filter",
                filePath: directory.path,
                rules,
                entries: available.map((entry) => ({
                  path: searchPath(entry.path).slice(rootPrefix.length),
                  isDir: entry.isDir,
                })),
              })
            : [...available.keys()];
          return { entries: indices.map((index) => available[index]), rules };
        }),
      );
      if (isCancelled()) return null;
      for (let index = 0; index < batch.length; index++) {
        const listing = listings[index];
        if (!listing) return null;
        for (const entry of listing.entries) {
          const identity = searchPathIdentity(entry.path);
          if (entry.isDir)
            directories.push({ path: entry.path, root: batch[index].root, rules: listing.rules });
          else if (isTextSearchFile(entry.path) && !files.has(identity)) files.set(identity, entry);
        }
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
    return isCancelled() ? null : Array.from(files.values());
  } catch (error) {
    if (isCancelled()) return null;
    throw error;
  } finally {
    worker.dispose();
  }
}

export async function searchProviderFilesContent({
  files,
  query,
  rootFolderPath,
  options,
  maxResults,
  fileOffset,
  contextLines,
  includeQuery,
  excludeQuery,
  isCancelled,
}: {
  files: FileEntry[];
  query: string;
  rootFolderPath: string;
  options: ContentSearchOptions;
  maxResults: number;
  fileOffset: number;
  contextLines: number;
  includeQuery: string;
  excludeQuery: string;
  isCancelled: () => boolean;
}): Promise<SearchFilesResponse | null> {
  let searchRegex = buildSearchRegex(query, options);
  const regexFallbackError =
    query && options.useRegex && !searchRegex ? "Invalid regular expression" : null;
  if (regexFallbackError) searchRegex = buildSearchRegex(query, { ...options, useRegex: false });
  if (!searchRegex) {
    return {
      results: [],
      total_files: files.length,
      searched_files: 0,
      searchable_files: 0,
      files_with_matches: 0,
      next_file_offset: 0,
      has_more: false,
      is_indexing: false,
      indexed_files: files.length,
      regex_fallback_error: regexFallbackError,
    };
  }

  const matchesPathFilters = createPathFilterPredicate(rootFolderPath, includeQuery, excludeQuery);
  const searchableFiles = files.filter(
    (file) => isTextSearchFile(file.path) && matchesPathFilters(file.path),
  );
  const results: FileSearchResult[] = [];
  let searchedFiles = 0;
  let unreadableFiles = 0;
  let firstReadError: string | null = null;
  let matchCount = 0;
  let nextFileOffset = fileOffset;

  const worker = createSearchWorkerSession({ isCancelled });
  try {
    searchLoop: for (
      let batchStart = fileOffset;
      batchStart < searchableFiles.length && searchedFiles < FILE_BATCH_LIMIT;
      batchStart += READ_CONCURRENCY
    ) {
      if (isCancelled()) return null;

      const batchEnd = Math.min(
        searchableFiles.length,
        batchStart + READ_CONCURRENCY,
        batchStart + FILE_BATCH_LIMIT - searchedFiles,
      );
      const batch = searchableFiles.slice(batchStart, batchEnd);
      const contents = await Promise.all(
        batch.map(async (file) => {
          try {
            return {
              content: await getWorkspaceResourceProvider(file.path).readText(file.path),
              error: null,
            };
          } catch (error) {
            return {
              content: null,
              error: `${file.path}: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }),
      );

      if (isCancelled()) return null;

      for (let index = 0; index < batch.length; index++) {
        const file = batch[index];
        const read = contents[index];
        const content = read.content;
        if (read.error !== null) {
          unreadableFiles++;
          firstReadError ??= read.error;
        }
        searchedFiles++;
        nextFileOffset = batchStart + index + 1;

        if (file && content !== null) {
          const result = await worker.run({
            kind: "search",
            filePath: file.path,
            content,
            pattern: searchRegex.source,
            flags: searchRegex.flags,
            contextLines,
          });
          if (isCancelled()) return null;
          if (result) {
            results.push(result);
            matchCount += result.total_matches;
          }
        }

        if (matchCount >= maxResults || searchedFiles >= FILE_BATCH_LIMIT) {
          break searchLoop;
        }
      }

      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  } catch (error) {
    if (isCancelled()) return null;
    throw error;
  } finally {
    worker.dispose();
  }

  const hasMore = nextFileOffset < searchableFiles.length;
  return {
    results,
    total_files: files.length,
    searched_files: searchedFiles,
    searchable_files: searchableFiles.length,
    files_with_matches: results.length,
    next_file_offset: hasMore ? nextFileOffset : 0,
    has_more: hasMore,
    is_indexing: false,
    indexed_files: files.length,
    regex_fallback_error: regexFallbackError,
    unreadable_files: unreadableFiles,
    first_read_error: firstReadError,
  };
}
