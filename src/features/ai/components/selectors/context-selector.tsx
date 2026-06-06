import {
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  GitPullRequestIcon as GitPullRequest,
  GlobeIcon as Globe,
  MagnifyingGlassIcon as Search,
  PlayCircleIcon as PlayCircle,
  PlusIcon as Plus,
  TerminalWindowIcon as TerminalWindow,
  XIcon as X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import type { FileItem } from "@/features/global-search/models/types";
import { shouldIgnoreFile } from "@/features/global-search/utils/file-filtering";
import { useProjectStore } from "@/features/window/stores/project-store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import {
  chatComposerDropdownClassName,
  chatComposerIconButtonClassName,
} from "../input/chat-composer-control-styles";
import { AIFileSelector } from "../mentions/ai-file-selector";

import type { PaneContent } from "@/features/panes/types/pane-content";

function getBufferContextDescription(buffer: PaneContent) {
  if (buffer.type === "webViewer") return buffer.url;
  if (buffer.type === "terminal") return buffer.workingDirectory || "Terminal";
  if (buffer.type === "database") return `${buffer.databaseType} database`;
  if (buffer.type === "pullRequest") return `Pull request #${buffer.prNumber}`;
  if (buffer.type === "githubIssue") return `Issue #${buffer.issueNumber}`;
  if (buffer.type === "githubAction") return `Action run #${buffer.runId}`;
  return buffer.path;
}

