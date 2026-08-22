import { useEffect } from "react";
import { getAdminDataBufferPath } from "@/features/admin-data/lib/admin-data-buffer";
import { useAdminDataStore } from "@/features/admin-data/stores/admin-data.store";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import { PlusIcon, TableIcon, TrashIcon } from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarWorkspace,
} from "@/ui/sidebar";

interface AdminDataSidebarProps {
  projectPath: string | null;
}

export function AdminDataSidebar({ projectPath }: AdminDataSidebarProps) {
  const storedSources = useAdminDataStore((state) =>
    projectPath ? state.sourcesByProject[projectPath] : undefined,
  );
  const sources = storedSources ?? [];
  const hasLoadedProject = useAdminDataStore((state) =>
    projectPath ? state.loadedProjectPaths.includes(projectPath) : false,
  );
  const adminDataActions = useAdminDataStore.use.actions();
  const activeBuffer = useBufferStore((state) =>
    state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : undefined,
  );

  useEffect(() => {
    if (projectPath) adminDataActions.loadProject(projectPath);
  }, [adminDataActions, projectPath]);

  const openSource = (source?: AdminDataSource) => {
    if (!projectPath) return;
    useBufferStore.getState().actions.openContent({
      type: "adminData",
      projectPath,
      sourceId: source?.id,
      name: source?.name,
    });
  };

  const removeSource = (sourceId: string) => {
    if (!projectPath) return;
    const path = getAdminDataBufferPath(projectPath, sourceId);
    const sourceBuffers = useBufferStore
      .getState()
      .buffers.filter((buffer) => buffer.type === "adminData" && buffer.path === path);
    sourceBuffers.forEach((buffer) => {
      useBufferStore.getState().actions.closeBuffer(buffer.id);
    });
    adminDataActions.removeSource(projectPath, sourceId);
  };

  return (
    <SidebarWorkspace
      title="Data Sources"
      actions={
        <SidebarIconButton
          tooltip="Add Source"
          tooltipSide="bottom"
          aria-label="Add Source"
          disabled={!projectPath}
          onClick={() => openSource()}
        >
          <PlusIcon />
        </SidebarIconButton>
      }
      className="font-sans select-none"
    >
      {!projectPath ? (
        <EmptyState layout="sidebar" message="Open a project to manage data sources." />
      ) : !hasLoadedProject ? null : sources.length === 0 ? (
        <EmptyState
          layout="sidebar"
          message="No data sources yet"
          action={{ label: "Add Source", onClick: () => openSource(), icon: <PlusIcon /> }}
        />
      ) : (
        <SidebarScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 overflow-x-hidden">
            {sources.map((source) => (
              <ContextMenu key={source.id}>
                <ContextMenuTrigger
                  onContextMenu={(event) => event.stopPropagation()}
                  render={
                    <SidebarListItem
                      leading={<TableIcon />}
                      description={source.kind === "github" ? "Project GitHub" : "JSON"}
                      active={
                        activeBuffer?.type === "adminData" &&
                        activeBuffer.projectPath === projectPath &&
                        activeBuffer.sourceId === source.id
                      }
                      onClick={() => openSource(source)}
                    >
                      {source.name}
                    </SidebarListItem>
                  }
                />
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => openSource(source)}>
                    <TableIcon />
                    Open Source
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => removeSource(source.id)}>
                    <TrashIcon />
                    Remove Source
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
