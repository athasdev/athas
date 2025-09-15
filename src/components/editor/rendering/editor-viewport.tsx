import type React from "react";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { getFileDiffAgainstContent } from "@/version-control/git/controllers/git";
import type { GitDiff, GitDiffLine } from "@/version-control/git/models/git-types";
import { LineWithContent } from "./line-with-content";

interface EditorViewportProps {
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
}

// TODO: use ref as props since we are in React 19
export const EditorViewport = memo(
  forwardRef<HTMLDivElement, EditorViewportProps>(
    ({ onScroll, onClick, onMouseDown, onMouseMove, onMouseUp, onContextMenu }, ref) => {
      const selection = useEditorCursorStore((state) => state.selection);
      const lines = useEditorViewStore((state) => state.lines);
      const storeDiffData = useEditorViewStore((state) => state.diffData) as GitDiff | undefined;
      const { getContent } = useEditorViewStore.use.actions();
      const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
      const showInlineDiff = useEditorSettingsStore.use.showInlineDiff();
      const scrollTop = useEditorLayoutStore.use.scrollTop();
      const viewportHeight = useEditorLayoutStore.use.viewportHeight();
      const tabSize = useEditorSettingsStore.use.tabSize();
      const { lineHeight, gutterWidth } = useEditorLayout();
      const { filePath } = useEditorInstanceStore();
      const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

      // Maintain a local, content-based diff for live typing scenarios when inline diff is enabled
      const [contentDiff, setContentDiff] = useState<GitDiff | undefined>(undefined);

      useEffect(() => {
        if (!showInlineDiff || !rootFolderPath || !filePath) {
          setContentDiff(undefined);
          return;
        }

        const content = getContent();
        let timer: ReturnType<typeof setTimeout> | null = null;

        const run = async () => {
          try {
            // Compute relative path
            let relativePath = filePath;
            if (relativePath.startsWith(rootFolderPath)) {
              relativePath = relativePath.slice(rootFolderPath.length);
              if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
            }
            const diff = await getFileDiffAgainstContent(
              rootFolderPath,
              relativePath,
              content,
              "head",
            );
            setContentDiff(diff ?? undefined);
          } catch (e) {
            console.error(e);
          }
        };

        // Debounce updates to avoid frequent diff calculations while typing
        timer = setTimeout(run, 500);
        return () => {
          if (timer) clearTimeout(timer);
        };
        // Depend on lines so we refresh when content changes; getContent() returns latest content
      }, [showInlineDiff, rootFolderPath, filePath, lines, getContent]);

      const diffData = showInlineDiff ? (contentDiff ?? storeDiffData) : undefined;

      // Create a unified view of lines including both buffer and diff-only lines
      const unifiedLines = useMemo(() => {
        if (!showInlineDiff || !diffData?.lines) {
          // No diff data or diff is disabled, just show regular buffer lines
          return lines.map((content, index) => ({
            type: "buffer" as const,
            bufferLineIndex: index,
            content,
            diffLine: undefined,
          }));
        }

        type UnifiedLine = {
          type: "buffer" | "diff-only";
          bufferLineIndex?: number;
          content: string;
          diffLine?: GitDiffLine;
        };

        const result: UnifiedLine[] = [];
        let bufferLineIndex = 0; // 0-based index into current buffer lines
        let pendingRemoved: GitDiffLine[] = [];

        const flushUnchangedUpTo = (targetBufferIndexExclusive: number) => {
          while (bufferLineIndex < Math.min(targetBufferIndexExclusive, lines.length)) {
            result.push({
              type: "buffer",
              bufferLineIndex,
              content: lines[bufferLineIndex],
              diffLine: undefined,
            });
            bufferLineIndex++;
          }
        };

        const flushPendingRemoved = () => {
          if (pendingRemoved.length === 0) return;
          for (const rl of pendingRemoved) {
            result.push({ type: "diff-only", content: rl.content, diffLine: rl });
          }
          pendingRemoved = [];
        };

        for (const dl of diffData.lines) {
          if (dl.line_type === "header") continue;

          if (dl.line_type === "removed") {
            // Queue removed lines; they'll be displayed before the next added/context line
            pendingRemoved.push(dl);
            continue;
          }

          // For added/context lines, position by new_line_number
          const newNumber = dl.new_line_number;
          if (typeof newNumber === "number") {
            const targetIndex = newNumber - 1; // convert to 0-based
            // Fill unchanged lines up to the target
            flushUnchangedUpTo(targetIndex);
            // Show any pending deletions just before the current position
            flushPendingRemoved();
            // Now push the current buffer line aligned with this diff line
            if (bufferLineIndex < lines.length) {
              result.push({
                type: "buffer",
                bufferLineIndex,
                content: lines[bufferLineIndex],
                diffLine: dl,
              });
              bufferLineIndex++;
            }
          }
        }

        // If there are trailing deletions at EOF, show them now
        flushPendingRemoved();
        // Add remaining unchanged buffer lines
        flushUnchangedUpTo(lines.length);

        return result;
      }, [lines, diffData, showInlineDiff]);

      const selectedLines = useMemo(() => {
        const selectedSet = new Set<number>();
        if (selection) {
          for (let i = selection.start.line; i <= selection.end.line; i++) {
            selectedSet.add(i);
          }
        }
        return selectedSet;
      }, [selection]);
      const containerRef = useRef<HTMLDivElement>(null);

      // Expose the container ref to parent components
      useImperativeHandle(ref, () => containerRef.current!, []);

      const [, setIsScrolling] = useState(false);
      const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
      const [, forceUpdate] = useState({});
      const isScrollingRef = useRef(false);

      // Sync scroll position from prop only when not actively scrolling
      useEffect(() => {
        if (containerRef.current && !isScrollingRef.current) {
          containerRef.current.scrollTop = scrollTop;
        }
      }, [scrollTop]);

      const visibleRange = useMemo(() => {
        // Use the actual scroll position from the DOM element if available
        const actualScrollTop = containerRef.current?.scrollTop ?? scrollTop;
        const startLine = Math.floor(actualScrollTop / lineHeight);
        const endLine = Math.ceil((actualScrollTop + viewportHeight) / lineHeight);
        // Dynamic overscan based on viewport size
        const visibleLineCount = endLine - startLine;
        const overscan = Math.max(
          EDITOR_CONSTANTS.MIN_OVERSCAN_LINES,
          Math.ceil(visibleLineCount * EDITOR_CONSTANTS.VIEWPORT_OVERSCAN_RATIO),
        );

        return {
          start: Math.max(0, startLine - overscan),
          end: Math.min(unifiedLines.length, endLine + overscan),
        };
      }, [scrollTop, lineHeight, viewportHeight, unifiedLines.length, forceUpdate]);

      const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const newScrollTop = target.scrollTop;
        const newScrollLeft = target.scrollLeft;

        isScrollingRef.current = true;
        setIsScrolling(true);

        // Force re-render to update visible range
        forceUpdate({});

        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }

        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
          isScrollingRef.current = false;
        }, 150);

        // Still notify parent component
        onScroll?.(newScrollTop, newScrollLeft);
      };

      useEffect(() => {
        return () => {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
        };
      }, []);

      const totalHeight = unifiedLines.length * lineHeight + 20 * lineHeight; // Add 20 lines of empty space at bottom

      return (
        <div
          ref={containerRef}
          className="editor-viewport"
          onScroll={handleScroll}
          style={{
            position: "relative",
            overflow: "auto",
            height: `${viewportHeight}px`,
          }}
        >
          {/* Gutter background for full height */}
          {showLineNumbers && (
            <div
              className="editor-gutter-background"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${gutterWidth}px`,
                height: `${Math.max(totalHeight, viewportHeight)}px`,
                backgroundColor: "var(--color-gutter-background, rgba(128, 128, 128, 0.05))",
                zIndex: 0,
              }}
            />
          )}
          <div
            className="editor-content"
            style={{
              position: "relative",
              height: `${totalHeight}px`,
              minWidth: "100%",
              zIndex: 1,
              tabSize: tabSize,
            }}
            onClick={onClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onContextMenu={onContextMenu}
          >
            {/* Array.from creates an array of specified length, then maps over
              indices to generate line components */}
            {Array.from({ length: visibleRange.end - visibleRange.start }, (_, i) => {
              const idx = visibleRange.start + i;
              const unifiedLine = unifiedLines[idx];

              if (!unifiedLine) return null;

              return (
                <LineWithContent
                  key={`line-${idx}`}
                  lineNumber={idx}
                  bufferLineIndex={unifiedLine.bufferLineIndex}
                  content={unifiedLine.content}
                  diffLine={unifiedLine.diffLine}
                  isDiffOnly={unifiedLine.type === "diff-only"}
                  showLineNumbers={showLineNumbers}
                  gutterWidth={gutterWidth}
                  lineHeight={lineHeight}
                  isSelected={
                    unifiedLine.bufferLineIndex !== undefined
                      ? selectedLines.has(unifiedLine.bufferLineIndex)
                      : false
                  }
                />
              );
            })}
          </div>
        </div>
      );
    },
  ),
);

EditorViewport.displayName = "EditorViewport";
