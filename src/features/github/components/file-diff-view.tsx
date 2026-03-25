import { ChevronDown, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { memo } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { usePRDiffHighlighting } from "../hooks/use-pr-diff-highlighting";
import type { FileDiff } from "../types/pr-viewer";
import { DiffLineDisplay } from "./diff-line-display";

interface FileDiffViewProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile: (relativePath: string) => void;
  isLoadingPatch: boolean;
  patchError?: string;
}

const statusColors: Record<FileDiff["status"], string> = {
  added: "bg-git-added/15 text-git-added",
  deleted: "bg-git-deleted/15 text-git-deleted",
  modified: "bg-git-modified/15 text-git-modified",
  renamed: "bg-git-renamed/15 text-git-renamed",
};

export const FileDiffView = memo(
  ({ file, isExpanded, onToggle, onOpenFile, isLoadingPatch, patchError }: FileDiffViewProps) => {
    const fileLines = file.lines ?? [];
    const tokenMap = usePRDiffHighlighting(isExpanded ? fileLines : [], file.path);

    return (
      <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-secondary-bg/30">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onToggle}
          className="h-auto w-full justify-start rounded-none text-left hover:bg-hover/60"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.path}`}
        >
          {isExpanded ? (
            <ChevronDown className="text-text-lighter" />
          ) : (
            <ChevronRight className="text-text-lighter" />
          )}
          <FileText className="text-text-lighter" />
          <div className="min-w-0 flex-1">
            <div className="ui-font ui-text-sm truncate text-text">{file.path}</div>
            {file.oldPath && (
              <div className="ui-font ui-text-sm truncate text-text-lighter">from {file.oldPath}</div>
            )}
          </div>
          <Badge
            shape="pill"
            size="compact"
            className={cn("capitalize", statusColors[file.status])}
          >
            {file.status}
          </Badge>
          <Badge
            variant="accent"
            shape="pill"
            size="compact"
            className="bg-git-added/15 text-git-added"
          >
            +{file.additions}
          </Badge>
          <Badge
            variant="accent"
            shape="pill"
            size="compact"
            className="bg-git-deleted/15 text-git-deleted"
          >
            -{file.deletions}
          </Badge>
        </Button>
        {isExpanded && (
          <div className="border-border/60 border-t bg-primary-bg/60">
            <div className="flex items-center justify-between px-3 py-2">
              <Tooltip content="Open file in editor" side="top">
                <Button
                  onClick={() => onOpenFile(file.path)}
                  variant="outline"
                  size="xs"
                  className="bg-secondary-bg/70 text-text-lighter"
                >
                  Open File
                </Button>
              </Tooltip>
              <span className="ui-font ui-text-sm text-text-lighter">
                {isLoadingPatch ? "Loading patch..." : `${fileLines.length} diff lines`}
              </span>
            </div>
            <div className="max-h-[540px] overflow-auto">
              {isLoadingPatch ? (
                <div className="flex items-center justify-center py-6">
                  <RefreshCw className="animate-spin text-text-lighter" />
                  <span className="ml-2 ui-font ui-text-sm text-text-lighter">
                    Loading file diff...
                  </span>
                </div>
              ) : patchError ? (
                <div className="ui-font ui-text-sm px-3 py-4 text-center text-error">
                  {patchError}
                </div>
              ) : fileLines.length === 0 ? (
                <div className="ui-font ui-text-sm px-3 py-4 text-center text-text-lighter">
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
