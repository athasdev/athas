import { useEffect, useState } from "react";
import { fffSearchFiles, type FffSearchHit } from "@/features/global-search/lib/rust-api/search";
import { MAX_RESULTS } from "../constants/limits";

const canUseFffSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) && !rootPath?.startsWith("remote://") && !rootPath?.startsWith("diff://");

export const useFffSearch = (
  query: string,
  enabled: boolean,
  rootPath: string | null | undefined,
) => {
  const [hits, setHits] = useState<FffSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !query.trim() || !canUseFffSearch(rootPath)) {
      setHits([]);
      setError(null);
      return;
    }

    let cancelled = false;

    fffSearchFiles(query, MAX_RESULTS, rootPath)
      .then((results) => {
        if (cancelled) return;
        setHits(results);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[fff] search failed:", err);
        setError(String(err));
        setHits([]);
      });

    return () => {
      cancelled = true;
    };
  }, [query, enabled, rootPath]);

  return { hits, error };
};
