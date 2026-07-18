import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { normalizeWorkspaceFolders } from "@/features/file-system/controllers/workspace-session";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { pathStartsWithRoot } from "@/utils/path-helpers";
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

export function getActiveProjectWorkspaces(
  projectWorkspacePaths: string[],
  activeWorkspaces: string[],
): string[] {
  return activeWorkspaces.filter((workspace) =>
    projectWorkspacePaths.some((projectPath) => pathStartsWithRoot(workspace, projectPath)),
  );
}

export function getWorkspaceSymbolKey(symbol: WorkspaceSymbolItem): string {
  return JSON.stringify([symbol.filePath, symbol.line, symbol.character, symbol.name, symbol.kind]);
}

export function mergeWorkspaceSymbolResults(
  resultGroups: WorkspaceSymbolItem[][],
): WorkspaceSymbolItem[] {
  const seen = new Set<string>();
  const symbols: WorkspaceSymbolItem[] = [];

  for (const symbol of resultGroups.flat()) {
    const key = getWorkspaceSymbolKey(symbol);
    if (seen.has(key)) continue;
    seen.add(key);
    symbols.push(symbol);
  }

  return symbols;
}

export const useWorkspaceSymbolSearch = (query: string, isActive: boolean) => {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const activeWorkspaces = useLspStore((state) => state.lspStatus.activeWorkspaces);
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const trimmedQuery = debouncedQuery.slice(1).trim();
  const [state, setState] = useState<{ key: string | null; symbols: WorkspaceSymbolItem[] }>({
    key: null,
    symbols: [],
  });

  const projectWorkspacePaths = useMemo(
    () => normalizeWorkspaceFolders(rootFolderPath, workspaceFolders).map((folder) => folder.path),
    [rootFolderPath, workspaceFolders],
  );
  const activeProjectWorkspaces = useMemo(
    () => getActiveProjectWorkspaces(projectWorkspacePaths, activeWorkspaces),
    [projectWorkspacePaths, activeWorkspaces],
  );
  const searchKey =
    isActive && trimmedQuery ? JSON.stringify([trimmedQuery, activeProjectWorkspaces]) : null;

  useEffect(() => {
    if (!searchKey) return;
    let cancelled = false;

    (async () => {
      if (activeProjectWorkspaces.length === 0) {
        if (!cancelled) setState({ key: searchKey, symbols: [] });
        return;
      }

      const lspClient = LspClient.getInstance();
      const resultGroups = await Promise.all(
        activeProjectWorkspaces.map((workspacePath) =>
          lspClient.getWorkspaceSymbols(trimmedQuery, workspacePath),
        ),
      );
      if (cancelled) return;
      setState({ key: searchKey, symbols: mergeWorkspaceSymbolResults(resultGroups) });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectWorkspaces, searchKey, trimmedQuery]);

  const hasCurrentResult = searchKey !== null && state.key === searchKey;

  return {
    symbols: hasCurrentResult ? state.symbols : [],
    isLoading: searchKey !== null && state.key !== searchKey,
  };
};
