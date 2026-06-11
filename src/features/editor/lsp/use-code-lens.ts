import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { LspClient } from "./lsp-client";

export interface CodeLensItem {
  line: number;
  title: string;
  command?: string;
  arguments?: unknown[];
}

const DEBOUNCE_MS = 1000;

export const useCodeLens = (filePath: string | undefined, enabled: boolean) => {
  const [lenses, setLenses] = useState<CodeLensItem[]>([]);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);

  const fetchLenses = useCallback(async () => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setLenses([]);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();
    const result = await lspClient.getCodeLens(filePath);

    if (id !== requestIdRef.current) return;
    setLenses(result);
  }, [filePath, enabled]);

  useEffect(() => {
    void fetchLenses();
  }, [fetchLenses]);

  useEffect(() => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      return;
    }

    let lastInputTimestamp = useEditorUIStore.getState().lastInputTimestamp;

    const unsubscribe = useEditorUIStore.subscribe((state) => {
      if (state.lastInputTimestamp === 0 || state.lastInputTimestamp === lastInputTimestamp) {
        return;
      }

      lastInputTimestamp = state.lastInputTimestamp;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void fetchLenses();
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchLenses]);

  return lenses;
};
