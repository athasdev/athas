import { useEffect, useState } from "react";
import { fffSearchFiles, type FffSearchHit } from "../lib/file-search-api";
import { getNativeWorkspaceRootPaths } from "../utils/file-search-paths";

function parseSearchRootPaths(searchKey: string) {
  try {
    const parsed = JSON.parse(searchKey);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) return [];
    return parsed[0].filter((path): path is string => typeof path === "string");
  } catch {
    return [];
  }
}

export const useFffSearch = (
  query: string,
  enabled: boolean,
  rootPaths: readonly string[],
  limit = 100,
) => {
  const trimmedQuery = query.trim();
  const searchRootPaths = getNativeWorkspaceRootPaths(rootPaths[0], rootPaths.slice(1));
  const searchKey =
    enabled && trimmedQuery && searchRootPaths.length > 0
      ? JSON.stringify([searchRootPaths, trimmedQuery, limit])
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
    if (!searchKey) return;

    const currentRootPaths = parseSearchRootPaths(searchKey);
    if (currentRootPaths.length === 0) return;
    let cancelled = false;

    fffSearchFiles(trimmedQuery, currentRootPaths, limit)
      .then((results) => {
        if (cancelled) return;
        setSearchState({ key: searchKey, hits: results, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[fff] search failed:", error);
        setSearchState({ key: searchKey, hits: [], error: String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [searchKey, trimmedQuery, limit]);

  const hasCurrentResult = searchKey !== null && searchState.key === searchKey;

  return {
    hits: hasCurrentResult ? searchState.hits : [],
    error: hasCurrentResult ? searchState.error : null,
    isSearching: searchKey !== null && searchState.key !== searchKey,
    canSearch: searchRootPaths.length > 0,
  };
};
