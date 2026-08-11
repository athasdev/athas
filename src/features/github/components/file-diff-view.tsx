import { CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight } from "@/ui/icons";
import { memo } from "react";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
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
  }: FileDiffViewProps) => {
    const fileLines = file.lines ?? [];
    const tokenMap = usePRDiffHighlighting(isExpanded ? fileLines : [], file.path);

    return (
      <div className="min-w-0 overflow-hidden bg-background">
        {isStatic ? (
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
              size="xs"
              className="text-subtle-foreground"
            >
              Open
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onToggle}
            className="h-auto w-full justify-start rounded-none px-2.5 py-2 text-left hover:bg-accent/60"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${file.path}`}
            size="xs"
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
        )}
        {isExpanded && (
          <div className="bg-background">
            <div className="max-h-135 overflow-auto">
              {isLoadingPatch ? (
                <Empty className="min-h-0 flex-none rounded-none py-6">
                  <EmptyDescription>
                    <Spinner label="Loading file diff" showLabel compact />
                  </EmptyDescription>
                </Empty>
              ) : patchError ? (
                <Empty
                  className="min-h-0 flex-none rounded-none px-3 py-4"
                  tone="error"
                  role="alert"
                >
                  <EmptyDescription>{patchError}</EmptyDescription>
                </Empty>
              ) : fileLines.length === 0 ? (
                <Empty className="min-h-0 flex-none rounded-none px-3 py-4">
                  <EmptyDescription>No diff hunks available for this file.</EmptyDescription>
                </Empty>
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
