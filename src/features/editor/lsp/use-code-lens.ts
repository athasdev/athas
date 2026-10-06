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

const NO_LENSES: CodeLensItem[] = [];

export const useCodeLens = (filePath: string | undefined, enabled: boolean) => {
  const [lenses, setLensesState] = useState<CodeLensItem[]>(NO_LENSES);
  const requestIdRef = useRef(0);
  // Disabled callers don't follow the document revision, which changes on every keystroke.
  const lspStatusRevision = useLspStore((state) => {
    if (!enabled || !filePath) return "";
    const { status, activeWorkspaces, supportedLanguages, documentRevision } = state.lspStatus;
    return `${status}:${activeWorkspaces.join("|")}:${supportedLanguages?.join("|") ?? ""}:${documentRevision}`;
  });
  const setLenses = useCallback((next: CodeLensItem[]) => {
    setLensesState((current) =>
      next.length === 0 ? (current.length === 0 ? current : NO_LENSES) : next,
    );
  }, []);

  const fetchLenses = useCallback(async () => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setLenses([]);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();
    if (!lspClient.getActiveServerEntryForFile(filePath) || !lspClient.isDocumentOpen(filePath)) {
      setLenses([]);
      return;
    }

    const result = await lspClient.getCodeLens(filePath);

    if (id !== requestIdRef.current) return;
    setLenses(result);
  }, [filePath, enabled, setLenses]);

  useEffect(() => {
    void fetchLenses();
  }, [fetchLenses, lspStatusRevision]);

  return lenses;
};
