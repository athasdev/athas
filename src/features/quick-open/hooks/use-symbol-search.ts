import { useCallback, useEffect, useState } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { fuzzyScore } from "../utils/fuzzy-search";

export interface SymbolItem {
  name: string;
  kind: string;
  detail?: string;
  line: number;
  character: number;
  containerName?: string;
  filePath: string;
}

const SYMBOL_KIND_ORDER: Record<string, number> = {
  class: 0,
  interface: 1,
  struct: 2,
  enum: 3,
  function: 4,
  method: 5,
  constructor: 6,
  property: 7,
  field: 8,
  variable: 9,
  constant: 10,
};

export const useSymbolSearch = (query: string, isActive: boolean) => {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSymbols = useCallback(async () => {
    const bufferStore = useBufferStore.getState();
    const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);

    if (!activeBuffer?.path || !extensionRegistry.isLspSupported(activeBuffer.path)) {
      setSymbols([]);
      return;
    }

    setIsLoading(true);
    try {
      const lspClient = LspClient.getInstance();
      const result = await lspClient.getDocumentSymbols(activeBuffer.path);
      setSymbols(
        result.map((s) => ({
          ...s,
          filePath: activeBuffer.path,
        })),
      );
    } catch {
      setSymbols([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch symbols when entering symbol mode
  useEffect(() => {
    if (isActive) {
      void fetchSymbols();
    } else {
      setSymbols([]);
    }
  }, [isActive, fetchSymbols]);

  // Filter symbols by query (everything after @)
  const symbolQuery = query.slice(1).trim();
  const filteredSymbols = symbolQuery
    ? symbols
        .map((symbol) => ({
          symbol,
          score: fuzzyScore(symbol.name, symbolQuery),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ symbol }) => symbol)
    : symbols.sort((a, b) => {
        const kindDiff = (SYMBOL_KIND_ORDER[a.kind] ?? 99) - (SYMBOL_KIND_ORDER[b.kind] ?? 99);
        if (kindDiff !== 0) return kindDiff;
        return a.line - b.line;
      });

  return {
    symbols: filteredSymbols,
    isLoading,
  };
};
