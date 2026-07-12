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
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import {
  databaseCardClassName,
  databaseChipClassName,
  databaseCodeBlockClassName,
  databaseHeaderClassName,
  databasePanelClassName,
} from "../../components/database-surface";
import { getMongoDocumentDisplayIndex } from "./mongodb-pagination";
import { useMongoDbStore } from "./stores/mongodb.store";

interface MongoDBViewerProps {
  connectionId: string;
}

export default function MongoDBViewer({ connectionId }: MongoDBViewerProps) {
  const store = useMongoDbStore();
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
    <div className="flex h-full flex-col overflow-hidden bg-secondary-bg/30 text-text">
      <div className={databaseHeaderClassName()}>
        <div className="flex items-center gap-2">
          <div className={databaseChipClassName()}>
            <Database className="text-text-lighter" />
            <span className="ui-font ui-text-sm">{store.fileName}</span>
          </div>
          {store.selectedDatabase && (
            <>
              <span className="text-text-lighter ui-text-sm">Database</span>
              <Select
                value={store.selectedDatabase}
                onChange={actions.selectDatabase}
                options={store.databases.map((db) => ({ value: db, label: db }))}
                aria-label="Select database"
                size="xs"
                className="rounded-full border-border/70 bg-secondary-bg/70 px-2.5 focus:border-accent/60 focus:ring-accent/30"
              />
            </>
          )}
          <div className="ml-auto flex items-center gap-1 text-text-lighter ui-text-sm">
            <Layers />
            <span>{store.collections.length} collections</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-1.5">
        <div className={databasePanelClassName("w-56")}>
          <div className="flex items-center gap-1.5 border-border/60 border-b px-3 py-2">
            <Layers className="text-text-lighter" />
            <span className="ui-font text-text-lighter ui-text-sm">Collections</span>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {store.collections.map((col) => (
              <Button
                key={col.name}
                onClick={() => actions.selectCollection(col.name)}
                variant="ghost"
                compact
                className={cn(
                  "block h-auto w-full justify-start rounded-lg px-2 py-1 text-left ui-text-sm leading-[1.35]",
                  store.selectedCollection === col.name && "bg-selected",
                )}
                aria-label={`Select collection ${col.name}`}
              >
                {col.name}
              </Button>
            ))}
          </div>
        </div>

        <div className={databasePanelClassName("flex-1")}>
          <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
            <Input
              className="flex-1"
              placeholder='Filter JSON, e.g. {"name": "John"}'
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyQuery()}
              aria-label="MongoDB filter query"
            />
            <Input
              className="w-56"
              placeholder='Sort JSON, e.g. {"createdAt": -1}'
              value={sortInput}
              onChange={(e) => setSortInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyQuery()}
              aria-label="MongoDB sort query"
            />
            <Button onClick={handleApplyQuery} className="gap-1.5" aria-label="Apply query" compact>
              <Braces />
              Apply
            </Button>
            <Button
              onClick={handleResetQuery}
              variant="ghost"
              compact
              className="px-2 py-1 text-text-lighter"
              aria-label="Reset query"
            >
              Reset
            </Button>
            <Button
              onClick={() => actions.refresh()}
              variant="ghost"
              compact
              className="text-text-lighter"
              aria-label="Refresh"
            >
              <RefreshCw />
            </Button>
          </div>

          {!store.isLoading && !store.selectedCollection && (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className={databaseCardClassName("px-5 py-4 text-center")}>
                <div className="ui-text-sm">Select a collection</div>
                <div className="mt-1 text-text-lighter ui-text-sm">
                  Choose a collection from the sidebar to browse documents.
                </div>
              </div>
            </div>
          )}

          {store.error && (
            <div className="mx-3 mt-3 mb-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-error ui-text-sm">
              {store.error}
            </div>
          )}

          {store.isLoading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <LoadingIndicator label="Loading" showLabel />
            </div>
          )}

          {!store.isLoading && store.documents.length > 0 && (
            <div className="custom-scrollbar flex-1 overflow-auto p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-text-lighter ui-text-sm">
                  {store.totalCount} document{store.totalCount === 1 ? "" : "s"}
                </div>
                {store.selectedCollection && (
                  <div className={databaseChipClassName("text-text-lighter ui-text-sm")}>
                    {store.selectedCollection}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {store.documents.map((doc, i) => {
                  const id = doc._id ? String(doc._id) : String(i);
                  const displayIndex = getMongoDocumentDisplayIndex(
                    store.currentPage,
                    store.pageSize,
                    i,
                  );
                  return (
                    <div
                      key={id}
                      className={databaseCardClassName(
                        "group p-3 shadow-[0_10px_30px_-28px_rgba(0,0,0,0.55)]",
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="truncate text-text-lighter ui-text-sm">
                          Document {displayIndex}
                        </div>
                        <Button
                          onClick={() => actions.deleteDocument(id)}
                          variant="ghost"
                          compact
                          className="text-error opacity-0 transition-[opacity,background-color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-error/10 group-hover:opacity-100"
                          aria-label={`Delete document ${id}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <pre
                        className={databaseCodeBlockClassName("overflow-x-auto bg-primary-bg/70")}
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
            <div className="flex flex-1 items-center justify-center px-6">
              <div className={databaseCardClassName("px-5 py-4 text-center")}>
                <div className="ui-text-sm">No documents found</div>
                <div className="mt-1 text-text-lighter ui-text-sm">
                  The current filter returned an empty result set.
                </div>
              </div>
            </div>
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
                  size="xs"
                  className="min-w-16"
                />
                <span className="ui-font text-text-lighter ui-text-sm">per page</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-2 ui-font text-text-lighter ui-text-sm">
                  Page {store.currentPage} of {store.totalPages}
                </span>
                <Button
                  onClick={() => actions.setCurrentPage(1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  compact
                  aria-label="First page"
                >
                  <ChevronsLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage - 1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  compact
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage + 1)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  compact
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.totalPages)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  compact
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
