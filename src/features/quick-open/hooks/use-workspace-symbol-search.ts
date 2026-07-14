import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";

export interface WorkspaceSymbolItem {
  name: string;
  kind: string;
  detail?: string;
  line: number;
  character: number;
  containerName?: string;
  filePath: string;
}

/**
 * Resolve which active LSP workspace root a file belongs to, using a
 * longest-prefix match (so nested workspace roots resolve to the most
 * specific one). Returns null when there is no active buffer path or no
 * workspace covers it, rather than guessing.
 */
export function resolveWorkspaceForFile(
  filePath: string,
  activeWorkspaces: string[],
): string | null {
  let bestMatch: string | null = null;

  for (const workspace of activeWorkspaces) {
    const normalizedWorkspace = workspace.endsWith("/") ? workspace.slice(0, -1) : workspace;
    const isExactMatch = filePath === normalizedWorkspace;
    const isNestedMatch = filePath.startsWith(`${normalizedWorkspace}/`);

    if (!isExactMatch && !isNestedMatch) continue;
    if (!bestMatch || normalizedWorkspace.length > bestMatch.length) {
      bestMatch = normalizedWorkspace;
    }
  }

  return bestMatch;
}

export const useWorkspaceSymbolSearch = (query: string, isActive: boolean) => {
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const trimmedQuery = debouncedQuery.slice(1).trim();
  const [state, setState] = useState<{ key: string | null; symbols: WorkspaceSymbolItem[] }>({
    key: null,
    symbols: [],
  });

  const searchKey = isActive && trimmedQuery ? trimmedQuery : null;

  useEffect(() => {
    if (!searchKey) return;
    let cancelled = false;

    (async () => {
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      if (!activeBuffer?.path) {
        if (!cancelled) setState({ key: searchKey, symbols: [] });
        return;
      }

      const lspClient = LspClient.getInstance();
      const workspacePath = resolveWorkspaceForFile(
        activeBuffer.path,
        lspClient.getActiveWorkspaces(),
      );
      if (!workspacePath) {
        if (!cancelled) setState({ key: searchKey, symbols: [] });
        return;
      }

      const result = await lspClient.getWorkspaceSymbols(trimmedQuery, workspacePath);
      if (cancelled) return;
      setState({ key: searchKey, symbols: result });
    })();

    return () => {
      cancelled = true;
    };
  }, [searchKey, trimmedQuery]);

  const hasCurrentResult = searchKey !== null && state.key === searchKey;

  return {
    symbols: hasCurrentResult ? state.symbols : [],
    isLoading: searchKey !== null && state.key !== searchKey,
  };
};
