import { CaretRight, Minus, Plus } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeEditor from "@/features/editor/components/code-editor";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { calculateTotalGutterWidth } from "@/features/editor/utils/gutter";
import { calculateLineHeight, splitLines } from "@/features/editor/utils/lines";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { writeFile } from "@/features/file-system/controllers/platform";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { useSearchExcerptBuffer } from "../hooks/use-search-excerpt-buffer";
import type { SearchExcerpt } from "../utils/search-excerpts";

interface SearchExcerptResultsProps {
  excerpts: SearchExcerpt[];
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext?: (filePath: string) => void;
  onCollapseContext?: (filePath: string) => void;
  isContextExpanded?: (filePath: string) => boolean;
}

interface SearchExcerptItemProps {
  excerpt: SearchExcerpt;
  index: number;
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext?: (filePath: string) => void;
  onCollapseContext?: (filePath: string) => void;
  isContextExpanded?: (filePath: string) => boolean;
}

const EDIT_SYNC_DELAY_MS = 350;
const EDITOR_PREFETCH_MARGIN = "360px 0px";
const INITIAL_EDITOR_MOUNT_COUNT = 3;

function splitContentBySegments(content: string, segmentCount: number): string[][] | null {
  const lines = splitLines(content);
  if (segmentCount <= 1) return [lines];

  const parts: string[][] = [];
  let currentPart: string[] = [];

  for (const line of lines) {
    if (line === "..." && parts.length < segmentCount - 1) {
      parts.push(currentPart);
      currentPart = [];
    } else {
      currentPart.push(line);
    }
  }

  parts.push(currentPart);
  return parts.length === segmentCount ? parts : null;
}

function buildLineNumberMapFromContent(
  content: string,
  segments: SearchExcerpt["segments"],
): Array<number | null> {
  const parts = splitContentBySegments(content, segments.length);
  if (!parts) return [];

  const lineNumberMap: Array<number | null> = [];
  let lineShift = 0;

  segments.forEach((segment, segmentIndex) => {
    if (segmentIndex > 0) {
      lineNumberMap.push(null);
    }

    const part = parts[segmentIndex] ?? [];
    const sourceStartLine = segment.sourceStartLine + lineShift;
    for (let lineIndex = 0; lineIndex < part.length; lineIndex++) {
      lineNumberMap.push(sourceStartLine + lineIndex);
    }

    lineShift += part.length - (segment.sourceEndLine - segment.sourceStartLine + 1);
  });

  return lineNumberMap;
}

function applyMappedLineChanges(
  sourceContent: string,
  excerptContent: string,
  segments: SearchExcerpt["segments"],
): string | null {
  const segmentParts = splitContentBySegments(excerptContent, segments.length);
  if (!segmentParts) return null;

  const sourceLines = sourceContent.split("\n");
  let changed = false;

  for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex--) {
    const segment = segments[segmentIndex];
    if (!segment) continue;

    const nextLines = segmentParts[segmentIndex] ?? [];
    const sourceStartIndex = segment.sourceStartLine - 1;
    const sourceLineCount = segment.sourceEndLine - segment.sourceStartLine + 1;
    const currentLines = sourceLines.slice(sourceStartIndex, sourceStartIndex + sourceLineCount);

    if (currentLines.join("\n") !== nextLines.join("\n")) {
      sourceLines.splice(sourceStartIndex, sourceLineCount, ...nextLines);
      changed = true;
    }
  }

  return changed ? sourceLines.join("\n") : null;
}

interface ExcerptEditorSurfaceProps {
  excerpt: SearchExcerpt;
  content: string;
  height: number;
  selected: boolean;
  currentHighlightIndex: number;
  lineNumberMap: Array<number | null>;
  onOpenLocation: (position: { line: number; column: number }) => void;
  onContentChange: (content: string) => void;
}

function ExcerptEditorSurface({
  excerpt,
  content,
  height,
  selected,
  currentHighlightIndex,
  lineNumberMap,
  onOpenLocation,
  onContentChange,
}: ExcerptEditorSurfaceProps) {
  const bufferId = useSearchExcerptBuffer({
    id: excerpt.id,
    filePath: excerpt.filePath,
    content,
  });

  return (
    <div className="relative overflow-hidden bg-primary-bg" style={{ height }}>
      <CodeEditor
        bufferId={bufferId}
        isActiveSurface={false}
        showToolbar={false}
        readOnly={false}
        scrollable={false}
        onReadonlySurfaceClick={onOpenLocation}
        highlightMatches={excerpt.highlights}
        currentHighlightIndex={selected ? currentHighlightIndex : -1}
        lineNumberMap={lineNumberMap}
        onContentChange={onContentChange}
      />
    </div>
  );
}

