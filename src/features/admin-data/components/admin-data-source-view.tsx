import { useCallback, useEffect, useState } from "react";
import { getAdminDataBufferPath } from "@/features/admin-data/lib/admin-data-buffer";
import { loadAdminDataSourceTable } from "@/features/admin-data/services/admin-data-service";
import { useAdminDataStore } from "@/features/admin-data/stores/admin-data.store";
import type { AdminDataSource, AdminDataTable } from "@/features/admin-data/types/admin-data.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { AdminDataContent } from "@/features/panes/types/pane-content.types";
import { CsvTableView } from "@/features/viewer/csv/components/csv-table-view";
import { ViewerHeader } from "@/features/viewer/components/viewer-header";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { ArrowClockwiseIcon, PencilSimpleLineIcon, TableIcon, WarningCircleIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { AdminDataSourceSetup } from "./admin-data-source-setup";

interface AdminDataSourceViewProps {
  buffer: AdminDataContent;
}

export function AdminDataSourceView({ buffer }: AdminDataSourceViewProps) {
  const storedSources = useAdminDataStore((state) => state.sourcesByProject[buffer.projectPath]);
  const sources = storedSources ?? [];
  const hasLoadedProject = useAdminDataStore((state) =>
    state.loadedProjectPaths.includes(buffer.projectPath),
  );
  const adminDataActions = useAdminDataStore.use.actions();
  const [table, setTable] = useState<AdminDataTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(!buffer.sourceId);
  const source = buffer.sourceId
    ? sources.find((candidate) => candidate.id === buffer.sourceId)
    : undefined;

  useEffect(() => {
    adminDataActions.loadProject(buffer.projectPath);
  }, [adminDataActions, buffer.projectPath]);

  const loadSource = useCallback(
    async (nextSource: AdminDataSource) => {
      setIsLoading(true);
      setError(null);
      try {
        const nextTable = await loadAdminDataSourceTable(nextSource, buffer.projectPath);
        setTable(nextTable);
        return nextTable;
      } catch (nextError) {
        setTable(null);
        setError(nextError instanceof Error ? nextError.message : "Could not load this source");
        throw nextError;
      } finally {
        setIsLoading(false);
      }
    },
    [buffer.projectPath],
  );

  useEffect(() => {
    if (!source || isConfiguring) return;
    void loadSource(source).catch(() => undefined);
  }, [isConfiguring, loadSource, source]);

  const handleSave = async (nextSource: AdminDataSource) => {
    const nextTable = await loadSource(nextSource);
    adminDataActions.upsertSource(buffer.projectPath, nextSource);

    const currentBuffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.id === buffer.id);
    if (currentBuffer?.type === "adminData") {
      useBufferStore.getState().actions.updateBuffer({
        ...currentBuffer,
        path: getAdminDataBufferPath(buffer.projectPath, nextSource.id),
        name: nextSource.name,
        sourceId: nextSource.id,
      });
    }

    setTable(nextTable);
    setIsConfiguring(false);
  };

  const handleCancelSetup = () => {
    if (source) {
      setIsConfiguring(false);
      return;
    }
    useBufferStore.getState().actions.closeBuffer(buffer.id);
  };

  if (isConfiguring) {
    return (
      <AdminDataSourceSetup
        projectPath={buffer.projectPath}
        source={source}
        onCancel={handleCancelSetup}
        onSave={handleSave}
      />
    );
  }

  if (!hasLoadedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Spinner label="Loading data source" showLabel />
      </div>
    );
  }

  if (!source) {
    return (
      <EmptyState
        className="h-full rounded-none bg-background"
        icon={<WarningCircleIcon />}
        title="Data source not found"
        message="This source may have been removed from the project."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ViewerHeader
        icon={<TableIcon />}
        title={source.name}
        detail={source.kind === "github" ? "Project GitHub" : "JSON"}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isLoading}
              onClick={() => void loadSource(source).catch(() => undefined)}
            >
              <ArrowClockwiseIcon />
              Refresh
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setIsConfiguring(true)}>
              <PencilSimpleLineIcon />
              Configure
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1">
        {isLoading && !table ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label={`Loading ${source.name}`} showLabel />
          </div>
        ) : error ? (
          <EmptyState
            className="h-full rounded-none"
            tone="error"
            title="Could not load data source"
            message={error}
            action={{
              label: "Try again",
              onClick: () => void loadSource(source).catch(() => undefined),
            }}
            secondaryAction={{
              label: "Configure",
              onClick: () => setIsConfiguring(true),
              variant: "ghost",
            }}
          />
        ) : table ? (
          <CsvTableView columns={table.columns} rows={table.rows} />
        ) : null}
      </div>
    </div>
  );
}
