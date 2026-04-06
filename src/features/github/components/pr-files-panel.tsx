import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { Button, buttonVariants } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import type { FileStatusFilter } from "../types/pr-viewer";
import { FileDiffView } from "./file-diff-view";

const compactToolbarButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "xs" }),
  "h-5 rounded px-1.5 text-[10px] text-text-lighter hover:bg-hover hover:text-text",
);

interface DiffFileItem {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified" | "renamed";
  lines?: string[];
}

interface DiffDebugSummary {
  diffReady: boolean;
  indexedSections: number;
  loadedCount: number;
  errorCount: number;
}

interface PRFilesPanelProps {
  selectedPRDiff: string | null;
  isLoadingContent: boolean;
  contentError: string | null;
  diffFiles: DiffFileItem[];
  filteredDiff: DiffFileItem[];
  selectedDiffFile: DiffFileItem | null;
  fileQuery: string;
  fileStatusFilter: FileStatusFilter;
  selectedFilePath: string | null;
  isWideSplit: boolean;
  diffDebugSummary: DiffDebugSummary;
  patchError?: string;
  onRetry: () => void;
  onToggleSplit: () => void;
  onFileQueryChange: (value: string) => void;
  onFileStatusFilterChange: (value: FileStatusFilter) => void;
  onSelectFile: (path: string) => void;
  onOpenChangedFile: (relativePath: string) => void;
}

export const PRFilesPanel = memo(
  ({
    selectedPRDiff,
    isLoadingContent,
    contentError,
    diffFiles,
    filteredDiff,
    selectedDiffFile,
    fileQuery,
    fileStatusFilter,
    selectedFilePath,
    isWideSplit,
    diffDebugSummary,
    patchError,
    onRetry,
    onToggleSplit,
    onFileQueryChange,
    onFileStatusFilterChange,
    onSelectFile,
    onOpenChangedFile,
  }: PRFilesPanelProps) => {
    const selectedIndex = useMemo(
      () => filteredDiff.findIndex((file) => file.path === selectedFilePath),
      [filteredDiff, selectedFilePath],
    );

    const focusAndSelect = useCallback(
      (nextIndex: number) => {
        const nextFile = filteredDiff[nextIndex];
        if (!nextFile) return;

        onSelectFile(nextFile.path);
        window.requestAnimationFrame(() => {
          const escapedPath =
            typeof window.CSS?.escape === "function"
              ? window.CSS.escape(nextFile.path)
              : nextFile.path.replace(/"/g, '\\"');
          const selector = `[data-pr-file-path="${escapedPath}"]`;
          const button = document.querySelector<HTMLButtonElement>(selector);
          button?.focus();
        });
      },
      [filteredDiff, onSelectFile],
    );

    const handleSidebarKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (filteredDiff.length === 0) return;

        const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusAndSelect(Math.min(currentIndex + 1, filteredDiff.length - 1));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          focusAndSelect(Math.max(currentIndex - 1, 0));
          return;
        }

        if (event.key === "Home") {
          event.preventDefault();
          focusAndSelect(0);
          return;
        }

        if (event.key === "End") {
          event.preventDefault();
          focusAndSelect(filteredDiff.length - 1);
        }
      },
      [filteredDiff.length, focusAndSelect, selectedIndex],
    );

    if (isLoadingContent && !selectedPRDiff) {
      return (
        <div className="flex items-center justify-center p-8">
          <RefreshCw className="animate-spin text-text-lighter" />
          <span className="ml-2 ui-font ui-text-sm text-text-lighter">Loading diff...</span>
        </div>
      );
    }

    if (contentError) {
      return (
        <div className="flex items-center justify-center p-8 text-center">
          <div>
            <p className="ui-font ui-text-sm text-error">{contentError}</p>
            <Button
              onClick={onRetry}
              variant="outline"
              size="xs"
              className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }

    if (diffFiles.length === 0) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="ui-font ui-text-sm text-text-lighter">No file changes</p>
        </div>
      );
    }

    if (filteredDiff.length === 0) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="ui-font ui-text-sm text-text-lighter">No files match your filters</p>
        </div>
      );
    }

    return (
      <div className="flex min-h-[560px] min-w-0 items-stretch gap-3">
        <div
          className={cn(
            "shrink-0 overflow-auto rounded-xl bg-secondary-bg/20 p-1",
            isWideSplit ? "w-[280px]" : "w-[220px]",
          )}
          onKeyDown={handleSidebarKeyDown}
          role="listbox"
          aria-label="Changed files"
        >
          <div className="space-y-1">
            {filteredDiff.map((file) => {
              const isSelected = selectedDiffFile?.path === file.path;
              return (
                <Button
                  key={file.path}
                  data-pr-file-path={file.path}
                  type="button"
                  variant="ghost"
                  size="sm"
                  active={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelectFile(file.path)}
                  className="h-auto w-full items-start justify-start rounded-md px-2 py-1.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="ui-text-sm truncate leading-4 text-current">{file.path}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-lighter">
                      <span className="capitalize">{file.status}</span>
                      <span className="text-git-added">+{file.additions}</span>
                      <span className="text-git-deleted">-{file.deletions}</span>
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="rounded-md bg-terniary-bg px-3 py-1.5">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onToggleSplit}
                  className={compactToolbarButtonClass}
                  aria-label="Toggle files split width"
                >
                  {isWideSplit ? "Narrow Split" : "Wide Split"}
                </Button>
                <span className="ui-text-sm text-text-lighter">
                  {filteredDiff.length} / {diffFiles.length}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
                <Input
                  value={fileQuery}
                  onChange={(e) => onFileQueryChange(e.target.value)}
                  placeholder="Search files..."
                  leftIcon={Search}
                  size="sm"
                  className="h-7 w-full border-0 bg-primary-bg/70 sm:w-56"
                />
                <Select
                  value={fileStatusFilter}
                  onChange={(value) => onFileStatusFilterChange(value as FileStatusFilter)}
                  options={[
                    { value: "all", label: "All" },
                    { value: "added", label: "Added" },
                    { value: "modified", label: "Modified" },
                    { value: "deleted", label: "Deleted" },
                    { value: "renamed", label: "Renamed" },
                  ]}
                  size="sm"
                  leftIcon={SlidersHorizontal}
                  className="h-7 border-0 bg-primary-bg/70"
                />
              </div>
            </div>
          </div>

          <div className="ui-text-sm flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
            <span>{diffDebugSummary.diffReady ? "diff ready" : "diff missing"}</span>
            <span>&middot;</span>
            <span>{`${diffDebugSummary.indexedSections} indexed`}</span>
            <span>&middot;</span>
            <span>{`${diffDebugSummary.loadedCount} loaded`}</span>
            {diffDebugSummary.errorCount > 0 && (
              <>
                <span>&middot;</span>
                <span className="text-error">{`${diffDebugSummary.errorCount} errors`}</span>
              </>
            )}
          </div>

          <div className="min-h-[560px] min-w-0 overflow-hidden rounded-xl bg-secondary-bg/12">
            {selectedDiffFile ? (
              <FileDiffView
                file={selectedDiffFile}
                isExpanded
                isStatic
                onToggle={() => {}}
                onOpenFile={onOpenChangedFile}
                isLoadingPatch={false}
                patchError={patchError}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <p className="ui-font ui-text-sm text-text-lighter">Select a file</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

PRFilesPanel.displayName = "PRFilesPanel";
