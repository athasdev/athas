import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { LspClient } from "./lsp-client";

export interface CodeLensItem {
  line: number;
  title: string;
  command?: string;
}

const DEBOUNCE_MS = 1000;

export const useCodeLens = (filePath: string | undefined, enabled: boolean) => {
  const [lenses, setLenses] = useState<CodeLensItem[]>([]);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

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
    if (lastInputTimestamp === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fetchLenses();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastInputTimestamp, fetchLenses]);

  return lenses;
};
