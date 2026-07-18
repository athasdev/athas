import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { LspClient } from "./lsp-client";
import { useLspStore } from "./stores/lsp.store";

export interface CodeLensItem {
  line: number;
  title: string;
  command?: string;
  arguments?: unknown[];
}

export const useCodeLens = (filePath: string | undefined, enabled: boolean) => {
  const [lenses, setLenses] = useState<CodeLensItem[]>([]);
  const requestIdRef = useRef(0);
  const lspStatusRevision = useLspStore((state) => {
    const { status, activeWorkspaces, supportedLanguages } = state.lspStatus;
    return `${status}:${activeWorkspaces.join("|")}:${supportedLanguages?.join("|") ?? ""}`;
  });

  const fetchLenses = useCallback(async () => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setLenses([]);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();
    if (!lspClient.getActiveServerEntryForFile(filePath)) {
      setLenses([]);
      return;
    }

    const result = await lspClient.getCodeLens(filePath);

    if (id !== requestIdRef.current) return;
    setLenses(result);
  }, [filePath, enabled]);

  useEffect(() => {
    void fetchLenses();
  }, [fetchLenses, lspStatusRevision]);

  return lenses;
};
