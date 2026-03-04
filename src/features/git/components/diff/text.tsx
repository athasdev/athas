import { memo, useCallback, useMemo, useState } from "react";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useSettingsStore } from "@/features/settings/store";
import { useZoomStore } from "@/stores/zoom-store";
import { useDiffHighlighting } from "../../hooks/use-diff-highlight";
import type { TextDiffViewerProps } from "../../types/diff";
import { groupLinesIntoHunks } from "../../utils/diff-helpers";
import DiffHunkHeader from "./hunk-header";
import DiffLine from "./line";

const TextDiffViewer = memo(
  ({
    diff,
    isStaged,
    viewMode,
    showWhitespace,
    onStageHunk,
    onUnstageHunk,
    isInMultiFileView = false,
  }: TextDiffViewerProps) => {
    const settings = useSettingsStore((state) => state.settings);
    const zoomLevel = useZoomStore.use.editorZoomLevel();
    const fontSize = settings.fontSize * zoomLevel;
    const lineHeight = Math.max(14, Math.round(calculateLineHeight(fontSize) * 0.92));
    const tabSize = settings.tabSize;

    const hunks = useMemo(() => groupLinesIntoHunks(diff.lines), [diff.lines]);
    const tokenMap = useDiffHighlighting(diff.lines, diff.file_path);

    const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());

    const toggleHunkCollapse = useCallback((hunkId: number) => {
      setCollapsedHunks((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(hunkId)) {
          newSet.delete(hunkId);
        } else {
          newSet.add(hunkId);
        }
        return newSet;
      });
    }, []);

    if (diff.lines.length === 0) {
      return (
        <div className="flex items-center justify-center py-8 text-text-lighter text-xs">
          No changes in this file
        </div>
      );
    }

    return (
      <div className="editor-font">
        {hunks.map((hunk) => {
          const isCollapsed = collapsedHunks.has(hunk.id);
          return (
            <div key={hunk.id}>
              <DiffHunkHeader
                hunk={hunk}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => toggleHunkCollapse(hunk.id)}
                isStaged={isStaged}
                filePath={diff.file_path}
                onStageHunk={onStageHunk}
                onUnstageHunk={onUnstageHunk}
                isInMultiFileView={isInMultiFileView}
              />
              {!isCollapsed &&
                hunk.lines.map((line, lineIndex) => (
                  <DiffLine
                    key={`${hunk.id}-${lineIndex}`}
                    line={line}
                    viewMode={viewMode}
                    showWhitespace={showWhitespace}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    tabSize={tabSize}
                    tokens={tokenMap.get(line.diffIndex)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    );
  },
);

TextDiffViewer.displayName = "TextDiffViewer";

export default TextDiffViewer;
