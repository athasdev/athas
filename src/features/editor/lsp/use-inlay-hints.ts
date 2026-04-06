import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { LspClient } from "./lsp-client";

export interface InlayHint {
  line: number;
  character: number;
  label: string;
  kind?: string;
  paddingLeft: boolean;
  paddingRight: boolean;
}

const DEBOUNCE_MS = 500;

export const useInlayHints = (filePath: string | undefined, enabled: boolean) => {
  const [hints, setHints] = useState<InlayHint[]>([]);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

  const fetchHints = useCallback(async () => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setHints([]);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();

    // Request hints for a large range (visible viewport would be ideal but
    // we don't have easy access here, so request first 1000 lines)
    const result = await lspClient.getInlayHints(filePath, 0, 1000);

    if (id !== requestIdRef.current) return;
    setHints(result);
  }, [filePath, enabled]);

  // Fetch on file change
  useEffect(() => {
    void fetchHints();
  }, [fetchHints]);

  // Re-fetch after typing (debounced)
  useEffect(() => {
    if (lastInputTimestamp === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fetchHints();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastInputTimestamp, fetchHints]);

  return hints;
};
