import {
  Braces,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Layers,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import { useMongoDbStore } from "./stores/mongodb-store";

interface MongoDBViewerProps {
  connectionId: string;
}

export default function MongoDBViewer({ connectionId }: MongoDBViewerProps) {
  const store = useMongoDbStore();
  const { actions } = store;
  const [filterInput, setFilterInput] = useState("{}");

  useEffect(() => {
    actions.init(connectionId);
    return () => actions.reset();
  }, [connectionId, actions]);

  const handleApplyFilter = () => {
    actions.setFilterJson(filterInput);
    actions.refresh();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-secondary-bg/30 text-text">
      <div className="mx-2 mt-2 rounded-2xl bg-primary-bg/85 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-bg/70 px-2.5 py-1">
            <Database className="text-text-lighter" />
            <span className="ui-font text-sm">{store.fileName}</span>
          </div>
          {store.selectedDatabase && (
            <>
              <span className="text-text-lighter text-xs">Database</span>
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
          <div className="ml-auto flex items-center gap-1 text-text-lighter text-xs">
            <Layers />
            <span>{store.collections.length} collections</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-1.5">
        <div className="flex w-56 flex-col overflow-hidden rounded-2xl bg-primary-bg/85">
          <div className="flex items-center gap-1.5 border-border/60 border-b px-3 py-2">
            <Layers className="text-text-lighter" />
            <span className="ui-font text-text-lighter text-xs">Collections</span>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {store.collections.map((col) => (
              <Button
                key={col.name}
                onClick={() => actions.selectCollection(col.name)}
                variant="ghost"
                size="xs"
                className={cn(
                  "block h-auto w-full justify-start rounded-lg px-2 py-1 text-left text-xs",
                  store.selectedCollection === col.name && "bg-selected",
                )}
                aria-label={`Select collection ${col.name}`}
              >
                {col.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary-bg/85">
          <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
            <Input
              className="flex-1"
              placeholder='Filter JSON, e.g. {"name": "John"}'
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
              aria-label="MongoDB filter query"
            />
            <Button
              onClick={handleApplyFilter}
              size="sm"
              className="gap-1.5"
              aria-label="Apply filter"
            >
              <Braces />
              Apply
            </Button>
            <Button
              onClick={() => setFilterInput("{}")}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label="Reset filter"
            >
              Reset
            </Button>
            <Button
              onClick={() => actions.refresh()}
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-text-lighter"
              aria-label="Refresh"
            >
              <RefreshCw />
            </Button>
          </div>

          {!store.isLoading && !store.selectedCollection && (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="rounded-2xl border border-border/60 bg-secondary-bg/40 px-5 py-4 text-center">
                <div className="text-sm">Select a collection</div>
                <div className="mt-1 text-text-lighter text-xs">
                  Choose a collection from the sidebar to browse documents.
                </div>
              </div>
            </div>
          )}

          {store.error && (
            <div className="mx-3 mt-3 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 text-xs">
              {store.error}
            </div>
          )}

          {store.isLoading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="flex items-center gap-2 text-sm text-text-lighter">
                <RefreshCw className="animate-spin" />
                Loading...
              </div>
            </div>
          )}

          {!store.isLoading && store.documents.length > 0 && (
            <div className="custom-scrollbar flex-1 overflow-auto p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-text-lighter text-xs">
                  {store.totalCount} document{store.totalCount === 1 ? "" : "s"}
                </div>
                {store.selectedCollection && (
                  <div className="rounded-full bg-secondary-bg/70 px-2.5 py-1 text-text-lighter text-xs">
                    {store.selectedCollection}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {store.documents.map((doc, i) => {
                  const id = doc._id ? String(doc._id) : String(i);
                  return (
                    <div
                      key={id}
                      className="group rounded-2xl border border-border/60 bg-secondary-bg/40 p-3 shadow-[0_10px_30px_-28px_rgba(0,0,0,0.55)]"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="truncate text-text-lighter text-xs">Document {i + 1}</div>
                        <Button
                          onClick={() => actions.deleteDocument(id)}
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-full text-red-400 opacity-0 transition-all hover:bg-red-500/10 group-hover:opacity-100"
                          aria-label={`Delete document ${id}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <pre className="ui-font overflow-x-auto whitespace-pre-wrap rounded-xl bg-primary-bg/70 p-3 text-xs leading-5">
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
              <div className="rounded-2xl border border-border/60 bg-secondary-bg/40 px-5 py-4 text-center">
                <div className="text-sm">No documents found</div>
                <div className="mt-1 text-text-lighter text-xs">
                  The current filter returned an empty result set.
                </div>
              </div>
            </div>
          )}

          {!store.isLoading && store.totalPages > 1 && (
            <div className="flex items-center justify-between border-border/60 border-t px-3 py-2">
              <span className="ui-font text-text-lighter text-xs">
                Page {store.currentPage} of {store.totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => actions.setCurrentPage(1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="First page"
                >
                  <ChevronsLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage - 1)}
                  disabled={store.currentPage === 1}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.currentPage + 1)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
                <Button
                  onClick={() => actions.setCurrentPage(store.totalPages)}
                  disabled={store.currentPage === store.totalPages}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
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
