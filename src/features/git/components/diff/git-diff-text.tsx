import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useSelectionScope } from "@/features/editor/hooks/use-selection-scope";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { Empty, EmptyDescription } from "@/ui/empty";
import { useDiffHighlighting } from "../../hooks/use-git-diff-highlight";
import type {
  DiffSearchHighlight,
  ParsedHunk,
  TextDiffViewerProps,
} from "../../types/git-diff.types";
import { DIFF_HIGHLIGHT_LINE_THRESHOLD } from "../../utils/diff-viewer-scale";
import { getSkippedUnchangedLineCount, groupLinesIntoHunks } from "../../utils/git-diff-helpers";
import DiffHunkHeader from "./git-diff-hunk-header";
import DiffLine, {
  getContentColor,
  getGutterBackground,
  getGutterTextColor,
  getLineBackground,
  getRailClassName,
  getSplitLineMeta,
  renderDiffLineContent,
} from "./git-diff-line";

function SplitDiffCodePanel({
  side,
  lines,
  tokenMap,
  showWhitespace,
  fontSize,
  lineHeight,
  tabSize,
  searchHighlights,
}: {
  side: "left" | "right";
  lines: ParsedHunk["lines"];
  tokenMap: ReturnType<typeof useDiffHighlighting>;
  showWhitespace: boolean;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  searchHighlights?: Map<number, DiffSearchHighlight[]>;
}) {
  const contentStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
    tabSize,
    whiteSpace: "pre" as const,
    overflowWrap: "normal" as const,
    wordBreak: "normal" as const,
  };

  return (
    <div className="flex min-w-0 flex-1">
      <div className="w-11 shrink-0 border-border border-r bg-background">
        {lines.map((line, index) => {
          const meta = getSplitLineMeta(line, side);
          return (
            <div
              key={`${side}-gutter-${index}`}
              className={`select-none px-2 py-0.5 text-right tabular-nums ${getGutterBackground(meta.diffType)} ${getRailClassName(meta.diffType)} ${getGutterTextColor(meta.diffType)}`}
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${lineHeight}px`,
              }}
              data-selection-scope-exclude="true"
            >
              {meta.isVisible ? meta.gutterNumber : ""}
            </div>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="min-w-max">
          {lines.map((line, index) => {
            const meta = getSplitLineMeta(line, side);
            const tokens = tokenMap.get(line.diffIndex);
            return (
              <div
                key={`${side}-code-${index}`}
                className={`px-2.5 py-0.5 ${getLineBackground(meta.diffType)}`}
                style={contentStyle}
                data-diff-search-line={line.diffIndex}
              >
                <span className={meta.isVisible ? getContentColor(meta.diffType) : undefined}>
                  {meta.isVisible
                    ? renderDiffLineContent(
                        line.content,
                        tokens,
                        showWhitespace,
                        searchHighlights?.get(line.diffIndex),
                      )
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const TextDiffViewer = memo(
  ({
    diff,
    isStaged,
    viewMode,
    showWhitespace,
    onStageHunk,
    onUnstageHunk,
    isInMultiFileView = false,
    isEmbeddedInScrollView = false,
    searchHighlights,
  }: TextDiffViewerProps) => {
    const selectionScopeRef = useRef<HTMLDivElement>(null);
    const editorFontSize = useEditorSettingsStore.use.fontSize();
    const editorFontFamily = useEditorSettingsStore.use.fontFamily();
    const editorLineHeight = useEditorSettingsStore.use.lineHeight();
    const editorTabSize = useEditorSettingsStore.use.tabSize();
    const wordWrap = useEditorSettingsStore.use.wordWrap();
    const zoomLevel = useZoomStore.use.editorZoomLevel();
    const fontSize = editorFontSize * zoomLevel;
    const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
    const tabSize = editorTabSize;

    const hunks = useMemo(() => groupLinesIntoHunks(diff.lines), [diff.lines]);
    const syntaxPath = diff.new_path || diff.old_path || diff.file_path;
    const highlightLines = diff.lines.length <= DIFF_HIGHLIGHT_LINE_THRESHOLD ? diff.lines : [];
    const tokenMap = useDiffHighlighting(highlightLines, syntaxPath);

    const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());
    useSelectionScope(selectionScopeRef);

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
        <Empty className="min-h-0 flex-none rounded-none py-8">
          <EmptyDescription>No changes in this file</EmptyDescription>
        </Empty>
      );
    }

    if (viewMode === "split" && !wordWrap) {
      return (
        <div
          ref={selectionScopeRef}
          className="font-mono code-editor-font-override min-w-0"
          style={{
            fontSize: `${fontSize}px`,
            fontFamily: editorFontFamily,
            lineHeight: `${lineHeight}px`,
            tabSize,
          }}
        >
          {hunks.map((hunk, hunkIndex) => {
            const isCollapsed = collapsedHunks.has(hunk.id);
            const hiddenLineCount = getSkippedUnchangedLineCount(hunks[hunkIndex - 1], hunk);
            return (
              <div key={`split-${hunk.id}`}>
                <DiffHunkHeader
                  hunk={hunk}
                  hiddenLineCount={hiddenLineCount}
                  isCollapsed={isCollapsed}
                  onToggleCollapse={() => toggleHunkCollapse(hunk.id)}
                  isStaged={isStaged}
                  filePath={diff.file_path}
                  onStageHunk={onStageHunk}
                  onUnstageHunk={onUnstageHunk}
                  isInMultiFileView={isInMultiFileView}
                />
                {!isCollapsed && (
                  <div className="flex min-w-0">
                    <div className="min-w-0 flex-1 border-border border-r">
                      <SplitDiffCodePanel
                        side="left"
                        lines={hunk.lines}
                        tokenMap={tokenMap}
                        showWhitespace={showWhitespace}
                        fontSize={fontSize}
                        lineHeight={lineHeight}
                        tabSize={tabSize}
                        searchHighlights={searchHighlights}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <SplitDiffCodePanel
                        side="right"
                        lines={hunk.lines}
                        tokenMap={tokenMap}
                        showWhitespace={showWhitespace}
                        fontSize={fontSize}
                        lineHeight={lineHeight}
                        tabSize={tabSize}
                        searchHighlights={searchHighlights}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div
        ref={selectionScopeRef}
        className={
          isEmbeddedInScrollView
            ? "min-w-0 overflow-x-auto overflow-y-hidden"
            : viewMode === "split"
              ? "min-w-0 overflow-hidden"
              : "min-w-0 overflow-x-auto overflow-y-hidden"
        }
      >
        <div
          className={
            viewMode === "split"
              ? "font-mono code-editor-font-override min-w-0 w-full"
              : "font-mono code-editor-font-override min-w-full w-fit"
          }
          style={{
            fontSize: `${fontSize}px`,
            fontFamily: editorFontFamily,
            lineHeight: `${lineHeight}px`,
            tabSize,
          }}
        >
          {hunks.map((hunk, hunkIndex) => {
            const isCollapsed = collapsedHunks.has(hunk.id);
            const hiddenLineCount = getSkippedUnchangedLineCount(hunks[hunkIndex - 1], hunk);
            return (
              <div key={hunk.id}>
                <DiffHunkHeader
                  hunk={hunk}
                  hiddenLineCount={hiddenLineCount}
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
                      wordWrap={wordWrap}
                      showWhitespace={showWhitespace}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                      tabSize={tabSize}
                      tokens={tokenMap.get(line.diffIndex)}
                      searchHighlights={searchHighlights?.get(line.diffIndex)}
                      searchLineIndex={line.diffIndex}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

TextDiffViewer.displayName = "TextDiffViewer";

export default TextDiffViewer;
