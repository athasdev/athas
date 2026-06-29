import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { buildSearchRegex } from "@/features/editor/utils/search";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type {
  FileSearchResult,
  SearchFilesResponse,
  SearchMatch,
  SearchMatchRange,
} from "@/features/global-search/lib/rust-api/search";
import { fffScanStatus, searchFilesContent } from "@/features/global-search/lib/rust-api/search";
import { CONTENT_SEARCH_PAGE_SIZE, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { shouldIgnoreInCommandPalette } from "../constants/ignored-patterns";
import { createPathFilterPredicate } from "../utils/path-filters";

export interface ContentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const canUseContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) &&
  !rootPath?.startsWith("remote://") &&
  !rootPath?.startsWith("wsl://") &&
  !rootPath?.startsWith("diff://");
const canUseProviderContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  typeof rootPath === "string" && rootPath.startsWith("wsl://");
const INDEX_STATUS_POLL_DELAY = 250;
const PROVIDER_CONTENT_SEARCH_FILE_BATCH_SIZE = 250;
const PROVIDER_CONTENT_SEARCH_YIELD_INTERVAL = 16;
const yieldToSearchLoop = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

function flattenSearchFiles(entries: FileEntry[]): FileEntry[] {
  const files: FileEntry[] = [];
  const stack = [...entries].reverse();

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (shouldIgnoreInCommandPalette(entry.name, entry.isDir)) continue;
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

function lineMatches(line: string, regex: RegExp): SearchMatchRange[] {
  const ranges: SearchMatchRange[] = [];
  regex.lastIndex = 0;

  let match = regex.exec(line);
  while (match) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    if (match.index === regex.lastIndex) regex.lastIndex++;
    match = regex.exec(line);
  }
  return ranges;
}

function buildFileSearchResult(
  filePath: string,
  content: string,
  regex: RegExp,
  contextLines: number,
): FileSearchResult | null {
  if (content.includes("\0")) return null;

  const lines = content.split("\n");
  const matches: SearchMatch[] = [];
  let totalMatches = 0;

  lines.forEach((line, index) => {
    const ranges = lineMatches(line, regex);
    if (ranges.length === 0) return;

    const lineNumber = index + 1;
    totalMatches += ranges.length;
    matches.push({
      line_number: lineNumber,
      line_content: line,
      column_start: ranges[0]?.start ?? 0,
      column_end: ranges[0]?.end ?? 0,
      match_ranges: ranges,
      context_before: lines.slice(Math.max(0, index - contextLines), index),
      context_after: lines.slice(index + 1, index + 1 + contextLines),
    });
  });

  if (matches.length === 0) return null;

  return {
    file_path: filePath,
    matches,
    total_matches: totalMatches,
  };
}

async function searchProviderFilesContent({
  query,
  rootFolderPath,
  options,
  maxResults,
  fileOffset,
  contextLines,
  includeQuery,
  excludeQuery,
}: {
  query: string;
  rootFolderPath: string;
  options: ContentSearchOptions;
  maxResults: number;
  fileOffset: number;
  contextLines: number;
  includeQuery: string;
  excludeQuery: string;
}): Promise<SearchFilesResponse> {
  const searchRegex = buildSearchRegex(query, options);
  if (!searchRegex) {
    return {
      results: [],
      total_files: 0,
      searched_files: 0,
      searchable_files: 0,
      files_with_matches: 0,
      next_file_offset: 0,
      has_more: false,
      is_indexing: false,
      indexed_files: 0,
      regex_fallback_error: "Invalid regular expression",
    };
  }

  const allFiles = flattenSearchFiles(await useFileSystemStore.getState().getAllProjectFiles());
  const matchesPathFilters = createPathFilterPredicate(rootFolderPath, includeQuery, excludeQuery);
  const searchableFiles = allFiles.filter((file) => matchesPathFilters(file.path));
  const results: FileSearchResult[] = [];
  let searchedFiles = 0;
  let matchCount = 0;
  let nextFileOffset = 0;

  for (let index = fileOffset; index < searchableFiles.length; index++) {
    const file = searchableFiles[index];
    searchedFiles++;

    try {
      const content = await readFileContent(file.path);
      const result = buildFileSearchResult(file.path, content, searchRegex, contextLines);
      if (result) {
        results.push(result);
        matchCount += result.total_matches;
      }
    } catch {
      continue;
    }

    nextFileOffset = index + 1;
    if (matchCount >= maxResults || searchedFiles >= PROVIDER_CONTENT_SEARCH_FILE_BATCH_SIZE) {
      break;
    }
    if (searchedFiles % PROVIDER_CONTENT_SEARCH_YIELD_INTERVAL === 0) {
      await yieldToSearchLoop();
    }
  }

  return {
    results,
    total_files: allFiles.length,
    searched_files: searchedFiles,
    searchable_files: searchableFiles.length,
    files_with_matches: results.length,
    next_file_offset: nextFileOffset < searchableFiles.length ? nextFileOffset : 0,
    has_more: nextFileOffset < searchableFiles.length,
    is_indexing: false,
    indexed_files: searchableFiles.length,
    regex_fallback_error: null,
  };
}

