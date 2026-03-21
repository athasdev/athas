import { Database, FileText, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import { shouldIgnoreFile } from "@/features/quick-open/utils/file-filtering";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { getDirectoryPath } from "@/utils/path-helpers";

import type { PaneContent } from "@/features/panes/types/pane-content";

interface ContextSelectorProps {
  buffers: PaneContent[];
  allProjectFiles: never[];
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

const MAX_RESULTS = 20;
const SEARCH_DEBOUNCE_MS = 100;

export function ContextSelector({
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onToggleOpen,
}: Omit<ContextSelectorProps, "allProjectFiles">) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch] = useDebounce(searchTerm, SEARCH_DEBOUNCE_MS);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();

  // Pre-filtered file list (excludes directories + ignored files). Refreshed on each open.
  const [fileItems, setFileItems] = useState<Array<{ name: string; path: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;

    getAllProjectFiles().then((projectFiles) => {
      const filtered: Array<{ name: string; path: string }> = [];
      for (const file of projectFiles) {
        if (!file.isDir && !shouldIgnoreFile(file.path)) {
          filtered.push({ name: file.name, path: file.path });
        }
      }
      setFileItems(filtered);
    });
  }, [isOpen, getAllProjectFiles]);

  // Open buffer paths as Set for O(1) lookup
  const openBufferPathSet = useMemo(() => new Set(buffers.map((b) => b.path)), [buffers]);

  const allItems = useMemo(() => {
    const bufferItems = buffers.map((buffer) => ({
      type: "buffer" as const,
      id: buffer.id,
      name: buffer.name,
      path: buffer.path,
      databaseType: buffer.type === "database" ? buffer.databaseType : undefined,
      isDirty: buffer.type === "editor" && buffer.isDirty,
      isSelected: selectedBufferIds.has(buffer.id),
    }));

    if (!debouncedSearch.trim()) {
      const sortedFiles = fileItems
        .slice(0, MAX_RESULTS)
        .map((file) => ({
          type: "file" as const,
          id: file.path,
          name: file.name,
          path: file.path,
          isSelected: selectedFilesPaths.has(file.path),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return [...bufferItems, ...sortedFiles];
    }

    // Score all items, take top results
    const scored: Array<{ item: any; score: number }> = [];

    for (const item of bufferItems) {
      const score = Math.max(
        fuzzyScore(item.name, debouncedSearch),
        fuzzyScore(item.path, debouncedSearch),
      );
      if (score > 0) scored.push({ item, score });
    }

    for (const file of fileItems) {
      const score = Math.max(
        fuzzyScore(file.name, debouncedSearch),
        fuzzyScore(file.path, debouncedSearch),
      );
      if (score > 0) {
        scored.push({
          item: {
            type: "file" as const,
            id: file.path,
            name: file.name,
            path: file.path,
            isSelected: selectedFilesPaths.has(file.path),
          },
          score,
        });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Prioritize open buffers
      const aIsOpen = openBufferPathSet.has(a.item.path);
      const bIsOpen = openBufferPathSet.has(b.item.path);
      if (aIsOpen !== bIsOpen) return aIsOpen ? -1 : 1;
      return a.item.name.localeCompare(b.item.name);
    });

    return scored.slice(0, MAX_RESULTS).map(({ item }) => item);
  }, [
    fileItems,
    buffers,
    debouncedSearch,
    selectedBufferIds,
    selectedFilesPaths,
    openBufferPathSet,
  ]);

  const selectedItems = useMemo(() => {
    const bufferSelections = buffers
      .filter((buffer) => selectedBufferIds.has(buffer.id))
      .map((buffer) => ({
        type: "buffer" as const,
        id: buffer.id,
        name: buffer.name,
        databaseType: buffer.type === "database" ? buffer.databaseType : undefined,
        isDirty: buffer.type === "editor" && buffer.isDirty,
      }));

    const fileSelections = Array.from(selectedFilesPaths).map((filePath) => ({
      type: "file" as const,
      id: filePath,
      name: filePath.split("/").pop() || "Unknown",
      path: filePath,
    }));

    return [...bufferSelections, ...fileSelections];
  }, [buffers, selectedBufferIds, selectedFilesPaths]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div className="relative shrink-0" ref={triggerRef}>
        <button
          onClick={onToggleOpen}
          className={cn(
            "flex select-none items-center justify-center p-1",
            "text-text-lighter text-xs transition-colors",
            "hover:text-text focus:outline-none",
          )}
          title="Add context files"
          aria-label="Add context files"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Plus size={12} />
        </button>
      </div>

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="top"
        onClose={onToggleOpen}
        className="w-[340px] overflow-hidden rounded-2xl p-0"
      >
        <div className="bg-secondary-bg px-2 py-2">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            variant="ghost"
            leftIcon={Search}
            className="w-full"
            aria-label="Search files"
          />
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Files and buffers"
        >
          {allItems.length === 0 ? (
            <div className="ui-font px-3 py-2 text-center text-text-lighter text-xs">
              {searchTerm ? "No matching files found" : "No files available"}
            </div>
          ) : (
            allItems.map((item: any) => (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => {
                  if (item.type === "buffer") {
                    onToggleBuffer(item.id);
                  } else {
                    onToggleFile(item.path);
                  }
                }}
                className={cn(
                  "group ui-font flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover",
                  item.isSelected && "bg-selected",
                )}
                aria-label={`${item.isSelected ? "Remove" : "Add"} ${item.name} ${item.isSelected ? "from" : "to"} context`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {item.type === "buffer" ? (
                    item.databaseType ? (
                      <Database size={10} className="shrink-0 text-text-lighter" />
                    ) : (
                      <FileText size={10} className="shrink-0 text-text-lighter" />
                    )
                  ) : (
                    <FileExplorerIcon
                      fileName={item.name}
                      isDir={false}
                      size={10}
                      className="shrink-0 text-text-lighter"
                    />
                  )}
                  <div className="min-w-0 flex-1 truncate">
                    <span className="text-text">{item.name}</span>
                    {item.type === "buffer" ? (
                      item.isDirty && (
                        <span className="ml-1 text-[8px] text-yellow-500" title="Unsaved changes">
                          ●
                        </span>
                      )
                    ) : (
                      <span className="ml-2 text-[10px] text-text-lighter opacity-60">
                        {getDirectoryPath(item.path, rootFolderPath) || "root"}
                      </span>
                    )}
                  </div>
                  {item.type === "buffer" && (
                    <span className="rounded bg-accent/20 px-1 py-0.5 font-medium text-[10px] text-accent">
                      open
                    </span>
                  )}
                </div>
                {item.isSelected && (
                  <div className="flex h-4 w-4 items-center justify-center rounded text-accent opacity-60">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                    </svg>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </Dropdown>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-x-hidden">
        {selectedItems.map((item) => (
          <div
            key={`selected-${item.type}-${item.id}`}
            className="group flex shrink-0 select-none items-center gap-1 rounded-full border border-border bg-secondary-bg/80 px-2 py-1 text-xs"
          >
            {item.type === "buffer" ? (
              item.databaseType ? (
                <Database size={8} className="text-text-lighter" />
              ) : (
                <FileText size={8} className="text-text-lighter" />
              )
            ) : (
              <FileText size={8} className="text-blue-500" />
            )}
            <span
              className={cn(
                "max-w-20 truncate",
                item.type === "buffer" ? "text-text" : "text-blue-400",
              )}
            >
              {item.name}
            </span>
            {item.type === "buffer" && item.isDirty && (
              <span className="text-[8px] text-yellow-500" title="Unsaved changes">
                ●
              </span>
            )}
            <button
              onClick={() => {
                if (item.type === "buffer") {
                  onToggleBuffer(item.id);
                } else {
                  onToggleFile(item.id);
                }
              }}
              className="rounded-full p-0.5 text-text-lighter opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-red-400/50 group-hover:opacity-100"
              aria-label={`Remove ${item.name} from context`}
              tabIndex={0}
            >
              <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
