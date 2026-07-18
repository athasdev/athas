import { useEffect, useState } from "react";
import { fffSearchFiles, type FffSearchHit } from "@/features/global-search/lib/rust-api/search";
import { canUseNativeFileSearch } from "@/features/global-search/utils/file-search-paths";
import { MAX_RESULTS } from "../constants/limits";

export const useFffSearch = (
  query: string,
  enabled: boolean,
  rootPath: string | null | undefined,
) => {
  const trimmedQuery = query.trim();
  const searchRootPath = canUseNativeFileSearch(rootPath) ? rootPath : null;
  const searchKey =
    enabled && trimmedQuery && searchRootPath
      ? JSON.stringify([searchRootPath, trimmedQuery])
      : null;
  const [searchState, setSearchState] = useState<{
    key: string | null;
    hits: FffSearchHit[];
    error: string | null;
  }>({
    key: null,
    hits: [],
    error: null,
  });

  useEffect(() => {
    if (!searchKey || !searchRootPath) return;

    let cancelled = false;

    fffSearchFiles(trimmedQuery, MAX_RESULTS, searchRootPath)
      .then((results) => {
        if (cancelled) return;
        setSearchState({ key: searchKey, hits: results, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[fff] search failed:", err);
        setSearchState({ key: searchKey, hits: [], error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [searchKey, searchRootPath, trimmedQuery]);

  const hasCurrentResult = searchKey !== null && searchState.key === searchKey;

  return {
    hits: hasCurrentResult ? searchState.hits : [],
    error: hasCurrentResult ? searchState.error : null,
    isSearching: searchKey !== null && searchState.key !== searchKey,
    canSearch: searchRootPath !== null,
  };
};
