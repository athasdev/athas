import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  FileTextIcon as FileText,
} from "@/ui/icons";
import { memo } from "react";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { usePRDiffHighlighting } from "../hooks/use-pr-diff-highlighting";
import type { FileDiff } from "../types/github-pr-viewer.types";
import { DiffLineDisplay } from "./diff-line-display";

interface FileDiffViewProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile: (relativePath: string) => void;
  isLoadingPatch: boolean;
  patchError?: string;
  isStatic?: boolean;
}

const statusColors: Record<FileDiff["status"], string> = {
  added: "bg-git-added/15 text-git-added",
  deleted: "bg-git-deleted/15 text-git-deleted",
  modified: "bg-git-modified/15 text-git-modified",
  renamed: "bg-git-renamed/15 text-git-renamed",
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
  }: FileDiffViewProps) => {
    const fileLines = file.lines ?? [];
    const tokenMap = usePRDiffHighlighting(isExpanded ? fileLines : [], file.path);

    return (
      <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-primary-bg">
        {isStatic ? (
          <div className="flex items-center gap-2 px-2.5 py-2">
            <FileText className="shrink-0 text-text-lighter" />
            <div className="min-w-0 flex-1">
              <div className="ui-text-sm truncate text-text">{file.path}</div>
              {file.oldPath && (
                <div className="ui-text-sm truncate text-text-lighter">from {file.oldPath}</div>
              )}
            </div>
            <span className={cn("ui-text-sm shrink-0 capitalize", statusColors[file.status])}>
              {file.status}
            </span>
            <span className="ui-text-sm shrink-0 text-git-added">+{file.additions}</span>
            <span className="ui-text-sm shrink-0 text-git-deleted">-{file.deletions}</span>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onToggle}
            className="h-auto w-full justify-start rounded-none px-2.5 py-2 text-left hover:bg-hover/60"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.path}`}
            compact
          >
            {isExpanded ? (
              <ChevronDown className="text-text-lighter" />
            ) : (
              <ChevronRight className="text-text-lighter" />
            )}
            <FileText className="shrink-0 text-text-lighter" />
            <div className="min-w-0 flex-1">
              <div className="ui-text-sm truncate text-text">{file.path}</div>
              {file.oldPath && (
                <div className="ui-text-sm truncate text-text-lighter">from {file.oldPath}</div>
              )}
            </div>
            <span className={cn("ui-text-sm shrink-0 capitalize", statusColors[file.status])}>
              {file.status}
            </span>
            <span className="ui-text-sm shrink-0 text-git-added">+{file.additions}</span>
            <span className="ui-text-sm shrink-0 text-git-deleted">-{file.deletions}</span>
          </Button>
        )}
        {isExpanded && (
          <div className="border-border/70 border-t bg-primary-bg">
            <div className="flex items-center justify-between px-3 py-2">
              <Tooltip content="Open file in editor" side="top">
                <Button
                  onClick={() => onOpenFile(file.path)}
                  variant="ghost"
                  compact
                  className="text-text-lighter"
                >
                  Open File
                </Button>
              </Tooltip>
              <span className="ui-text-sm text-text-lighter">
                {isLoadingPatch ? "Loading patch..." : `${fileLines.length} diff lines`}
              </span>
            </div>
            <div className="max-h-[540px] overflow-auto">
              {isLoadingPatch ? (
                <div className="flex items-center justify-center py-6">
                  <LoadingIndicator label="Loading file diff" showLabel compact />
                </div>
              ) : patchError ? (
                <div className="ui-text-sm px-3 py-4 text-center text-error">{patchError}</div>
              ) : fileLines.length === 0 ? (
                <div className="ui-text-sm px-3 py-4 text-center text-text-lighter">
                  No diff hunks available for this file.
                </div>
              ) : (
                fileLines.map((line, index) => (
                  <DiffLineDisplay
                    key={index}
                    line={line}
                    index={index}
                    tokens={tokenMap.get(index)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

FileDiffView.displayName = "FileDiffView";
