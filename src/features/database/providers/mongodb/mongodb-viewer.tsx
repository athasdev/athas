import {
  BracketsCurlyIcon as Braces,
  CaretLeftIcon as ChevronLeft,
  CaretRightIcon as ChevronRight,
  CaretDoubleLeftIcon as ChevronsLeft,
  CaretDoubleRightIcon as ChevronsRight,
  DatabaseIcon as Database,
  StackIcon as Layers,
  ArrowClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useEffect, useState } from "react";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import Select from "@/ui/select";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import {
  databaseChipClassName,
  databaseCodeBlockClassName,
  databasePanelClassName,
} from "../../components/database-surface";
import { getMongoDocumentDisplayIndex } from "./mongodb-pagination";
import { createMongoDbStore } from "./stores/mongodb.store";

interface MongoDBViewerProps {
  connectionId: string;
}

export default function MongoDBViewer({ connectionId }: MongoDBViewerProps) {
  const [useStore] = useState(() => createMongoDbStore());
  const store = useStore();
  const { actions } = store;
  const [filterInput, setFilterInput] = useState("{}");
  const [sortInput, setSortInput] = useState("{}");

  useEffect(() => {
    actions.init(connectionId);
    return () => actions.reset();
  }, [connectionId, actions]);

  useEffect(() => {
    setFilterInput(store.filterJson);
  }, [store.filterJson]);

  useEffect(() => {
    setSortInput(store.sortJson);
  }, [store.sortJson]);

  const handleApplyQuery = () => {
    actions.setQueryJson(filterInput, sortInput);
  };

  const handleResetQuery = () => {
    setFilterInput("{}");
    setSortInput("{}");
    actions.setQueryJson("{}", "{}");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <PaneContentHeader
        context={
          <PathBreadcrumb
            segments={[store.fileName, ...(store.selectedDatabase ? [store.selectedDatabase] : [])]}
            icons={[<Database key="database" />]}
            ariaLabel="MongoDB database"
          />
        }
        detail={`${store.collections.length} collections`}
        actions={
          store.selectedDatabase ? (
            <Select
              value={store.selectedDatabase}
              onChange={actions.selectDatabase}
              options={store.databases.map((db) => ({ value: db, label: db }))}
              aria-label="Select database"
              className="min-w-28"
            />
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className={databasePanelClassName("w-56 shrink-0 border-border/60 border-r")}>
          <PaneContentHeader leading={<Layers />} title="Collections" />
          <ScrollArea className="flex-1" contentClassName="space-y-0.5 p-1.5">
            {store.collections.map((col) => (
              <Button
                key={col.name}
                onClick={() => actions.selectCollection(col.name)}
                variant="ghost"
                className={cn(
                  "block h-auto w-full justify-start rounded-lg px-2 py-1 text-left ui-text-sm leading-row",
                  store.selectedCollection === col.name && "bg-selected",
                )}
                aria-label={`Select collection ${col.name}`}
              >
                {col.name}
              </Button>
            ))}
          </ScrollArea>
        </div>

        <div className={databasePanelClassName("flex-1")}>
          <PaneContentHeader
            context={
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Input
                  className="min-w-0 flex-1"
                  placeholder='Filter JSON, e.g. {"name": "John"}'
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyQuery()}
                  aria-label="MongoDB filter query"
                />
                <Input
                  className="w-48"
                  placeholder='Sort JSON, e.g. {"createdAt": -1}'
                  value={sortInput}
                  onChange={(e) => setSortInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyQuery()}
                  aria-label="MongoDB sort query"
                />
              </div>
            }
            actions={
              <>
                <Button onClick={handleApplyQuery} className="gap-1.5" aria-label="Apply query">
                  <Braces />
                  Apply
                </Button>
                <Button
                  onClick={handleResetQuery}
                  variant="ghost"
                  className="px-2 py-1 text-subtle-foreground"
                  aria-label="Reset query"
                >
                  Reset
                </Button>
                <Button
                  onClick={() => actions.refresh()}
                  variant="ghost"
                  iconOnly
                  className="text-subtle-foreground"
                  aria-label="Refresh"
                >
                  <RefreshCw />
                </Button>
              </>
            }
          />

          {!store.isLoading && !store.selectedCollection && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Select a collection</EmptyTitle>
                <EmptyDescription>
                  Choose a collection from the sidebar to browse documents.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {store.error && (
            <Alert tone="error" className="mx-3 mt-3 mb-2 w-auto">
              <AlertDescription>{store.error}</AlertDescription>
            </Alert>
          )}

          {store.isLoading && (
            <Empty>
              <EmptyDescription>
                <Spinner label="Loading" showLabel />
              </EmptyDescription>
            </Empty>
          )}

          {!store.isLoading && store.documents.length > 0 && (
            <div className="flex-1 overflow-auto p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-subtle-foreground ui-text-sm">
                  {store.totalCount} document{store.totalCount === 1 ? "" : "s"}
                </div>
                {store.selectedCollection && (
                  <div className={databaseChipClassName("text-subtle-foreground ui-text-sm")}>
                    {store.selectedCollection}
                  </div>
                )}
              </div>
              <div className="divide-y divide-border/60 border-y border-border/60">
                {store.documents.map((doc, i) => {
                  const id = doc._id ? String(doc._id) : String(i);
                  const displayIndex = getMongoDocumentDisplayIndex(
                    store.currentPage,
                    store.pageSize,
                    i,
                  );
                  return (
                    <div key={id} className="group py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="truncate text-subtle-foreground ui-text-sm">
                          Document {displayIndex}
                        </div>
                        <Button
                          onClick={() => actions.deleteDocument(id)}
                          variant="ghost"
                          iconOnly
                          className="text-destructive opacity-0 transition-[opacity,background-color] duration-fast ease-smooth hover:bg-destructive/10 group-hover:opacity-100"
                          aria-label={`Delete document ${id}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <pre
                        className={databaseCodeBlockClassName("overflow-x-auto bg-background/70")}
                      >
                        {JSON.stringify(doc, null, 2)}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!store.isLoading && store.documents.length === 0 && store.selectedCollection && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No documents found</EmptyTitle>
                <EmptyDescription>
                  The current filter returned an empty result set.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {!store.isLoading && store.totalPages > 1 && (
            <div className="flex items-center justify-between border-border/60 border-t px-3 py-2">
              <div className="flex items-center gap-2">
                <Select
                  value={store.pageSize.toString()}
                  options={[
                    { value: "10", label: "10" },
                    { value: "25", label: "25" },
                    { value: "50", label: "50" },
                    { value: "100", label: "100" },
                    { value: "500", label: "500" },
                  ]}
                  onChange={(value) => actions.setPageSize(Number(value))}
                  aria-label="Documents per page"
                  className="min-w-16"
                />
                <span className="font-sans text-subtle-foreground ui-text-sm">per page</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-2 font-sans text-subtle-foreground ui-text-sm">
                  Page {store.currentPage} of {store.totalPages}
                </span>
                <Button
                  onClick={() => actions.setCurrentPage(1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  iconOnly
                  aria-label="First page"
                >
                  <ChevronsLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage - 1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  iconOnly
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage + 1)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  iconOnly
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.totalPages)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  iconOnly
                  aria-label="Last page"
                >
                  <ChevronsRight />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
