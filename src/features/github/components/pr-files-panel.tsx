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
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import type { FileStatusFilter } from "../types/github-pr-viewer.types";
import { FileDiffView } from "./file-diff-view";
import { GitHubViewerLoadingState, GitHubViewerState } from "./github-viewer-shell";

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
      return <GitHubViewerLoadingState label="Loading diff" className="min-h-0" />;
    }

    if (contentError) {
      return (
        <GitHubViewerState
          description={contentError}
          actionLabel="Retry"
          onAction={onRetry}
          tone="error"
          className="min-h-0"
        />
      );
    }

    if (diffFiles.length === 0) {
      return <GitHubViewerState description="No file changes" className="min-h-0" />;
    }

    if (filteredDiff.length === 0) {
      return <GitHubViewerState description="No files match your filters" className="min-h-0" />;
    }

    return (
      <div className="flex min-h-140 min-w-0 items-stretch overflow-hidden bg-background">
        {isFileTreeVisible ? (
          <FileNavigatorSidebar
            items={fileTreeItems}
            selectedKey={selectedFilePath}
            onSelect={onSelectFile}
            ariaLabel="Changed files"
            viewMode={fileNavigatorViewMode}
            onViewModeChange={setFileNavigatorViewMode}
            surface="review"
            className="h-auto self-stretch"
            searchMode="fuzzy"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-border/60 border-b px-3 py-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                onClick={onToggleFileTree}
                aria-label={isFileTreeVisible ? "Hide changed files" : "Show changed files"}
                size="icon-xs"
              >
                <ListBullets weight="duotone" />
              </Button>
              <span className="ui-text-sm text-subtle-foreground">
                {filteredDiff.length} of {diffFiles.length} files
              </span>
              {diffDebugSummary.errorCount > 0 ? (
                <span className="ui-text-sm text-destructive">
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
                className="w-full sm:w-56"
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
              />
            </div>
          </div>

          <div className="min-h-140 min-w-0 overflow-hidden bg-background">
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
              <GitHubViewerState description="Select a file" className="h-full" />
            )}
          </div>
        </div>
      </div>
    );
  },
);

PRFilesPanel.displayName = "PRFilesPanel";
