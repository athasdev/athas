import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminDataSourceDialog } from "@/features/admin-data/components/admin-data-source-dialog";
import {
  loadAdminDataSources,
  saveAdminDataSources,
} from "@/features/admin-data/lib/admin-data-model";
import { loadAdminDataSource } from "@/features/admin-data/services/admin-data-service";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Dialog } from "@/ui/dialog";
import { PencilSimpleLineIcon, PlusIcon, TableIcon, TrashIcon } from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarSectionHeader,
  SidebarSectionStack,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";

interface AdminDataSidebarSectionProps {
  expanded: boolean;
  projectPath: string | null;
}

export function AdminDataSidebarSection({ expanded, projectPath }: AdminDataSidebarSectionProps) {
  const [sources, setSources] = useState<AdminDataSource[]>([]);
  const [editingSource, setEditingSource] = useState<AdminDataSource | null | undefined>(undefined);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);

  useEffect(() => {
    setSources(projectPath ? loadAdminDataSources(projectPath) : []);
    setEditingSource(undefined);
  }, [projectPath]);

  const persistSources = useCallback(
    (nextSources: AdminDataSource[]) => {
      if (!projectPath) return;
      saveAdminDataSources(projectPath, nextSources);
      setSources(nextSources);
    },
    [projectPath],
  );

  const openSource = useCallback(
    async (source: AdminDataSource, content?: string) => {
      if (!projectPath || loadingSourceId) return;

      setLoadingSourceId(source.id);
      const toastId = toast.loading(`Loading ${source.name}...`);

      try {
        const csv = content ?? (await loadAdminDataSource(source));
        const path = `admin-data://${encodeURIComponent(projectPath)}/${source.id}`;
        const bufferStore = useBufferStore.getState();
        const bufferId = bufferStore.actions.openContent({
          type: "csvPreview",
          path,
          name: source.name,
          content: csv,
          sourceFilePath: path,
        });
        const buffer = useBufferStore.getState().buffers.find((item) => item.id === bufferId);

        if (
          buffer?.type === "csvPreview" &&
          (buffer.content !== csv || buffer.name !== source.name)
        ) {
          useBufferStore
            .getState()
            .actions.updateBuffer({ ...buffer, name: source.name, content: csv });
        }

        toast.success(`${source.name} loaded`, { id: toastId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load this source", {
          id: toastId,
        });
      } finally {
        setLoadingSourceId(null);
      }
    },
    [loadingSourceId, projectPath],
  );

  const handleSaveSource = useCallback(
    async (source: AdminDataSource) => {
      if (!projectPath) return;
      const csv = await loadAdminDataSource(source);
      const nextSources = sources.some((item) => item.id === source.id)
        ? sources.map((item) => (item.id === source.id ? source : item))
        : [...sources, source];

      persistSources(nextSources);
      await openSource(source, csv);
    },
    [openSource, persistSources, projectPath, sources],
  );

  const removeSource = useCallback(
    (sourceId: string) => {
      persistSources(sources.filter((source) => source.id !== sourceId));
    },
    [persistSources, sources],
  );

  if (!projectPath) return null;

  const showAddDialog = editingSource !== undefined;
  const firstSource = sources[0];

  return (
    <>
      {!expanded ? (
        <SidebarListItem
          leading={loadingSourceId ? <Spinner compact label="Loading admin data" /> : <TableIcon />}
          iconOnly
          aria-label={firstSource ? `Open ${firstSource.name}` : "Add admin data source"}
          onClick={() => {
            if (firstSource) void openSource(firstSource);
            else setEditingSource(null);
          }}
        >
          Admin Data
        </SidebarListItem>
      ) : (
        <SidebarSectionStack className="max-h-[42%] min-h-0 overflow-y-auto pr-2 pb-1">
          <SidebarSectionHeader
            expanded={!isCollapsed}
            count={sources.length || undefined}
            onToggle={() => setIsCollapsed((current) => !current)}
            action={
              <SidebarIconButton
                tooltip="Add Data Source"
                tooltipSide="right"
                aria-label="Add Data Source"
                onClick={() => setEditingSource(null)}
              >
                <PlusIcon />
              </SidebarIconButton>
            }
          >
            Admin Data
          </SidebarSectionHeader>
          {!isCollapsed ? (
            sources.length > 0 ? (
              sources.map((source) => (
                <ContextMenu key={source.id}>
                  <ContextMenuTrigger
                    onContextMenu={(event) => event.stopPropagation()}
                    render={
                      <SidebarListItem
                        leading={
                          loadingSourceId === source.id ? (
                            <Spinner compact label={`Loading ${source.name}`} />
                          ) : (
                            <TableIcon />
                          )
                        }
                        disabled={loadingSourceId !== null}
                        onClick={() => void openSource(source)}
                      >
                        {source.name}
                      </SidebarListItem>
                    }
                  />
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => void openSource(source)}>
                      <TableIcon />
                      Refresh and Open
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setEditingSource(source)}>
                      <PencilSimpleLineIcon />
                      Edit Source
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onClick={() => removeSource(source.id)}>
                      <TrashIcon />
                      Remove Source
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            ) : (
              <SidebarListItem leading={<PlusIcon />} onClick={() => setEditingSource(null)}>
                Add Source
              </SidebarListItem>
            )
          ) : null}
        </SidebarSectionStack>
      )}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          if (!open) setEditingSource(undefined);
        }}
      >
        {showAddDialog ? (
          <AdminDataSourceDialog
            source={editingSource ?? undefined}
            onClose={() => setEditingSource(undefined)}
            onSave={handleSaveSource}
          />
        ) : null}
      </Dialog>
    </>
  );
}
