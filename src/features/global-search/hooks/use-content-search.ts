import { useCallback, useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileSearchResult } from "@/features/global-search/lib/rust-api/search";
import { searchFilesContent } from "@/features/global-search/lib/rust-api/search";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";

export const useContentSearch = (isVisible: boolean) => {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performSearch = useCallback(async () => {
    if (!debouncedQuery || !rootFolderPath) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await searchFilesContent({
        root_path: rootFolderPath,
        query: debouncedQuery,
        case_sensitive: false,
        max_results: 100,
      });

      setResults(searchResults);
    } catch (err) {
      console.error("Search error:", err);
      setError(`Search failed: ${err}`);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [debouncedQuery, rootFolderPath]);

  useEffect(() => {
    if (isVisible) {
      performSearch();
    }
  }, [debouncedQuery, isVisible, performSearch]);

  // Reset when visibility changes
  useEffect(() => {
    if (!isVisible) {
      setQuery("");
      setResults([]);
      setError(null);
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
  };
};
