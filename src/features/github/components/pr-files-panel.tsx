import {
  ListBulletsIcon as ListBullets,
  MagnifyingGlassIcon as Search,
  SlidersHorizontalIcon as SlidersHorizontal,
} from "@/ui/icons";
import { memo, useMemo, useState } from "react";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { Button, buttonVariants } from "@/ui/button";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import type { FileStatusFilter } from "../types/github-pr-viewer.types";
import { FileDiffView } from "./file-diff-view";

const compactToolbarButtonClass = cn(
  buttonVariants({ variant: "ghost", compact: true }),
  "h-5 rounded px-1.5 ui-text-sm text-text-lighter hover:bg-hover hover:text-text",
);

const statusClass: Record<DiffFileItem["status"], string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

interface DiffFileItem {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified" | "renamed";
  lines?: string[];
}

interface DiffDebugSummary {
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
  isFileTreeVisible: boolean;
  diffDebugSummary: DiffDebugSummary;
  patchError?: string;
  onRetry: () => void;
  onToggleFileTree: () => void;
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
    isFileTreeVisible,
    diffDebugSummary,
    patchError,
    onRetry,
    onToggleFileTree,
    onFileQueryChange,
    onFileStatusFilterChange,
    onSelectFile,
    onOpenChangedFile,
  }: PRFilesPanelProps) => {
    const [fileNavigatorViewMode, setFileNavigatorViewMode] =
      useState<FileNavigatorViewMode>("flat");

    const fileTreeItems = useMemo<FileNavigatorItem[]>(
      () =>
        filteredDiff.map((file) => ({
          key: file.path,
          path: file.path,
          iconClassName: statusClass[file.status],
          metadata: [
            ...(file.additions > 0
              ? [{ label: `+${file.additions}`, className: "text-git-added" }]
              : []),
            ...(file.deletions > 0
              ? [{ label: `-${file.deletions}`, className: "text-git-deleted" }]
              : []),
          ],
        })),
      [filteredDiff],
    );

    if (isLoadingContent && !selectedPRDiff) {
      return (
        <div className="flex items-center justify-center p-8">
          <LoadingIndicator label="Loading diff" showLabel />
        </div>
      );
    }

    if (contentError) {
      return (
        <div className="flex items-center justify-center p-8 text-center">
          <div>
            <p className="font-sans ui-text-sm text-error">{contentError}</p>
            <Button
              onClick={onRetry}
              variant="default"
              className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
              compact
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
          <p className="font-sans ui-text-sm text-text-lighter">No file changes</p>
        </div>
      );
    }

    if (filteredDiff.length === 0) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="font-sans ui-text-sm text-text-lighter">No files match your filters</p>
        </div>
      );
    }

    return (
      <div className="flex min-h-[560px] min-w-0 items-stretch overflow-hidden bg-primary-bg">
        {isFileTreeVisible ? (
          <FileNavigatorSidebar
            items={fileTreeItems}
            selectedKey={selectedFilePath}
            onSelect={onSelectFile}
            ariaLabel="Changed files"
            viewMode={fileNavigatorViewMode}
            onViewModeChange={setFileNavigatorViewMode}
            borderless
            className="my-2 ml-2 h-auto self-stretch rounded-xl border border-border/70 bg-secondary-bg/20"
            searchMode="fuzzy"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-3 p-2">
          <div className="rounded-xl border border-border/60 bg-terniary-bg px-2 py-1">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onToggleFileTree}
                  className={compactToolbarButtonClass}
                  aria-label={isFileTreeVisible ? "Hide changed files" : "Show changed files"}
                  compact
                >
                  <ListBullets weight="duotone" />
                </Button>
                <span className="ui-text-sm text-text-lighter">
                  {filteredDiff.length} of {diffFiles.length} files
                </span>
                {diffDebugSummary.errorCount > 0 ? (
                  <span className="ui-text-sm text-error">
                    {diffDebugSummary.errorCount} patch errors
                  </span>
                ) : null}
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
                <p className="font-sans ui-text-sm text-text-lighter">Select a file</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

PRFilesPanel.displayName = "PRFilesPanel";
