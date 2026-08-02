import { useCallback, useEffect, useMemo, useState } from "react";
import { useCodeLens } from "@/features/editor/lsp/use-code-lens";
import type { RunActionItem } from "../types/run-action.types";
import { codeLensesToRunActions, discoverProjectRunActions } from "../utils/run-action-discovery";

export function useRunActionDiscovery(
  workspacePath: string | undefined,
  activeFilePath: string | undefined,
  includeCodeLenses: boolean,
) {
  const [projectActions, setProjectActions] = useState<RunActionItem[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const codeLenses = useCodeLens(activeFilePath, includeCodeLenses);

  useEffect(() => {
    if (!workspacePath) {
      setProjectActions([]);
      setDiscoveryError(null);
      return;
    }

    let cancelled = false;
    setIsDiscovering(true);
    setDiscoveryError(null);

    void discoverProjectRunActions(workspacePath)
      .then((actions) => {
        if (!cancelled) setProjectActions(actions);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectActions([]);
        setDiscoveryError(error instanceof Error ? error.message : "Could not scan project");
      })
      .finally(() => {
        if (!cancelled) setIsDiscovering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [revision, workspacePath]);

  const lspActions = useMemo(
    () => (activeFilePath ? codeLensesToRunActions(codeLenses, activeFilePath) : []),
    [activeFilePath, codeLenses],
  );
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  return {
    projectActions,
    lspActions,
    isDiscovering,
    discoveryError,
    refresh,
  };
}
