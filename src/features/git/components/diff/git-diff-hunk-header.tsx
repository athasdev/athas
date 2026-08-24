import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  MinusIcon as Minus,
  PlusIcon as Plus,
} from "@/ui/icons";
import { memo, useCallback, useMemo } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { stageHunk, unstageHunk } from "../../api/git-status-api";
import type { DiffHunkHeaderProps } from "../../types/git-diff.types";
import { createGitHunk, parseDiffHunkRange } from "../../utils/git-diff-helpers";

const DiffHunkHeader = memo(
  ({
    hunk,
    hiddenLineCount,
    isCollapsed,
    onToggleCollapse,
    isStaged,
    filePath,
    onStageHunk,
    onUnstageHunk,
    canStageHunks = false,
  }: DiffHunkHeaderProps) => {
    const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
    const editorFontSize = useEditorSettingsStore.use.fontSize();
    const editorFontFamily = useEditorSettingsStore.use.fontFamily();
    const editorLineHeight = useEditorSettingsStore.use.lineHeight();
    const zoomLevel = useZoomStore.use.editorZoomLevel();
    const fontSize = editorFontSize * zoomLevel;
    const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
    const iconSize = Math.max(12, Math.min(16, Math.round(fontSize * 0.72)));
    const headerStyle = useMemo(
      () => ({
        fontSize: `${fontSize}px`,
        fontFamily: editorFontFamily,
        lineHeight: `${lineHeight}px`,
      }),
      [editorFontFamily, fontSize, lineHeight],
    );

    const handleStageHunk = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!rootFolderPath || !filePath) return;

        const gitHunk = createGitHunk(hunk, filePath);

        if (isStaged) {
          const success = await unstageHunk(rootFolderPath, gitHunk);
          if (success) {
            onUnstageHunk?.(gitHunk);
          }
        } else {
          const success = await stageHunk(rootFolderPath, gitHunk);
          if (success) {
            onStageHunk?.(gitHunk);
          }
        }
      },
      [rootFolderPath, filePath, hunk, isStaged, onStageHunk, onUnstageHunk],
    );

    let additions = 0;
    let deletions = 0;
    for (const l of hunk.lines) {
      if (l.line_type === "added") additions++;
      else if (l.line_type === "removed") deletions++;
    }

    const headerInfo = parseDiffHunkRange(hunk.header.content);

    const canStage = canStageHunks && rootFolderPath && filePath;
    const rangeLabel = headerInfo
      ? `-${headerInfo.oldStart} +${headerInfo.newStart}`
      : hunk.header.content;

    return (
      <div
        className="flex min-w-full w-fit select-none items-stretch border-border/70 border-b bg-surface/40 font-mono code-editor-font-override text-subtle-foreground"
        data-selection-scope-exclude="true"
        style={headerStyle}
      >
        <button
          type="button"
          className="grid min-h-8 min-w-0 flex-1 grid-cols-[2.75rem_minmax(0,1fr)] items-stretch text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} diff hunk ${rangeLabel}`}
          title={hunk.header.content}
        >
          <span className="flex items-center justify-center border-border border-r text-subtle-foreground">
            <span className="flex size-4 items-center justify-center">
              {isCollapsed ? <ChevronRight size={iconSize} /> : <ChevronDown size={iconSize} />}
            </span>
          </span>

          <span className="flex min-w-0 items-center gap-2 px-2.5">
            {typeof hiddenLineCount === "number" ? (
              <span className="shrink-0 rounded-md bg-accent/70 px-1.5 text-muted-foreground tabular-nums">
                {hiddenLineCount} hidden
              </span>
            ) : null}
            <span className="shrink-0 text-subtle-foreground tabular-nums">{rangeLabel}</span>
            {headerInfo?.context ? (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {headerInfo.context}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
              {additions > 0 && <span className="text-git-added">+{additions}</span>}
              {deletions > 0 && <span className="text-git-deleted">-{deletions}</span>}
            </span>
          </span>
        </button>

        {canStage ? (
          <span className="flex shrink-0 items-center border-border border-l px-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleStageHunk}
              className={cn(isStaged ? "text-git-deleted" : "text-git-added")}
              tooltip={isStaged ? "Unstage hunk" : "Stage hunk"}
            >
              {isStaged ? <Minus size={iconSize} /> : <Plus size={iconSize} />}
              {isStaged ? "Unstage" : "Stage"}
            </Button>
          </span>
        ) : null}
      </div>
    );
  },
);

DiffHunkHeader.displayName = "DiffHunkHeader";

export default DiffHunkHeader;
