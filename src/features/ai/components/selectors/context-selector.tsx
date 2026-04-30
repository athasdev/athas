import { Database, FileText, Plus, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { shouldIgnoreFile } from "@/features/global-search/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project-store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import {
  chatComposerDropdownClassName,
  chatComposerIconButtonClassName,
} from "../input/chat-composer-control-styles";
import { AIFileSelector } from "../mentions/ai-file-selector";

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
  className?: string;
  selectedItemsClassName?: string;
}

export function ContextSelector({
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onToggleOpen,
  className,
  selectedItemsClassName,
}: Omit<ContextSelectorProps, "allProjectFiles">) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();
  const selectableBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type !== "agent"),
    [buffers],
  );

  // Pre-filtered file list (excludes directories + ignored files). Refreshed on each open.
  const [fileItems, setFileItems] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    getAllProjectFiles().then((projectFiles) => {
      const filtered: FileEntry[] = [];
      for (const file of projectFiles) {
        if (!file.isDir && !shouldIgnoreFile(file.path)) {
          filtered.push(file);
        }
      }
      setFileItems(filtered);
    });
  }, [isOpen, getAllProjectFiles]);

  const bufferByPath = useMemo(
    () => new Map(selectableBuffers.map((buffer) => [buffer.path, buffer])),
    [selectableBuffers],
  );

  const handleFileSelect = (file: { path: string }) => {
    const buffer = bufferByPath.get(file.path);
    if (buffer) {
      onToggleBuffer(buffer.id);
      return;
    }

    onToggleFile(file.path);
  };

  const selectedItems = useMemo(() => {
    const bufferSelections = selectableBuffers
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
  }, [selectableBuffers, selectedBufferIds, selectedFilesPaths]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setSelectedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <div className="relative shrink-0" ref={triggerRef}>
        <Button
          onClick={onToggleOpen}
          variant="ghost"
          size="icon-xs"
          className={chatComposerIconButtonClassName()}
          tooltip="Add context files"
          aria-label="Add context files"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Plus />
        </Button>
      </div>

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="top"
        onClose={onToggleOpen}
        className={chatComposerDropdownClassName("w-[min(340px,calc(100vw-16px))]")}
      >
        <AIFileSelector
          files={fileItems}
          query={searchTerm}
          onQueryChange={setSearchTerm}
          onSelect={handleFileSelect}
          rootFolderPath={rootFolderPath}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          searchInputRef={searchInputRef}
          emptyLabel={searchTerm ? "No matching files found" : "No files available"}
        />
      </Dropdown>

      <div
        className={cn(
          "custom-scrollbar-thin flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto overflow-x-hidden",
          "max-h-14",
          selectedItemsClassName,
        )}
      >
        {selectedItems.map((item) => (
          <div
            key={`selected-${item.type}-${item.id}`}
            className="group ui-font ui-text-sm flex h-6 min-w-0 shrink-0 select-none items-center gap-1 rounded-md border border-border/60 bg-primary-bg/45 px-1.5 text-text-lighter"
          >
            {item.type === "buffer" ? (
              item.databaseType ? (
                <Database className="text-text-lighter" />
              ) : (
                <FileText className="text-text-lighter" />
              )
            ) : (
              <FileText className="text-accent" />
            )}
            <span
              className={cn(
                "max-w-20 truncate",
                item.type === "buffer" ? "text-text" : "text-accent",
              )}
            >
              {item.name}
            </span>
            {item.type === "buffer" && item.isDirty && (
              <span
                className="text-[length:calc(var(--ui-text-xs)*0.7)] text-warning"
                title="Unsaved changes"
              >
                ●
              </span>
            )}
            <Button
              onClick={() => {
                if (item.type === "buffer") {
                  onToggleBuffer(item.id);
                } else {
                  onToggleFile(item.id);
                }
              }}
              variant="ghost"
              size="icon-xs"
              className="size-4 rounded text-text-lighter opacity-0 hover:bg-hover hover:text-text focus:opacity-100 group-hover:opacity-100"
              aria-label={`Remove ${item.name} from context`}
              tabIndex={0}
            >
              <X size={10} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
