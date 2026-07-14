import { buildSearchRegex } from "@/features/editor/utils/search";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { FileSearchResult, SearchFilesResponse } from "../lib/rust-api/search";
import { shouldIgnoreInCommandPalette } from "../constants/ignored-patterns";
import type { ContentSearchOptions } from "../types/global-search.types";
import { buildFileSearchResult } from "../utils/content-search-results";
import { createPathFilterPredicate } from "../utils/path-filters";

const FILE_BATCH_LIMIT = 250;
const READ_CONCURRENCY = 8;

export function flattenProviderSearchFiles(entries: FileEntry[]): FileEntry[] {
  const files: FileEntry[] = [];
  const stack = [...entries].reverse();

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || shouldIgnoreInCommandPalette(entry.name, entry.isDir)) continue;

    if (entry.isDir) {
      const children = entry.children ?? [];
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push(children[index]);
      }
      continue;
    }

    files.push(entry);
  }

  return files;
}

export async function loadProviderSearchFiles(): Promise<FileEntry[]> {
  const entries = await useFileSystemStore.getState().getAllProjectFiles();
  return flattenProviderSearchFiles(entries);
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
  const searchRegex = buildSearchRegex(query, options);
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
      regex_fallback_error: "Invalid regular expression",
    };
  }

  const matchesPathFilters = createPathFilterPredicate(rootFolderPath, includeQuery, excludeQuery);
  const searchableFiles = files.filter((file) => matchesPathFilters(file.path));
  const results: FileSearchResult[] = [];
  let searchedFiles = 0;
  let matchCount = 0;
  let nextFileOffset = fileOffset;

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
          return await readFileContent(file.path);
        } catch {
          return null;
        }
      }),
    );

    if (isCancelled()) return null;

    for (let index = 0; index < batch.length; index++) {
      const file = batch[index];
      const content = contents[index];
      searchedFiles++;
      nextFileOffset = batchStart + index + 1;

      if (file && content !== null) {
        const result = buildFileSearchResult(file.path, content, searchRegex, contextLines);
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
    regex_fallback_error: null,
  };
}
