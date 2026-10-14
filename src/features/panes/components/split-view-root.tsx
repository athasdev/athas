import { memo, useEffect, useMemo, useState } from "react";
import { WorkbenchFullscreenSurface } from "@/ui/workbench-fullscreen-surface";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { WorkspaceStoreScopeContext } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { cn } from "@/utils/cn";
import { usePaneStore } from "../stores/pane.store";
import { findPaneGroup } from "../services/pane-tree";
import {
  selectMountedWorkspaceIds,
  selectRecentWorkspaceIds,
} from "../services/workspace-view-cache";
import { PaneContainer } from "./pane-container";
import { PaneNodeRenderer } from "./pane-node-renderer";

const EMPTY_WORKSPACE_IDS: readonly string[] = [];

const SplitViewRoot = memo(function SplitViewRoot({
  activeSurface = true,
}: {
  activeSurface?: boolean;
}) {
  const root = usePaneStore.use.root();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const exitPaneFullscreen = usePaneStore((state) => state.actions.exitPaneFullscreen);
  const fullscreenPane = usePaneStore((state) =>
    state.fullscreenPaneId
      ? (findPaneGroup(state.root, state.fullscreenPaneId) ??
        findPaneGroup(state.bottomRoot, state.fullscreenPaneId))
      : null,
  );

  useEffect(() => {
    if (fullscreenPaneId && !fullscreenPane) {
      exitPaneFullscreen();
    }
  }, [exitPaneFullscreen, fullscreenPane, fullscreenPaneId]);

  return (
    <>
      <div className="size-full overflow-hidden">
        <PaneNodeRenderer node={root} hiddenPaneId={fullscreenPaneId} />
      </div>

      {activeSurface && fullscreenPane && (
        <WorkbenchFullscreenSurface>
          <PaneContainer pane={fullscreenPane} />
        </WorkbenchFullscreenSurface>
      )}
    </>
  );
});

export function CachedWorkspaceSplitViews({
  keepMountedWorkspaceIds = EMPTY_WORKSPACE_IDS,
}: {
  /** Workspaces to keep mounted past the cache limit, such as ones with an agent mid-turn. */
  keepMountedWorkspaceIds?: readonly string[];
}) {
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeWorkspaceId =
    projectTabs.find((projectTab) => projectTab.isActive)?.id ??
    workspaceRuntimeRegistry.getActiveWorkspaceId();
  const eligibleWorkspaceIds = useMemo(
    () =>
      projectTabs
        .filter(
          (projectTab) =>
            projectTab.id === activeWorkspaceId ||
            workspaceRuntimeRegistry.isWorkspaceReady(projectTab.id),
        )
        .map((projectTab) => projectTab.id),
    [activeWorkspaceId, projectTabs],
  );
  const [recentWorkspaceIds, setRecentWorkspaceIds] = useState<string[]>([]);
  const renderedWorkspaceIds = useMemo(
    () =>
      selectMountedWorkspaceIds({
        activeWorkspaceId,
        recentWorkspaceIds,
        eligibleWorkspaceIds,
        keepMountedWorkspaceIds,
      }),
    [activeWorkspaceId, eligibleWorkspaceIds, keepMountedWorkspaceIds, recentWorkspaceIds],
  );

  useEffect(() => {
    setRecentWorkspaceIds((currentWorkspaceIds) => {
      const nextWorkspaceIds = selectRecentWorkspaceIds(
        [activeWorkspaceId, ...currentWorkspaceIds, ...eligibleWorkspaceIds],
        eligibleWorkspaceIds,
      );

      return nextWorkspaceIds.length === currentWorkspaceIds.length &&
        nextWorkspaceIds.every((workspaceId, index) => workspaceId === currentWorkspaceIds[index])
        ? currentWorkspaceIds
        : nextWorkspaceIds;
    });
  }, [activeWorkspaceId, eligibleWorkspaceIds]);

  if (renderedWorkspaceIds.length === 0) {
    return <SplitViewRoot />;
  }

  return (
    <div className="relative size-full overflow-hidden">
      {renderedWorkspaceIds.map((workspaceId) => {
        const isActive = workspaceId === activeWorkspaceId;

        return (
          <WorkspaceStoreScopeContext.Provider key={workspaceId} value={workspaceId}>
            <div
              aria-hidden={!isActive}
              inert={!isActive}
              className={cn(
                "absolute inset-0 overflow-hidden",
                isActive ? "visible z-10" : "invisible pointer-events-none",
              )}
            >
              <SplitViewRoot activeSurface={isActive} />
            </div>
          </WorkspaceStoreScopeContext.Provider>
        );
      })}
    </div>
  );
}
