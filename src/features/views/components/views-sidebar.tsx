import { useEffect } from "react";
import { getViewBufferPath } from "@/features/views/lib/view-buffer";
import { useViewsStore } from "@/features/views/stores/views.store";
import type { CustomViewDefinition } from "@/features/views/types/view.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { ProBadge } from "@/features/window/components/pro-badge";
import { EmptyState } from "@/ui/empty";
import { PlusIcon, StackIcon, TrashIcon } from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListItem,
  SidebarScrollArea,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { ViewsProState } from "./views-pro-state";

interface ViewsSidebarProps {
  projectPath: string | null;
}

export function ViewsSidebar({ projectPath }: ViewsSidebarProps) {
  const { hasViews } = useProFeature();
  const storedViews = useViewsStore((state) =>
    projectPath ? state.viewsByProject[projectPath] : undefined,
  );
  const views = storedViews ?? [];
  const hasLoadedProject = useViewsStore((state) =>
    projectPath ? state.loadedProjectPaths.includes(projectPath) : false,
  );
  const viewActions = useViewsStore.use.actions();
  const activeBuffer = useBufferStore((state) =>
    state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : undefined,
  );

  useEffect(() => {
    if (projectPath && hasViews) viewActions.loadProject(projectPath);
  }, [hasViews, viewActions, projectPath]);

  const openView = (view?: CustomViewDefinition) => {
    if (!projectPath || !hasViews) return;
    useBufferStore.getState().actions.openContent({
      type: "customView",
      projectPath,
      viewId: view?.id,
      name: view?.name,
    });
  };

  const removeView = (viewId: string) => {
    if (!projectPath) return;
    const path = getViewBufferPath(projectPath, viewId);
    const viewBuffers = useBufferStore
      .getState()
      .buffers.filter((buffer) => buffer.type === "customView" && buffer.path === path);
    viewBuffers.forEach((buffer) => {
      useBufferStore.getState().actions.closeBuffer(buffer.id);
    });
    viewActions.removeView(projectPath, viewId);
  };

  return (
    <SidebarWorkspace
      title="Views"
      actions={
        hasViews ? (
          <SidebarIconButton
            tooltip="Create View"
            tooltipSide="bottom"
            aria-label="Create View"
            disabled={!projectPath}
            onClick={() => openView()}
          >
            <PlusIcon />
          </SidebarIconButton>
        ) : (
          <ProBadge />
        )
      }
    >
      {!hasViews ? (
        <ViewsProState layout="sidebar" />
      ) : !projectPath ? (
        <EmptyState layout="sidebar" message="Open a project to manage custom views." />
      ) : !hasLoadedProject ? null : views.length === 0 ? (
        <EmptyState
          layout="sidebar"
          message="No custom views yet"
          action={{ label: "Create View", onClick: () => openView(), icon: <PlusIcon /> }}
        />
      ) : (
        <SidebarScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 overflow-x-hidden">
            {views.map((view) => (
              <SidebarListActionRow
                key={view.id}
                actions={[
                  <SidebarIconButton
                    key="delete"
                    tone="danger"
                    tooltip="Delete View"
                    tooltipSide="right"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeView(view.id);
                    }}
                  >
                    <TrashIcon />
                  </SidebarIconButton>,
                ]}
              >
                <SidebarListItem
                  leading={<StackIcon />}
                  description={view.kind === "github" ? "GitHub view" : "JSON view"}
                  active={
                    activeBuffer?.type === "customView" &&
                    activeBuffer.projectPath === projectPath &&
                    activeBuffer.viewId === view.id
                  }
                  onClick={() => openView(view)}
                >
                  {view.name}
                </SidebarListItem>
              </SidebarListActionRow>
            ))}
          </div>
        </SidebarScrollArea>
      )}
    </SidebarWorkspace>
  );
}
