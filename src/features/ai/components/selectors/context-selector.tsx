import {
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  GitPullRequestIcon as GitPullRequest,
  GlobeIcon as Globe,
  MagnifyingGlassIcon as Search,
  PlayCircleIcon as PlayCircle,
  PlusIcon as Plus,
  TerminalWindowIcon as TerminalWindow,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import type { FileItem } from "@/features/global-search/types/global-search.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import Badge from "@/ui/badge";
import { cn } from "@/utils/cn";
import {
  chatComposerDropdownItemClassName,
  chatComposerDropdownClassName,
  chatComposerIconButtonClassName,
} from "../input/chat-composer-control-styles";
import { AIFileSelector } from "../mentions/ai-file-selector";

import type { PaneContent } from "@/features/panes/types/pane-content.types";

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
  return <ThemedFileIcon fileName={buffer.name} isDir={false} />;
}

interface ContextSelectorProps {
  buffers: PaneContent[];
  allProjectFiles: never[];
  selectedBufferIds: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

export function ContextSelector({
  buffers,
  selectedBufferIds,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onToggleOpen,
  anchorRef,
  className,
}: Omit<ContextSelectorProps, "allProjectFiles">) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownAnchorRef = anchorRef ?? triggerRef;

  const closeDropdown = useCallback(() => {
    if (isOpen) {
      onToggleOpen();
    }
  }, [isOpen, onToggleOpen]);

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="relative shrink-0" ref={triggerRef}>
          <Button
            onClick={onToggleOpen}
            variant="ghost"
            className={chatComposerIconButtonClassName()}
            tooltip="Add context"
            aria-label="Add context"
            aria-expanded={isOpen}
            aria-haspopup="true"
            size="icon-sm"
          >
            <Plus />
          </Button>
        </div>
      </div>

      <Dropdown
        isOpen={isOpen}
        anchorRef={dropdownAnchorRef}
        anchorSide="top"
        onClose={closeDropdown}
        className={chatComposerDropdownClassName("min-w-0")}
        menuClassName="flex min-h-0 flex-col overflow-hidden"
        style={{ maxHeight: "320px" }}
        matchAnchorWidth
        anchorMinWidth={280}
      >
        {isOpen ? (
          <ContextSelectorDropdownContent
            buffers={buffers}
            selectedBufferIds={selectedBufferIds}
            onToggleBuffer={onToggleBuffer}
            onToggleFile={onToggleFile}
          />
        ) : null}
      </Dropdown>
    </div>
  );
}

interface ContextSelectorDropdownContentProps {
  buffers: PaneContent[];
  selectedBufferIds: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
}

function ContextSelectorDropdownContent({
  buffers,
  selectedBufferIds,
  onToggleBuffer,
  onToggleFile,
}: ContextSelectorDropdownContentProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContextIndex, setSelectedContextIndex] = useState(0);
  const [visibleFileResults, setVisibleFileResults] = useState<FileItem[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);

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

  useEffect(() => {
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(focusTimer);
  }, []);

  const totalResults = filteredContextBuffers.length + visibleFileResults.length;
  const shouldShowContextResults =
    filteredContextBuffers.length > 0 || searchTerm.trim().length > 0;
  const boundedSelectedContextIndex =
    totalResults === 0 ? 0 : Math.min(selectedContextIndex, totalResults - 1);
  const activeFileIndex = boundedSelectedContextIndex - filteredContextBuffers.length;
  const fileSelectedIndex = activeFileIndex >= 0 ? activeFileIndex : -1;

  const selectCurrentContextResult = () => {
    if (filteredContextBuffers[boundedSelectedContextIndex]) {
      onToggleBuffer(filteredContextBuffers[boundedSelectedContextIndex].id);
      searchInputRef.current?.focus();
      return;
    }

    const file = visibleFileResults[fileSelectedIndex];
    if (file) {
      handleFileSelect(file);
      searchInputRef.current?.focus();
    }
  };

  return (
    <>
      <div className="border-border/60 border-b bg-secondary-bg/95 px-1.5 py-1.5">
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Search context..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
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
      {shouldShowContextResults ? (
        <AIFileSelector
          files={[]}
          query={searchTerm}
          onQueryChange={setSearchTerm}
          onSelect={handleFileSelect}
          rootFolderPath={rootFolderPath}
          selectedIndex={fileSelectedIndex}
          onSelectedIndexChange={(index) =>
            setSelectedContextIndex(filteredContextBuffers.length + index)
          }
          onResultsChange={setVisibleFileResults}
          emptyLabel="No matching context found"
          compact
          showSearchInput={false}
          listClassName="max-h-[264px]"
          leadingContent={
            filteredContextBuffers.length > 0 ? (
              <>
                <div className="ui-text-sm px-2 pt-1.5 pb-1 font-medium leading-[1.35] text-text-lighter/75">
                  Open tabs
                </div>
                {filteredContextBuffers.map((buffer) => {
                  const index = filteredContextBuffers.indexOf(buffer);
                  const isSelected = selectedBufferIds.has(buffer.id);
                  return (
                    <button
                      key={buffer.id}
                      type="button"
                      data-context-buffer-option
                      onClick={() => {
                        onToggleBuffer(buffer.id);
                        searchInputRef.current?.focus();
                      }}
                      onMouseEnter={() => setSelectedContextIndex(index)}
                      className={cn(
                        chatComposerDropdownItemClassName(
                          "flex min-h-7 w-full min-w-0 items-center gap-2 px-2 py-1",
                        ),
                        boundedSelectedContextIndex === index
                          ? "bg-selected text-text"
                          : isSelected
                            ? "bg-hover/70 text-text"
                            : "text-text hover:bg-hover focus:bg-hover focus:outline-none",
                        isSelected && boundedSelectedContextIndex !== index
                          ? "shadow-[inset_0_0_0_1px_var(--color-border)]"
                          : "",
                      )}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center text-text-lighter [&_svg]:size-3">
                        {getBufferContextIcon(buffer)}
                      </span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="min-w-0 max-w-[45%] shrink truncate text-text">
                          {buffer.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-lighter/70">
                          {getBufferContextDescription(buffer)}
                        </span>
                      </span>
                      {isSelected && (
                        <Badge variant="default" size="compact" className="shrink-0">
                          added
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </>
            ) : null
          }
          hasLeadingResults={filteredContextBuffers.length > 0}
        />
      ) : null}
    </>
  );
}
