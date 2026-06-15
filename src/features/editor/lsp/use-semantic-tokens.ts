import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { normalizeLineEndings } from "../utils/html";
import { LspClient } from "./lsp-client";

export interface SemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenTypeName?: string;
  tokenModifiers: number;
}

export interface SemanticTokenState {
  tokens: SemanticToken[];
  content: string;
  filePath?: string;
}

// Standard LSP semantic token types (order matters — matches capability declaration)
export const TOKEN_TYPE_NAMES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as const;

const DEBOUNCE_MS = 800;

export const useSemanticTokens = (
  filePath: string | undefined,
  enabled: boolean,
  content = "",
): SemanticTokenState => {
  const [tokenState, setTokenState] = useState<SemanticTokenState>(() => ({
    tokens: [],
    content: normalizeLineEndings(content),
    filePath,
  }));
  const contentRef = useRef(content);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const fetchTokens = useCallback(
    async (contentSnapshot = normalizeLineEndings(contentRef.current)) => {
      const id = ++requestIdRef.current;

      if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
        setTokenState({ tokens: [], content: contentSnapshot, filePath });
        return;
      }

      const lspClient = LspClient.getInstance();
      if (!lspClient.getActiveServerEntryForFile(filePath)) {
        setTokenState({ tokens: [], content: contentSnapshot, filePath });
        return;
      }
      const requestFilePath = filePath;
      const result = await lspClient.getSemanticTokens(filePath);

      if (id !== requestIdRef.current) return;
      setTokenState({ tokens: result, content: contentSnapshot, filePath: requestFilePath });
    },
    [filePath, enabled],
  );

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

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
        const contentSnapshot = normalizeLineEndings(contentRef.current);
        void fetchTokens(contentSnapshot);
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchTokens]);

  return tokenState;
};
