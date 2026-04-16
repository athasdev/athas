import { useCallback, useEffect, useRef, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { LspClient } from "./lsp-client";

export interface SemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
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

export const useSemanticTokens = (filePath: string | undefined, enabled: boolean) => {
  const [tokens, setTokens] = useState<SemanticToken[]>([]);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestIdRef = useRef(0);
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

  const fetchTokens = useCallback(async () => {
    if (!filePath || !enabled || !extensionRegistry.isLspSupported(filePath)) {
      setTokens([]);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();
    if (!lspClient.getActiveServerEntryForFile(filePath)) {
      setTokens([]);
      return;
    }
    const result = await lspClient.getSemanticTokens(filePath);

    if (id !== requestIdRef.current) return;
    setTokens(result);
  }, [filePath, enabled]);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  useEffect(() => {
    if (lastInputTimestamp === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fetchTokens();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastInputTimestamp, fetchTokens]);

  return tokens;
};
