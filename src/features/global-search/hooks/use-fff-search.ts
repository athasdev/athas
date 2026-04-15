import { useEffect, useState } from "react";
import { fffSearchFiles, type FffSearchHit } from "../lib/rust-api/search";
import { MAX_RESULTS } from "../constants/limits";

export const useFffSearch = (query: string, enabled: boolean) => {
  const [hits, setHits] = useState<FffSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !query.trim()) {
      setHits([]);
      setError(null);
      return;
    }

    let cancelled = false;

    fffSearchFiles(query, MAX_RESULTS)
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
  }, [query, enabled]);

  return { hits, error };
};
