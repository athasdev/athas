import { useEffect, useMemo, useState } from "react";
import { WorkbenchFullscreenSurface } from "@/features/window/components/workbench-fullscreen-surface";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { WorkspaceStoreScopeContext } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { cn } from "@/utils/cn";
import { usePaneStore } from "../stores/pane.store";
import { findPaneGroup } from "../utils/pane-tree";
import { PaneContainer } from "./pane-container";
import { PaneNodeRenderer } from "./pane-node-renderer";

function SplitViewRoot({ activeSurface = true }: { activeSurface?: boolean }) {
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
}

const MAX_CACHED_WORKSPACES = 3;

export function CachedWorkspaceSplitViews() {
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
      [activeWorkspaceId, ...recentWorkspaceIds, ...eligibleWorkspaceIds]
        .filter(
          (workspaceId, index, workspaceIds) =>
            workspaceId !== "workspace:welcome" &&
            eligibleWorkspaceIds.includes(workspaceId) &&
            workspaceIds.indexOf(workspaceId) === index,
        )
        .slice(0, MAX_CACHED_WORKSPACES),
    [activeWorkspaceId, eligibleWorkspaceIds, recentWorkspaceIds],
  );

  useEffect(() => {
    setRecentWorkspaceIds((currentWorkspaceIds) => {
      const nextWorkspaceIds = [activeWorkspaceId, ...currentWorkspaceIds, ...eligibleWorkspaceIds]
        .filter(
          (workspaceId, index, workspaceIds) =>
            workspaceId !== "workspace:welcome" &&
            eligibleWorkspaceIds.includes(workspaceId) &&
            workspaceIds.indexOf(workspaceId) === index,
        )
        .slice(0, MAX_CACHED_WORKSPACES);

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
