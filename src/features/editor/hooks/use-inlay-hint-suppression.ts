import { useEffect, useState } from "react";
import { useEditorUIStore } from "../stores/ui-store";

interface UseInlayHintSuppressionOptions {
  durationMs: number;
}

export function useInlayHintSuppression({ durationMs }: UseInlayHintSuppressionOptions): boolean {
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    let lastHandledTimestamp = useEditorUIStore.getState().lastInputTimestamp;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    const unsubscribe = useEditorUIStore.subscribe((state) => {
      if (state.lastInputTimestamp === 0 || state.lastInputTimestamp === lastHandledTimestamp) {
        return;
      }

      lastHandledTimestamp = state.lastInputTimestamp;
      setSuppressed(true);

      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
      }
      timeout = globalThis.setTimeout(() => {
        setSuppressed(false);
        timeout = null;
      }, durationMs);
    });

    return () => {
      unsubscribe();
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
      }
    };
  }, [durationMs]);

  return suppressed;
}
