import {
  ArrowsInLineVerticalIcon as ArrowsInLineVertical,
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
    isInMultiFileView = false,
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
            window.dispatchEvent(new CustomEvent("git-status-changed"));
            onUnstageHunk?.(gitHunk);
          }
        } else {
          const success = await stageHunk(rootFolderPath, gitHunk);
          if (success) {
            window.dispatchEvent(new CustomEvent("git-status-changed"));
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

    const canStage = !isInMultiFileView && rootFolderPath && filePath;
    const hiddenLabel =
      typeof hiddenLineCount === "number"
        ? `${hiddenLineCount} unchanged line${hiddenLineCount === 1 ? "" : "s"}`
        : "Changed lines";

    return (
      <div
        className={cn(
          "group grid cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)] items-center",
          "font-mono code-editor-font-override border-border/70 border-b bg-primary-bg text-text-lighter",
        )}
        style={headerStyle}
        onClick={onToggleCollapse}
      >
        <div className="flex items-center justify-center border-border border-r text-text-lighter">
          <ArrowsInLineVertical size={iconSize} />
        </div>

        <div className="flex min-w-0 items-center gap-1.5 px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex size-4 items-center justify-center text-text-lighter">
              {isCollapsed ? <ChevronRight size={iconSize} /> : <ChevronDown size={iconSize} />}
            </span>
            <span className="shrink-0 whitespace-nowrap font-medium text-text-light">
              {hiddenLabel}
            </span>
            {headerInfo?.context ? (
              <span className="min-w-0 truncate text-text-lighter">{headerInfo.context}</span>
            ) : null}
          </div>

          <div className="h-px min-w-8 flex-1 bg-border/70" />

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex items-center gap-1">
              {additions > 0 && <span className="text-git-added">+{additions}</span>}
              {deletions > 0 && <span className="text-git-deleted">-{deletions}</span>}
            </div>

            {canStage && (
              <button
                onClick={handleStageHunk}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1 py-0 opacity-0 group-hover:opacity-100",
                  isStaged
                    ? "bg-git-deleted/20 text-git-deleted hover:bg-git-deleted/30"
                    : "bg-git-added/20 text-git-added hover:bg-git-added/30",
                )}
                title={isStaged ? "Unstage hunk" : "Stage hunk"}
                aria-label={isStaged ? "Unstage hunk" : "Stage hunk"}
              >
                {isStaged ? <Minus size={iconSize} /> : <Plus size={iconSize} />}
                <span>{isStaged ? "Unstage" : "Stage"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

DiffHunkHeader.displayName = "DiffHunkHeader";

export default DiffHunkHeader;
