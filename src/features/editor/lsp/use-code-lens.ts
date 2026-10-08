import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { subscribeToEditorDocumentChanges } from "../services/editor-document-events";
import { LspClient } from "./lsp-client";
import { useLspStore } from "./stores/lsp.store";

export interface CodeLensItem {
  line: number;
  title: string;
  command?: string;
  arguments?: unknown[];
}

const NO_LENSES: CodeLensItem[] = [];
/** How long edits to the file must pause before its lenses are asked for again. */
const EDIT_REFRESH_DELAY_MS = 400;

export const useCodeLens = (filePath: string | undefined, enabled: boolean) => {
  const [lenses, setLensesState] = useState<CodeLensItem[]>(NO_LENSES);
  const requestIdRef = useRef(0);
  // Disabled callers don't follow server or document state at all.
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

  // The status revision only moves when documents open or close, so edits refresh lenses here.
  useEffect(() => {
    if (!enabled || !filePath) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToEditorDocumentChanges((event) => {
      if (event.filePath !== filePath) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void fetchLenses();
      }, EDIT_REFRESH_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, fetchLenses, filePath]);

  return lenses;
};