const mergeSearchResults = (
  previousResults: FileSearchResult[],
  nextResults: FileSearchResult[],
): FileSearchResult[] => {
  const resultsByPath = new Map(previousResults.map((result) => [result.file_path, result]));

  for (const result of nextResults) {
    const existing = resultsByPath.get(result.file_path);
    if (!existing) {
      resultsByPath.set(result.file_path, result);
      continue;
    }

    resultsByPath.set(result.file_path, {
      ...existing,
      matches: [...existing.matches, ...result.matches],
      total_matches: existing.total_matches + result.total_matches,
    });
  }

  return Array.from(resultsByPath.values());
};

export const useContentSearch = () => {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [rawResults, setRawResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [nextFileOffset, setNextFileOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [searchedFiles, setSearchedFiles] = useState(0);
  const [searchableFiles, setSearchableFiles] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState(0);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [includeQuery, setIncludeQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [contextLines, setContextLines] = useState(2);
  const [searchOptions, setSearchOptions] = useState<ContentSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const requestIdRef = useRef(0);

  const setSearchOption = useCallback(
    <K extends keyof ContentSearchOptions>(key: K, value: ContentSearchOptions[K]) => {
      setSearchOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const performSearch = useCallback(async () => {
    const searchRootPath = rootFolderPath;
    const usesRustIndex = canUseContentSearch(searchRootPath);
    const usesProviderSearch = canUseProviderContentSearch(searchRootPath);
    if (!debouncedQuery || (!usesRustIndex && !usesProviderSearch)) {
      setRawResults([]);
      setIsSearching(false);
      setIsLoadingMore(false);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setSearchedFiles(0);
      setSearchableFiles(0);
      setIsIndexing(false);
      setIndexedFiles(0);
      setScannedFiles(0);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsSearching(true);
    setIsLoadingMore(false);
    setError(null);
    setSearchWarning(null);
    setRawResults([]);
    setNextFileOffset(0);
    setHasMoreResults(false);
    setSearchedFiles(0);
    setSearchableFiles(0);

    try {
      const response = usesProviderSearch
        ? await searchProviderFilesContent({
            query: debouncedQuery,
            rootFolderPath: searchRootPath,
            options: searchOptions,
            maxResults: CONTENT_SEARCH_PAGE_SIZE,
            fileOffset: 0,
            contextLines,
            includeQuery,
            excludeQuery,
          })
        : await searchFilesContent({
            root_path: searchRootPath,
            query: debouncedQuery,
            case_sensitive: searchOptions.caseSensitive,
            whole_word: searchOptions.wholeWord,
            use_regex: searchOptions.useRegex,
            max_results: CONTENT_SEARCH_PAGE_SIZE,
            file_offset: 0,
            context_lines: contextLines,
          });

      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (response.is_indexing) {
        setIsIndexing(true);
        setIndexedFiles(response.indexed_files);
        setScannedFiles(response.indexed_files);
        setRawResults([]);
        setNextFileOffset(0);
        setHasMoreResults(false);
        setSearchedFiles(0);
        setSearchableFiles(0);
        return;
      }

      setIsIndexing(false);
      setIndexedFiles(response.indexed_files);
      setScannedFiles(response.indexed_files);
      setRawResults(response.results);
      setNextFileOffset(response.next_file_offset);
      setHasMoreResults(response.has_more);
      setSearchedFiles(response.searched_files);
      setSearchableFiles(response.searchable_files);
      setSearchWarning(response.regex_fallback_error ?? null);
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      console.error("Search error:", err);
      setError(`Search failed: ${err}`);
      setRawResults([]);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setIsIndexing(false);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, [debouncedQuery, rootFolderPath, searchOptions, contextLines, includeQuery, excludeQuery]);

  const loadMoreResults = useCallback(async () => {
    const searchRootPath = rootFolderPath;
    const usesRustIndex = canUseContentSearch(searchRootPath);
    const usesProviderSearch = canUseProviderContentSearch(searchRootPath);
    if (
      !debouncedQuery ||
      (!usesRustIndex && !usesProviderSearch) ||
      !hasMoreResults ||
      nextFileOffset <= 0 ||
      isSearching ||
      isLoadingMore
    ) {
      return;
    }

    const currentRequestId = requestIdRef.current;
    setIsLoadingMore(true);
    setError(null);

    try {
      const response = usesProviderSearch
        ? await searchProviderFilesContent({
            query: debouncedQuery,
            rootFolderPath: searchRootPath,
            options: searchOptions,
            maxResults: CONTENT_SEARCH_PAGE_SIZE,
            fileOffset: nextFileOffset,
            contextLines,
            includeQuery,
            excludeQuery,
          })
        : await searchFilesContent({
            root_path: searchRootPath,
            query: debouncedQuery,
            case_sensitive: searchOptions.caseSensitive,
            whole_word: searchOptions.wholeWord,
            use_regex: searchOptions.useRegex,
            max_results: CONTENT_SEARCH_PAGE_SIZE,
            file_offset: nextFileOffset,
            context_lines: contextLines,
          });

      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (response.is_indexing) {
        setIsIndexing(true);
        setIndexedFiles(response.indexed_files);
        setScannedFiles(response.indexed_files);
        return;
      }

      setIsIndexing(false);
      setIndexedFiles(response.indexed_files);
      setScannedFiles(response.indexed_files);
      setRawResults((previousResults) => mergeSearchResults(previousResults, response.results));
      setNextFileOffset(response.next_file_offset);
      setHasMoreResults(response.has_more);
      setSearchedFiles((previous) => previous + response.searched_files);
      setSearchableFiles(response.searchable_files);
      setSearchWarning(response.regex_fallback_error ?? null);
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      console.error("Search error:", err);
      setError(`Search failed: ${err}`);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [
    debouncedQuery,
    rootFolderPath,
    hasMoreResults,
    nextFileOffset,
    isSearching,
    isLoadingMore,
    searchOptions,
    contextLines,
    includeQuery,
    excludeQuery,
  ]);

  useEffect(() => {
    if (!isIndexing || !debouncedQuery || !canUseContentSearch(rootFolderPath)) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollScanStatus = async () => {
      try {
        const status = await fffScanStatus(rootFolderPath);
        if (disposed) return;

        setIsIndexing(status.is_scanning);
        setScannedFiles(status.scanned_files_count);
        setIndexedFiles(status.indexed_files);

        if (status.is_scanning) {
          timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);
          return;
        }

        void performSearch();
      } catch (err) {
        if (disposed) return;
        console.error("Search index status error:", err);
        timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);
      }
    };

    timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [debouncedQuery, isIndexing, performSearch, rootFolderPath]);

  const results = useMemo(() => {
    const matchesPathFilters = createPathFilterPredicate(
      rootFolderPath,
      includeQuery,
      excludeQuery,
    );
    return rawResults.filter((result) => matchesPathFilters(result.file_path));
  }, [rawResults, rootFolderPath, includeQuery, excludeQuery]);

  useEffect(() => {
    performSearch();
  }, [debouncedQuery, performSearch]);

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    isSearching,
    isLoadingMore,
    error,
    searchWarning,
    hasMoreResults,
    searchedFiles,
    searchableFiles,
    isIndexing,
    indexedFiles,
    scannedFiles,
    rootFolderPath,
    searchOptions,
    setSearchOption,
    includeQuery,
    setIncludeQuery,
    excludeQuery,
    setExcludeQuery,
    contextLines,
    setContextLines,
    refreshSearch: performSearch,
    loadMoreResults,
  };
};
