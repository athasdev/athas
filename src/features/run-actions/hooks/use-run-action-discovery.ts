import { TEAM_WORKSPACE_CHANGED_EVENT } from "@/features/workspace/team/services/team-workspace-service";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCodeLens } from "@/features/editor/lsp/use-code-lens";
import type { RunActionItem } from "../types/run-action.types";
import { codeLensesToRunActions, discoverProjectRunActions } from "../utils/run-action-discovery";

export function useRunActionDiscovery(
  workspacePath: string | undefined,
  activeFilePath: string | undefined,
  includeCodeLenses: boolean,
) {
  const [projectResult, setProjectResult] = useState<{
    workspacePath?: string;
    actions: RunActionItem[];
  }>({ actions: [] });
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((current) => current + 1);
    window.addEventListener(TEAM_WORKSPACE_CHANGED_EVENT, changed);
    return () => window.removeEventListener(TEAM_WORKSPACE_CHANGED_EVENT, changed);
  }, []);
  const codeLenses = useCodeLens(activeFilePath, includeCodeLenses);

  useEffect(() => {
    if (!workspacePath) {
      setProjectResult({ workspacePath, actions: [] });
      setDiscoveryError(null);
      setIsDiscovering(false);
      return;
    }

    let cancelled = false;
    setProjectResult({ workspacePath, actions: [] });
    setIsDiscovering(true);
    setDiscoveryError(null);

    void discoverProjectRunActions(workspacePath)
      .then((actions) => {
        if (!cancelled) setProjectResult({ workspacePath, actions });
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectResult({ workspacePath, actions: [] });
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
    projectActions: projectResult.workspacePath === workspacePath ? projectResult.actions : [],
    lspActions,
    isDiscovering,
    discoveryError,
    refresh,
  };
}
