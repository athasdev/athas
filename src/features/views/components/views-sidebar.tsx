import { useEffect } from "react";
import { getViewBufferPath } from "@/features/views/lib/view-buffer";
import { useViewsStore } from "@/features/views/stores/views.store";
import type { CustomViewDefinition } from "@/features/views/types/view.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import { PlusIcon, SquaresFourIcon, TrashIcon } from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarWorkspace,
} from "@/ui/sidebar";

interface ViewsSidebarProps {
  projectPath: string | null;
}

export function ViewsSidebar({ projectPath }: ViewsSidebarProps) {
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
    if (projectPath) viewActions.loadProject(projectPath);
  }, [viewActions, projectPath]);

  const openView = (view?: CustomViewDefinition) => {
    if (!projectPath) return;
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
        <SidebarIconButton
          tooltip="Create View"
          tooltipSide="bottom"
          aria-label="Create View"
          disabled={!projectPath}
          onClick={() => openView()}
        >
          <PlusIcon />
        </SidebarIconButton>
      }
      className="font-sans select-none"
    >
      {!projectPath ? (
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
              <ContextMenu key={view.id}>
                <ContextMenuTrigger
                  onContextMenu={(event) => event.stopPropagation()}
                  render={
                    <SidebarListItem
                      leading={<SquaresFourIcon />}
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
                  }
                />
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => openView(view)}>
                    <SquaresFourIcon />
                    Open View
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => removeView(view.id)}>
                    <TrashIcon />
                    Delete View
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </SidebarScrollArea>
      )}
    </SidebarWorkspace>
  );
}
