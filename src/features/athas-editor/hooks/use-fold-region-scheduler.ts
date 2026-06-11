import { useEffect } from "react";
import { useFoldStore } from "@/features/editor/stores/fold.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { fileOpenBenchmark } from "@/features/athas-editor/utils/file-open-benchmark";

interface UseFoldRegionSchedulerOptions {
  filePath?: string;
  content: string;
  enabled: boolean;
  typingDebounceMs: number;
}

export function useFoldRegionScheduler({
  filePath,
  content,
  enabled,
  typingDebounceMs,
}: UseFoldRegionSchedulerOptions) {
  const foldActions = useFoldStore.use.actions();

  useEffect(() => {
    if (!enabled || !filePath || !content) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    const computeFolds = () => {
      if (cancelled) return;
      if (fileOpenBenchmark.has(filePath)) {
        fileOpenBenchmark.mark(filePath, "fold-start");
      }
      foldActions.computeFoldRegions(filePath, content);
      if (fileOpenBenchmark.has(filePath)) {
        fileOpenBenchmark.mark(filePath, "fold-done");
      }
    };

    const scheduleFoldCompute = () => {
      if (cancelled) return;
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(computeFolds, { timeout: 500 });
        return;
      }
      timeoutId = globalThis.setTimeout(computeFolds, 0);
    };

    const latestInputTimestamp = useEditorUIStore.getState().lastInputTimestamp;
    const isTypingUpdate =
      latestInputTimestamp > 0 && Date.now() - latestInputTimestamp < typingDebounceMs;

    if (isTypingUpdate) {
      timeoutId = globalThis.setTimeout(scheduleFoldCompute, typingDebounceMs);
    } else {
      scheduleFoldCompute();
    }

    return () => {
      cancelled = true;
      if (idleId !== null) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [content, enabled, filePath, foldActions, typingDebounceMs]);
}
