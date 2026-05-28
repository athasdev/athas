import { useEffect, useState } from "react";
import { fffSearchFiles, type FffSearchHit } from "../lib/rust-api/search";
import { MAX_RESULTS } from "../constants/limits";

const canUseFffSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) && !rootPath?.startsWith("remote://") && !rootPath?.startsWith("diff://");

export const useFffSearch = (
  query: string,
  enabled: boolean,
  rootPath: string | null | undefined,
  limit = MAX_RESULTS,
) => {
  const [hits, setHits] = useState<FffSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!enabled || !query.trim() || !canUseFffSearch(rootPath)) {
      setHits([]);
      setError(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    fffSearchFiles(query, limit, rootPath)
      .then((results) => {
        if (cancelled) return;
        setHits(results);
        setError(null);
        setIsSearching(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[fff] search failed:", err);
        setError(String(err));
        setHits([]);
        setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, enabled, rootPath, limit]);

  return { hits, error, isSearching };
};
