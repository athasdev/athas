import { useCallback, useEffect, useState } from "react";
import { getViewBufferPath } from "@/features/views/lib/view-buffer";
import { resolveViewPresentation } from "@/features/views/lib/view-presentation";
import { loadViewTable } from "@/features/views/services/view-data-service";
import { useViewsStore } from "@/features/views/stores/views.store";
import type {
  CustomViewDefinition,
  ViewLayout,
  ViewPresentation,
  ViewTable,
} from "@/features/views/types/view.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import type { CustomViewContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import {
  ArrowClockwiseIcon,
  ColumnsIcon,
  ListIcon,
  PencilSimpleLineIcon,
  StackIcon,
  TableIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import { ToggleGroup } from "@/ui/toggle-group";
import { ViewDataDisplay } from "./view-data-display";
import { ViewSetup } from "./view-setup";

interface CustomViewProps {
  buffer: CustomViewContent;
}

const viewLayoutOptions = [
  { value: "table" as const, label: "Table", icon: <TableIcon /> },
  { value: "list" as const, label: "List", icon: <ListIcon /> },
  { value: "board" as const, label: "Board", icon: <ColumnsIcon /> },
];

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
  const viewDataKey = view
    ? view.kind === "github"
      ? `${view.kind}:${view.endpointPath}:${view.rowsPath}`
      : `${view.kind}:${view.url}:${view.authentication}:${view.rowsPath}`
    : null;
  const presentation = view && table ? resolveViewPresentation(view, table) : null;

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
    if (!buffer.viewId || !viewDataKey || isConfiguring) return;
    const currentView = useViewsStore
      .getState()
      .viewsByProject[buffer.projectPath]?.find((candidate) => candidate.id === buffer.viewId);
    if (currentView) void loadView(currentView).catch(() => undefined);
  }, [buffer.projectPath, buffer.viewId, isConfiguring, loadView, viewDataKey]);

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

  const updatePresentation = (nextPresentation: ViewPresentation) => {
    if (!view) return;
    viewActions.upsertView(buffer.projectPath, {
      ...view,
      presentation: nextPresentation,
    });
  };

  const handleLayoutChange = (layout: ViewLayout) => {
    if (!presentation) return;
    updatePresentation({
      ...view?.presentation,
      layout,
      ...(layout === "board" && view?.presentation?.groupBy === undefined
        ? { groupBy: presentation.groupBy }
        : {}),
    });
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
            icons={[<StackIcon key="views" />, undefined]}
            ariaLabel="Custom view"
          />
        }
        detail={
          table && presentation
            ? `${table.rows.length} items · ${presentation.layout}`
            : view.kind === "github"
              ? "GitHub"
              : "JSON"
        }
        actions={
          <>
            {table && presentation ? (
              <>
                <ToggleGroup
                  type="single"
                  value={presentation.layout}
                  onValueChange={handleLayoutChange}
                  options={viewLayoutOptions}
                  ariaLabel="View layout"
                  iconOnly
                  wrap={false}
                />
                <Select
                  value={presentation.groupBy ?? "__none__"}
                  onChange={(groupBy) =>
                    updatePresentation({
                      ...view.presentation,
                      layout: presentation.layout,
                      groupBy: groupBy === "__none__" ? null : groupBy,
                    })
                  }
                  options={[
                    { value: "__none__", label: "No grouping" },
                    ...table.columns.map((column) => ({ value: column, label: column })),
                  ]}
                  variant="ghost"
                  menuWidth="content"
                  leftIcon={ColumnsIcon}
                  aria-label="Group rows"
                />
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={isLoading}
              onClick={() => void loadView(view).catch(() => undefined)}
            >
              <ArrowClockwiseIcon />
              Refresh
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsConfiguring(true)}>
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
        ) : table && presentation ? (
          <ViewDataDisplay table={table} presentation={presentation} />
        ) : null}
      </div>
    </div>
  );
}
