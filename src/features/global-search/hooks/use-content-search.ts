import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileSearchResult } from "@/features/global-search/lib/rust-api/search";
import { searchFilesContent } from "@/features/global-search/lib/rust-api/search";
import { CONTENT_SEARCH_BACKEND_LIMIT, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { matchesPathFilters } from "../utils/path-filters";

export interface ContentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export const useContentSearch = (isVisible: boolean) => {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [rawResults, setRawResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (!debouncedQuery || !rootFolderPath) {
      setRawResults([]);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await searchFilesContent({
        root_path: rootFolderPath,
        query: debouncedQuery,
        case_sensitive: searchOptions.caseSensitive,
        whole_word: searchOptions.wholeWord,
        use_regex: searchOptions.useRegex,
        max_results: CONTENT_SEARCH_BACKEND_LIMIT,
        context_lines: contextLines,
      });

      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      setRawResults(searchResults);
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      console.error("Search error:", err);
      setError(`Search failed: ${err}`);
      setRawResults([]);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, [debouncedQuery, rootFolderPath, searchOptions, contextLines]);

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
      setError(null);
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
    error,
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
  };
};