function getBufferContextIcon(buffer: PaneContent) {
  if (buffer.type === "webViewer") return <Globe />;
  if (buffer.type === "terminal") return <TerminalWindow />;
  if (buffer.type === "database") return <Database />;
  if (buffer.type === "pullRequest") return <GitPullRequest />;
  if (buffer.type === "githubIssue") return <FileText />;
  if (buffer.type === "githubAction") return <PlayCircle />;
  return <FileExplorerIcon fileName={buffer.name} isDir={false} size={10} />;
}

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
  const [selectedContextIndex, setSelectedContextIndex] = useState(0);
  const [visibleFileResults, setVisibleFileResults] = useState<FileItem[]>([]);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();
  const selectableBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type !== "agent" && buffer.type !== "newTab"),
    [buffers],
  );
  const filteredContextBuffers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return selectableBuffers.filter((buffer) => {
      if (!normalizedSearch) return true;
      return (
        buffer.name.toLowerCase().includes(normalizedSearch) ||
        buffer.path.toLowerCase().includes(normalizedSearch) ||
        buffer.type.toLowerCase().includes(normalizedSearch) ||
        getBufferContextDescription(buffer).toLowerCase().includes(normalizedSearch)
      );
    });
  }, [searchTerm, selectableBuffers]);

  // Pre-filtered file list (excludes directories + ignored files). Refreshed on each open.
  const [fileItems, setFileItems] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    getAllProjectFiles()
      .then((projectFiles) => {
        if (cancelled) return;

        const filtered: FileEntry[] = [];
        for (const file of projectFiles) {
          if (!file.isDir && !shouldIgnoreFile(file.path)) {
            filtered.push(file);
          }
        }

        setFileItems(filtered);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load context files:", error);
        setFileItems([]);
      });

    return () => {
      cancelled = true;
    };
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
      setSelectedContextIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    const totalResults = filteredContextBuffers.length + visibleFileResults.length;
    if (totalResults === 0) {
      setSelectedContextIndex(0);
      return;
    }

    setSelectedContextIndex((currentIndex) => Math.min(currentIndex, totalResults - 1));
  }, [filteredContextBuffers.length, visibleFileResults.length]);

  const fileSelectedIndex = Math.max(0, selectedContextIndex - filteredContextBuffers.length);

  const selectCurrentContextResult = () => {
    if (filteredContextBuffers[selectedContextIndex]) {
      onToggleBuffer(filteredContextBuffers[selectedContextIndex].id);
      return;
    }

    const file = visibleFileResults[fileSelectedIndex];
    if (file) {
      handleFileSelect(file);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <div className="relative shrink-0" ref={triggerRef}>
        <Button
          onClick={onToggleOpen}
          variant="ghost"
          className={chatComposerIconButtonClassName()}
          tooltip="Add context"
          aria-label="Add context"
          aria-expanded={isOpen}
          aria-haspopup="true"
          compact
        >
          <Plus />
        </Button>
      </div>

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        onClose={onToggleOpen}
        className={chatComposerDropdownClassName("w-[min(340px,calc(100vw-16px))]")}
        style={{ maxHeight: "286px" }}
      >
        <div className="border-border/60 border-b bg-secondary-bg/95 px-1.5 py-1.5">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search context..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              const totalResults = filteredContextBuffers.length + visibleFileResults.length;
              if (totalResults === 0) return;

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedContextIndex((currentIndex) =>
                  Math.min(currentIndex + 1, totalResults - 1),
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedContextIndex((currentIndex) => Math.max(currentIndex - 1, 0));
                return;
              }

              if (event.key === "Home") {
                event.preventDefault();
                setSelectedContextIndex(0);
                return;
              }

              if (event.key === "End") {
                event.preventDefault();
                setSelectedContextIndex(totalResults - 1);
                return;
              }

              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                selectCurrentContextResult();
              }
            }}
            variant="ghost"
            size="xs"
            leftIcon={Search}
            className="w-full"
            aria-label="Search context"
          />
        </div>
        <AIFileSelector
          files={fileItems}
          query={searchTerm}
          onQueryChange={setSearchTerm}
          onSelect={handleFileSelect}
          rootFolderPath={rootFolderPath}
          selectedIndex={fileSelectedIndex}
          onSelectedIndexChange={(index) =>
            setSelectedContextIndex(filteredContextBuffers.length + index)
          }
          onResultsChange={setVisibleFileResults}
          emptyLabel={searchTerm ? "No matching context found" : "No context available"}
          compact
          showSearchInput={false}
          listClassName="max-h-[228px]"
          leadingContent={
            filteredContextBuffers.length > 0 ? (
              <>
                <div className="ui-text-xs px-2 pt-1.5 pb-1 font-medium leading-[1.35] text-text-lighter/75">
                  Open
                </div>
                {filteredContextBuffers.map((buffer) => {
                  const index = filteredContextBuffers.indexOf(buffer);
                  const isSelected = selectedBufferIds.has(buffer.id);
                  return (
                    <button
                      key={buffer.id}
                      type="button"
                      data-context-buffer-option
                      onClick={() => onToggleBuffer(buffer.id)}
                      onMouseEnter={() => setSelectedContextIndex(index)}
                      className={cn(
                        "ui-font flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left ui-text-xs leading-[1.35] transition-colors",
                        selectedContextIndex === index
                          ? "bg-selected text-text"
                          : isSelected
                            ? "bg-hover/70 text-text"
                            : "text-text hover:bg-hover focus:bg-hover focus:outline-none",
                        isSelected && selectedContextIndex !== index
                          ? "shadow-[inset_0_0_0_1px_var(--color-border)]"
                          : "",
                      )}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center text-text-lighter [&_svg]:size-3">
                        {getBufferContextIcon(buffer)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-text">{buffer.name}</span>
                        <span className="block truncate text-text-lighter/70">
                          {getBufferContextDescription(buffer)}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="ui-text-xs shrink-0 rounded border border-border/60 px-1 leading-[1.35] text-text-lighter">
                          added
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            ) : null
          }
          hasLeadingResults={filteredContextBuffers.length > 0}
        />
      </Dropdown>

      <div
        className={cn(
          "custom-scrollbar-thin flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto overflow-x-hidden",
          "max-h-14",
          selectedItemsClassName,
        )}
        role="list"
        aria-label="Selected context"
      >
        {selectedItems.map((item) => (
          <div
            key={`selected-${item.type}-${item.id}`}
            className="group ui-font ui-text-xs flex min-h-7 min-w-0 shrink-0 select-none items-center gap-1 rounded-md border border-border/60 bg-primary-bg/45 px-1.5 leading-[1.35] text-text-lighter transition-colors hover:border-border-strong/60 hover:bg-hover/70 focus-within:border-border-strong/60 focus-within:bg-hover/70"
            data-context-chip
            role="listitem"
            tabIndex={0}
            aria-label={`${item.name}. Press Delete to remove from context.`}
            title={item.type === "file" ? item.path : item.name}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const chips = Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    "[data-context-chip]",
                  ) || [],
                );
                const currentIndex = chips.indexOf(event.currentTarget);
                const nextIndex =
                  event.key === "ArrowLeft"
                    ? Math.max(currentIndex - 1, 0)
                    : Math.min(currentIndex + 1, chips.length - 1);
                chips[nextIndex]?.focus();
                return;
              }

              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                const chipContainer = event.currentTarget.parentElement;
                const chips = Array.from(
                  chipContainer?.querySelectorAll<HTMLElement>("[data-context-chip]") || [],
                );
                const currentIndex = chips.indexOf(event.currentTarget);
                const nextFocusIndex = Math.max(0, Math.min(currentIndex, chips.length - 2));
                if (item.type === "buffer") {
                  onToggleBuffer(item.id);
                } else {
                  onToggleFile(item.id);
                }
                requestAnimationFrame(() => {
                  const nextChips = Array.from(
                    chipContainer?.querySelectorAll<HTMLElement>("[data-context-chip]") || [],
                  );
                  const nextChip = nextChips[nextFocusIndex];
                  if (nextChip) {
                    nextChip.focus();
                    return;
                  }
                  triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                });
              }
            }}
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
                "max-w-24 truncate leading-[1.35]",
                item.type === "buffer" ? "text-text" : "text-accent",
              )}
            >
              {item.name}
            </span>
            {item.type === "buffer" && item.isDirty && (
              <span className="size-1.5 rounded-full bg-warning" title="Unsaved changes" />
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
              compact
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
