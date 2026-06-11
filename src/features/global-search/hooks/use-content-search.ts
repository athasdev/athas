import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileSearchResult } from "@/features/global-search/lib/rust-api/search";
import { searchFilesContent } from "@/features/global-search/lib/rust-api/search";
import { CONTENT_SEARCH_PAGE_SIZE, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { matchesPathFilters } from "../utils/path-filters";

export interface ContentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const canUseContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) && !rootPath?.startsWith("remote://") && !rootPath?.startsWith("diff://");

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

export const useContentSearch = (isVisible: boolean) => {
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
    if (!debouncedQuery || !canUseContentSearch(searchRootPath)) {
      setRawResults([]);
      setIsSearching(false);
      setIsLoadingMore(false);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setSearchedFiles(0);
      setSearchableFiles(0);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsSearching(true);
    setIsLoadingMore(false);
    setError(null);
    setSearchWarning(null);

    try {
      const response = await searchFilesContent({
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
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, [debouncedQuery, rootFolderPath, searchOptions, contextLines]);

  const loadMoreResults = useCallback(async () => {
    const searchRootPath = rootFolderPath;
    if (
      !debouncedQuery ||
      !canUseContentSearch(searchRootPath) ||
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
      const response = await searchFilesContent({
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
  ]);

  const results = useMemo(
    () =>
      rawResults.filter((result) =>
        matchesPathFilters(result.file_path, rootFolderPath, includeQuery, excludeQuery),
      ),
    [rawResults, rootFolderPath, includeQuery, excludeQuery],
  );

  useEffect(() => {
    if (isVisible) {
      performSearch();
    }
  }, [debouncedQuery, isVisible, performSearch]);

  // Reset when visibility changes
  useEffect(() => {
    if (!isVisible) {
      setQuery("");
      setRawResults([]);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setSearchedFiles(0);
      setSearchableFiles(0);
      setError(null);
      setSearchWarning(null);
      setIncludeQuery("");
      setExcludeQuery("");
      setContextLines(2);
    }
  }, [isVisible]);

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