function SearchExcerptPreview({
  content,
  lineNumberMap,
  height,
  onOpenLocation,
}: {
  content: string;
  lineNumberMap: Array<number | null>;
  height: number;
  onOpenLocation: (position: { line: number; column: number }) => void;
}) {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const lineHeight = calculateLineHeight(fontSize * zoomLevel);
  const lines = useMemo(() => splitLines(content), [content]);
  const gutterWidth = useMemo(() => {
    const largestMappedLine = lineNumberMap.reduce<number>(
      (largest, lineNumber) =>
        typeof lineNumber === "number" ? Math.max(largest, lineNumber) : largest,
      0,
    );

    return calculateTotalGutterWidth(Math.max(lines.length, largestMappedLine));
  }, [lineNumberMap, lines.length]);

  return (
    <div className="overflow-hidden bg-primary-bg" style={{ height }}>
      <div
        className="py-2"
        style={{
          fontSize: `${fontSize * zoomLevel}px`,
          lineHeight: `${lineHeight}px`,
          fontFamily: "var(--editor-font-family, monospace)",
        }}
      >
        {lines.map((line, lineIndex) => {
          const mappedLine = lineNumberMap[lineIndex];
          return (
            <button
              key={`${lineIndex}-${mappedLine ?? "gap"}`}
              type="button"
              className="flex w-full min-w-0 items-start text-left text-text hover:bg-hover/25"
              onDoubleClick={() => {
                if (mappedLine !== null && mappedLine !== undefined) {
                  onOpenLocation({ line: lineIndex, column: 0 });
                }
              }}
            >
              <span
                className="shrink-0 select-none border-border border-r pr-3 text-right text-text-lighter"
                style={{ width: `${gutterWidth}px` }}
              >
                {mappedLine ?? ""}
              </span>
              <span
                className="min-w-0 flex-1 whitespace-pre text-text"
                style={{ paddingLeft: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px` }}
              >
                {line}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function hasSelectedMatch(excerpt: SearchExcerpt, selectedItemKey: string | null) {
  return Boolean(
    selectedItemKey && excerpt.matches.some((match) => match.itemKey === selectedItemKey),
  );
}

function SearchExcerptItemComponent({
  excerpt,
  index,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
}: SearchExcerptItemProps) {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(index < INITIAL_EDITOR_MOUNT_COUNT);
  const [currentContent, setCurrentContent] = useState(excerpt.content);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedContentRef = useRef(excerpt.content);
  const latestContentRef = useRef(excerpt.content);
  const selectedMatch =
    excerpt.matches.find((match) => match.itemKey === selectedItemKey) ?? excerpt.matches[0];
  const selected = selectedMatch?.itemKey === selectedItemKey;
  const currentHighlightIndex = selectedMatch?.highlightIndexes[0] ?? -1;
  const lineNumberMap = useMemo(
    () => buildLineNumberMapFromContent(currentContent, excerpt.segments),
    [currentContent, excerpt.segments],
  );
  const isExpanded = isContextExpanded?.(excerpt.filePath) ?? false;
  const height = useMemo(() => {
    const lineHeight = calculateLineHeight(fontSize * zoomLevel);
    const currentLineCount = splitLines(currentContent).length;

    return Math.max(
      currentLineCount * lineHeight +
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
        EDITOR_CONSTANTS.EDITOR_PADDING_BOTTOM,
      104,
    );
  }, [currentContent, fontSize, zoomLevel]);
  const shouldMountEditor = selected || isNearViewport;

  const openTarget = useCallback(() => {
    if (!selectedMatch) return;
    onOpen(excerpt.filePath, selectedMatch.targetLine, selectedMatch.targetColumn);
  }, [excerpt.filePath, onOpen, selectedMatch]);

  const openReadonlyLocation = useCallback(
    ({ line, column }: { line: number; column: number }) => {
      const mappedLine = lineNumberMap[line];
      if (mappedLine === null || mappedLine === undefined) return;
      onOpen(excerpt.filePath, mappedLine, column + 1);
    },
    [excerpt.filePath, lineNumberMap, onOpen],
  );

  useEffect(() => {
    setCurrentContent(excerpt.content);
    lastSyncedContentRef.current = excerpt.content;
    latestContentRef.current = excerpt.content;
  }, [excerpt.content]);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(Boolean(entry?.isIntersecting));
      },
      { root: null, rootMargin: EDITOR_PREFETCH_MARGIN },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const syncExcerptEdits = useCallback(
    async (nextContent: string) => {
      if (nextContent === lastSyncedContentRef.current) return;

      const { buffers, actions } = useBufferStore.getState();
      const openSourceBuffer = buffers.find(
        (buffer) =>
          buffer.type === "editor" && !buffer.isVirtual && buffer.path === excerpt.filePath,
      );
      const sourceContent =
        openSourceBuffer && openSourceBuffer.type === "editor"
          ? openSourceBuffer.content
          : await readFileContent(excerpt.filePath);
      const nextSourceContent = applyMappedLineChanges(
        sourceContent,
        nextContent,
        excerpt.segments,
      );

      if (nextSourceContent === null) return;

      if (openSourceBuffer && openSourceBuffer.type === "editor") {
        actions.updateBufferContent(openSourceBuffer.id, nextSourceContent, true);
      } else {
        await writeFile(excerpt.filePath, nextSourceContent);
      }

      lastSyncedContentRef.current = nextContent;
    },
    [excerpt.filePath, excerpt.segments],
  );

  const handleExcerptContentChange = useCallback(
    (nextContent: string) => {
      setCurrentContent(nextContent);
      latestContentRef.current = nextContent;

      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }

      syncTimerRef.current = setTimeout(() => {
        void syncExcerptEdits(nextContent);
        syncTimerRef.current = null;
      }, EDIT_SYNC_DELAY_MS);
    },
    [syncExcerptEdits],
  );

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        void syncExcerptEdits(latestContentRef.current);
      }
    };
  }, [syncExcerptEdits]);

  const handleContextToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isExpanded) {
        onCollapseContext?.(excerpt.filePath);
      } else {
        onExpandContext?.(excerpt.filePath);
      }
    },
    [excerpt.filePath, isExpanded, onCollapseContext, onExpandContext],
  );

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      openTarget();
    },
    [openTarget],
  );

  return (
    <section
      ref={sectionRef}
      data-excerpt-index={index}
      className={cn(
        "overflow-hidden rounded-md border bg-primary-bg",
        selected ? "border-accent/60 shadow-[0_0_0_1px_var(--accent)]" : "border-border/70",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={openTarget}
        onKeyDown={handleHeaderKeyDown}
        className="flex min-w-0 cursor-pointer items-center gap-2 border-border/70 border-b bg-secondary-bg/45 px-2.5 py-1.5 hover:bg-hover/35"
      >
        <FileExplorerIcon
          fileName={excerpt.fileName}
          isDir={false}
          size={15}
          className="shrink-0 text-text-lighter"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="ui-text-sm shrink-0 font-medium text-text">{excerpt.fileName}</span>
          {excerpt.directoryPath ? (
            <span className="ui-text-xs min-w-0 truncate text-text-lighter">
              {excerpt.directoryPath}
            </span>
          ) : null}
          <CaretRight size={12} className="shrink-0 text-text-lighter/70" />
          {selectedMatch ? (
            <span className="ui-text-xs shrink-0 text-text-lighter">
              :{selectedMatch.targetLine}
            </span>
          ) : null}
        </div>
        <span className="ui-text-xs shrink-0 rounded border border-border/60 bg-primary-bg/70 px-1.5 py-0.5 text-text-lighter">
          {excerpt.matchCount}
        </span>
        {(onExpandContext || onCollapseContext) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleContextToggle}
            tooltip={isExpanded ? "Collapse context" : "Expand context"}
            aria-label={isExpanded ? "Collapse context" : "Expand context"}
            className="shrink-0 text-text-lighter"
          >
            {isExpanded ? <Minus size={14} /> : <Plus size={14} />}
          </Button>
        )}
      </div>
      {shouldMountEditor ? (
        <ExcerptEditorSurface
          excerpt={excerpt}
          content={currentContent}
          height={height}
          selected={selected}
          currentHighlightIndex={currentHighlightIndex}
          lineNumberMap={lineNumberMap}
          onOpenLocation={openReadonlyLocation}
          onContentChange={handleExcerptContentChange}
        />
      ) : (
        <SearchExcerptPreview
          content={currentContent}
          lineNumberMap={lineNumberMap}
          height={height}
          onOpenLocation={openReadonlyLocation}
        />
      )}
    </section>
  );
}

const SearchExcerptItem = memo(SearchExcerptItemComponent, (prev, next) => {
  const wasSelected = hasSelectedMatch(prev.excerpt, prev.selectedItemKey);
  const isSelected = hasSelectedMatch(next.excerpt, next.selectedItemKey);

  return (
    prev.excerpt === next.excerpt &&
    prev.index === next.index &&
    wasSelected === isSelected &&
    (!wasSelected || prev.selectedItemKey === next.selectedItemKey) &&
    prev.onOpen === next.onOpen &&
    prev.onExpandContext === next.onExpandContext &&
    prev.onCollapseContext === next.onCollapseContext &&
    prev.isContextExpanded === next.isContextExpanded
  );
});

export const SearchExcerptResults = memo(function SearchExcerptResults({
  excerpts,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
}: SearchExcerptResultsProps) {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3">
      <div className="space-y-2">
        {excerpts.map((excerpt, index) => (
          <SearchExcerptItem
            key={excerpt.id}
            excerpt={excerpt}
            index={index}
            selectedItemKey={selectedItemKey}
            onOpen={onOpen}
            onExpandContext={onExpandContext}
            onCollapseContext={onCollapseContext}
            isContextExpanded={isContextExpanded}
          />
        ))}
      </div>
    </div>
  );
});
