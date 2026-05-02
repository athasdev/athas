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

export interface InlayHintLineRange {
  startLine: number;
  endLine: number;
}

const DEBOUNCE_MS = 500;

export const useInlayHints = (
  filePath: string | undefined,
  enabled: boolean,
  lineRange: InlayHintLineRange,
) => {
  const [hints, setHints] = useState<InlayHint[]>([]);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

  const fetchHints = useCallback(async () => {
    const id = ++requestIdRef.current;

    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setHints([]);
      return;
    }

    const lspClient = LspClient.getInstance();

    const result = await lspClient.getInlayHints(filePath, lineRange.startLine, lineRange.endLine);

    if (id !== requestIdRef.current) return;
    setHints(result);
  }, [filePath, enabled, lineRange.startLine, lineRange.endLine]);

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
