import { CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight } from "@/ui/icons";
import { memo, useMemo } from "react";
import {
  ViewerErrorState,
  ViewerLoadingState,
  ViewerState,
} from "@/features/viewer/components/viewer-state";
import { DiffFileContent } from "@/features/git/components/diff/diff-file-content";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { parseGitPatchLines } from "@/features/git/utils/git-diff-parser";
import type { FileDiff } from "../types/github-pr-viewer.types";

interface FileDiffViewProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile: (relativePath: string) => void;
  isLoadingPatch: boolean;
  patchError?: string;
  isStatic?: boolean;
  showHeader?: boolean;
}

const statusColors: Record<FileDiff["status"], string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

export const FileDiffView = memo(
  ({
    file,
    isExpanded,
    onToggle,
    onOpenFile,
    isLoadingPatch,
    patchError,
    isStatic = false,
    showHeader = true,
  }: FileDiffViewProps) => {
    const fileLines = file.lines ?? [];
    const diff = useMemo(() => {
      const parsed = parseGitPatchLines(fileLines, file.path);

      return {
        ...parsed,
        file_path: file.path,
        old_path: file.oldPath,
        new_path: file.path,
        is_new: file.status === "added",
        is_deleted: file.status === "deleted",
        is_renamed: file.status === "renamed",
        additions: file.additions,
        deletions: file.deletions,
      };
    }, [file.additions, file.deletions, file.oldPath, file.path, file.status, fileLines]);

    return (
      <div className="min-w-0 overflow-hidden bg-background">
        {showHeader && isStatic ? (
          <div className="flex min-h-9 items-center gap-2 border-border/60 border-b px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="ui-text-sm truncate text-foreground">{file.path}</div>
              {file.oldPath && (
                <div className="ui-text-sm truncate text-subtle-foreground">
                  from {file.oldPath}
                </div>
              )}
            </div>
            <span className={cn("ui-text-sm shrink-0 capitalize", statusColors[file.status])}>
              {file.status}
            </span>
            <span className="ui-text-sm shrink-0 text-git-added">+{file.additions}</span>
            <span className="ui-text-sm shrink-0 text-git-deleted">-{file.deletions}</span>
            <Button
              onClick={() => onOpenFile(file.path)}
              variant="ghost"
              className="text-subtle-foreground"
            >
              Open
            </Button>
          </div>
        ) : showHeader ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onToggle}
            className="h-auto w-full justify-start rounded-none px-2.5 py-2 text-left hover:bg-accent/60"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.path}`}
          >
            {isExpanded ? (
              <ChevronDown className="text-subtle-foreground" />
            ) : (
              <ChevronRight className="text-subtle-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="ui-text-sm truncate text-foreground">{file.path}</div>
              {file.oldPath && (
                <div className="ui-text-sm truncate text-subtle-foreground">
                  from {file.oldPath}
                </div>
              )}
            </div>
            <span className={cn("ui-text-sm shrink-0 capitalize", statusColors[file.status])}>
              {file.status}
            </span>
            <span className="ui-text-sm shrink-0 text-git-added">+{file.additions}</span>
            <span className="ui-text-sm shrink-0 text-git-deleted">-{file.deletions}</span>
          </Button>
        ) : null}
        {isExpanded && (
          <div className="bg-background">
            <div className={showHeader ? "max-h-135 overflow-auto" : "overflow-hidden"}>
              {isLoadingPatch ? (
                <ViewerLoadingState
                  label="Loading file diff"
                  layout="section"
                  className="min-h-0 flex-none py-6"
                />
              ) : patchError ? (
                <ViewerErrorState
                  message={patchError}
                  layout="section"
                  className="min-h-0 flex-none px-3 py-4"
                />
              ) : fileLines.length === 0 ? (
                <ViewerState
                  description="No diff hunks available for this file."
                  layout="section"
                  className="min-h-0 flex-none px-3 py-4"
                />
              ) : (
                <DiffFileContent key={file.path} diff={diff} sectionKey={file.path} />
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

FileDiffView.displayName = "FileDiffView";
