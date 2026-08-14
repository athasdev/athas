import { startTransition, useEffect, useMemo, useState } from "react";
import type { Token } from "@/features/editor/utils/html";
import {
  getSearchExcerptTokenSnapshot,
  loadSearchExcerptTokens,
} from "../services/search-excerpt-syntax";

const TOKENIZATION_DELAY_MS = 80;
const TOKENIZATION_RETRY_DELAY_MS = 500;
const MAX_TOKENIZATION_ATTEMPTS = 2;
const EMPTY_TOKENS: Token[] = [];
const DISABLED_SNAPSHOT = { key: "disabled", tokens: EMPTY_TOKENS, complete: false };

interface IdleScheduler {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

export function useSearchExcerptTokens({
  filePath,
  content,
  enabled,
}: {
  filePath: string;
  content: string;
  enabled: boolean;
}) {
  const snapshot = useMemo(
    () => (enabled ? getSearchExcerptTokenSnapshot(filePath, content) : DISABLED_SNAPSHOT),
    [content, enabled, filePath],
  );
  const [loadedSnapshot, setLoadedSnapshot] = useState(snapshot);
  const tokens = loadedSnapshot.key === snapshot.key ? loadedSnapshot.tokens : snapshot.tokens;

  useEffect(() => {
    if (!enabled || snapshot.complete) return;

    let cancelled = false;
    let idleId: number | null = null;
    let retryId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const scheduler = globalThis as typeof globalThis & IdleScheduler;
    const run = (attempt: number) => {
      void loadSearchExcerptTokens(filePath, content)
        .then((nextTokens) => {
          if (cancelled) return;
          startTransition(() => {
            setLoadedSnapshot({ key: snapshot.key, tokens: nextTokens, complete: true });
          });
        })
        .catch(() => {
          if (cancelled || attempt + 1 >= MAX_TOKENIZATION_ATTEMPTS) return;
          retryId = globalThis.setTimeout(() => {
            retryId = null;
            run(attempt + 1);
          }, TOKENIZATION_RETRY_DELAY_MS);
        });
    };
    const delayId = globalThis.setTimeout(() => {
      if (scheduler.requestIdleCallback) {
        idleId = scheduler.requestIdleCallback(() => run(0), { timeout: 400 });
      } else {
        run(0);
      }
    }, TOKENIZATION_DELAY_MS);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(delayId);
      if (idleId !== null) scheduler.cancelIdleCallback?.(idleId);
      if (retryId !== null) globalThis.clearTimeout(retryId);
    };
  }, [content, enabled, filePath, snapshot.complete, snapshot.key]);

  return tokens;
}
