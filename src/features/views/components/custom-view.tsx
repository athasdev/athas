import { useCallback, useEffect, useState } from "react";
import { getViewBufferPath } from "@/features/views/lib/view-buffer";
import { loadViewTable } from "@/features/views/services/view-data-service";
import { useViewsStore } from "@/features/views/stores/views.store";
import type { CustomViewDefinition, ViewTable } from "@/features/views/types/view.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import type { CustomViewContent } from "@/features/panes/types/pane-content.types";
import { CsvTableView } from "@/features/viewer/csv/components/csv-table-view";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import {
  ArrowClockwiseIcon,
  PencilSimpleLineIcon,
  SquaresFourIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { ViewSetup } from "./view-setup";

interface CustomViewProps {
  buffer: CustomViewContent;
}

export function CustomView({ buffer }: CustomViewProps) {
  const storedViews = useViewsStore((state) => state.viewsByProject[buffer.projectPath]);
  const views = storedViews ?? [];
  const hasLoadedProject = useViewsStore((state) =>
    state.loadedProjectPaths.includes(buffer.projectPath),
  );
  const viewActions = useViewsStore.use.actions();
  const [table, setTable] = useState<ViewTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(!buffer.viewId);
  const view = buffer.viewId
    ? views.find((candidate) => candidate.id === buffer.viewId)
    : undefined;

  useEffect(() => {
    viewActions.loadProject(buffer.projectPath);
  }, [viewActions, buffer.projectPath]);

  const loadView = useCallback(
    async (nextView: CustomViewDefinition) => {
      setIsLoading(true);
      setError(null);
      try {
        const nextTable = await loadViewTable(nextView, buffer.projectPath);
        setTable(nextTable);
        return nextTable;
      } catch (nextError) {
        setTable(null);
        setError(nextError instanceof Error ? nextError.message : "Could not load this view");
        throw nextError;
      } finally {
        setIsLoading(false);
      }
    },
    [buffer.projectPath],
  );

  useEffect(() => {
    if (!view || isConfiguring) return;
    void loadView(view).catch(() => undefined);
  }, [isConfiguring, loadView, view]);

  const handleSave = async (nextView: CustomViewDefinition) => {
    const nextTable = await loadView(nextView);
    viewActions.upsertView(buffer.projectPath, nextView);

    const currentBuffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.id === buffer.id);
    if (currentBuffer?.type === "customView") {
      useBufferStore.getState().actions.updateBuffer({
        ...currentBuffer,
        path: getViewBufferPath(buffer.projectPath, nextView.id),
        name: nextView.name,
        viewId: nextView.id,
      });
    }

    setTable(nextTable);
    setIsConfiguring(false);
  };

  const handleCancelSetup = () => {
    if (view) {
      setIsConfiguring(false);
      return;
    }
    useBufferStore.getState().actions.closeBuffer(buffer.id);
  };

  if (isConfiguring) {
    return (
      <ViewSetup
        projectPath={buffer.projectPath}
        view={view}
        onCancel={handleCancelSetup}
        onSave={handleSave}
      />
    );
  }

  if (!hasLoadedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Spinner label="Loading custom view" showLabel />
      </div>
    );
  }

  if (!view) {
    return (
      <EmptyState
        className="h-full rounded-none bg-background"
        icon={<WarningCircleIcon />}
        title="View not found"
        message="This view may have been deleted from the project."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <PaneContentHeader
        context={
          <PathBreadcrumb
            segments={["Views", view.name]}
            icons={[<SquaresFourIcon key="views" />, undefined]}
            ariaLabel="Custom view"
          />
        }
        detail={view.kind === "github" ? "GitHub" : "JSON"}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isLoading}
              onClick={() => void loadView(view).catch(() => undefined)}
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
            <Spinner label={`Loading ${view.name}`} showLabel />
          </div>
        ) : error ? (
          <EmptyState
            className="h-full rounded-none"
            tone="error"
            title="Could not load custom view"
            message={error}
            action={{
              label: "Try again",
              onClick: () => void loadView(view).catch(() => undefined),
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
