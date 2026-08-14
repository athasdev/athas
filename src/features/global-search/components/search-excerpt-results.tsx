import { MinusIcon as Minus, PlusIcon as Plus } from "@/ui/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { MultibufferFileHeader } from "@/features/editor/components/multibuffer/multibuffer-file-header";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { Button } from "@/ui/button";
import type { SearchExcerpt } from "../utils/search-excerpts";
import {
  estimateSearchExcerptHeight,
  getStickySearchExcerptIndex,
  shouldVirtualizeSearchExcerpts,
} from "../utils/search-excerpt-virtualization";
import { SearchExcerptCode, type SearchExcerptTypography } from "./search-excerpt-code";

interface SearchExcerptResultsProps {
  excerpts: SearchExcerpt[];
  scrollElement: HTMLDivElement | null;
  scrollToExcerptRef: RefObject<SearchExcerptScroller | null>;
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext?: (filePath: string) => void;
  onCollapseContext?: (filePath: string) => void;
  isContextExpanded?: (filePath: string) => boolean;
}

export type SearchExcerptScroller = (
  index: number,
  align?: "auto" | "start" | "center" | "end",
) => void;

interface SearchExcerptItemProps {
  excerpt: SearchExcerpt;
  index: number;
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext?: (filePath: string) => void;
  onCollapseContext?: (filePath: string) => void;
  isContextExpanded?: (filePath: string) => boolean;
  typography: SearchExcerptTypography;
  stickyHeader: boolean;
}

interface SearchExcerptFileHeaderProps {
  excerpt: SearchExcerpt;
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext?: (filePath: string) => void;
  onCollapseContext?: (filePath: string) => void;
  isContextExpanded?: (filePath: string) => boolean;
  sticky: boolean;
}

const SYNTAX_PREFETCH_MARGIN = "240px 0px";
const INITIAL_SYNTAX_HIGHLIGHT_COUNT = 1;
const VIRTUALIZATION_OVERSCAN = 4;

function SearchExcerptFileHeader({
  excerpt,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
  sticky,
}: SearchExcerptFileHeaderProps) {
  const selectedMatch =
    (selectedItemKey
      ? excerpt.matches.find((match) => match.itemKey === selectedItemKey)
      : undefined) ?? excerpt.matches[0];
  const isExpanded = isContextExpanded?.(excerpt.filePath) ?? false;

  const openTarget = useCallback(() => {
    if (!selectedMatch) return;
    onOpen(excerpt.filePath, selectedMatch.targetLine, selectedMatch.targetColumn);
  }, [excerpt.filePath, onOpen, selectedMatch]);

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

  return (
    <MultibufferFileHeader
      filePath={excerpt.filePath}
      fileName={excerpt.fileName}
      directoryPath={excerpt.directoryPath}
      surface="section"
      sticky={sticky}
      onOpen={openTarget}
      trailing={
        <>
          {selectedMatch ? <span>:{selectedMatch.targetLine}</span> : null}
          <span>
            {excerpt.matchCount} {excerpt.matchCount === 1 ? "match" : "matches"}
          </span>
        </>
      }
      actions={
        onExpandContext || onCollapseContext ? (
          <Button
            type="button"
            variant="ghost"
            onClick={handleContextToggle}
            tooltip={isExpanded ? "Collapse context" : "Expand context"}
            aria-label={isExpanded ? "Collapse context" : "Expand context"}
            className="shrink-0 text-subtle-foreground"
            size="icon-xs"
          >
            {isExpanded ? <Minus size={14} /> : <Plus size={14} />}
          </Button>
        ) : null
      }
    />
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
  typography,
  stickyHeader,
}: SearchExcerptItemProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [shouldHighlightSyntax, setShouldHighlightSyntax] = useState(
    index < INITIAL_SYNTAX_HIGHLIGHT_COUNT,
  );
  const selectedMatch =
    (selectedItemKey
      ? excerpt.matches.find((match) => match.itemKey === selectedItemKey)
      : undefined) ?? excerpt.matches[0];
  const selectedHighlightIndexes =
    selectedMatch?.itemKey === selectedItemKey ? selectedMatch.highlightIndexes : [];
  const openReadonlyLocation = useCallback(
    ({ line, column }: { line: number; column: number }) => {
      const mappedLine = excerpt.lineNumberMap[line];
      if (mappedLine === null || mappedLine === undefined) return;
      onOpen(excerpt.filePath, mappedLine, column + 1);
    },
    [excerpt.filePath, excerpt.lineNumberMap, onOpen],
  );

  useEffect(() => {
    if (shouldHighlightSyntax) return;

    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldHighlightSyntax(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldHighlightSyntax(true);
        observer.disconnect();
      },
      { root: null, rootMargin: SYNTAX_PREFETCH_MARGIN },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldHighlightSyntax]);

  return (
    <section
      ref={sectionRef}
      data-excerpt-index={index}
      className="relative isolate min-w-0 max-w-full border-border/60 border-b bg-background"
    >
      <SearchExcerptFileHeader
        excerpt={excerpt}
        selectedItemKey={selectedItemKey}
        onOpen={onOpen}
        onExpandContext={onExpandContext}
        onCollapseContext={onCollapseContext}
        isContextExpanded={isContextExpanded}
        sticky={stickyHeader}
      />
      <div className="min-w-0 max-w-full overflow-hidden">
        <SearchExcerptCode
          excerpt={excerpt}
          selectedHighlightIndexes={selectedHighlightIndexes}
          shouldHighlightSyntax={shouldHighlightSyntax}
          typography={typography}
          onOpenLocation={openReadonlyLocation}
        />
      </div>
    </section>
  );
}

const SearchExcerptItem = memo(SearchExcerptItemComponent, (previous, next) => {
  return (
    previous.excerpt === next.excerpt &&
    previous.index === next.index &&
    previous.selectedItemKey === next.selectedItemKey &&
    previous.onOpen === next.onOpen &&
    previous.onExpandContext === next.onExpandContext &&
    previous.onCollapseContext === next.onCollapseContext &&
    previous.isContextExpanded === next.isContextExpanded &&
    previous.typography === next.typography &&
    previous.stickyHeader === next.stickyHeader
  );
});

export const SearchExcerptResults = memo(function SearchExcerptResults({
  excerpts,
  scrollElement,
  scrollToExcerptRef,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
}: SearchExcerptResultsProps) {
  const editorSettings = useEditorSettingsStore(
    useShallow((state) => ({
      fontSize: state.fontSize,
      fontFamily: state.fontFamily,
      lineHeight: state.lineHeight,
      tabSize: state.tabSize,
      lineNumbers: state.lineNumbers,
    })),
  );
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const typography = useMemo<SearchExcerptTypography>(() => {
    const fontSize = editorSettings.fontSize * zoomLevel;
    return {
      fontSize,
      fontFamily: editorSettings.fontFamily,
      lineHeight: calculateLineHeight(fontSize, editorSettings.lineHeight),
      tabSize: editorSettings.tabSize,
      showLineNumbers: editorSettings.lineNumbers,
    };
  }, [editorSettings, zoomLevel]);
  const selectedExcerptId = useMemo(() => {
    if (!selectedItemKey) return null;

    for (const excerpt of excerpts) {
      for (const match of excerpt.matches) {
        if (match.itemKey === selectedItemKey) return excerpt.id;
      }
    }

    return null;
  }, [excerpts, selectedItemKey]);
  const shouldVirtualize = shouldVirtualizeSearchExcerpts(excerpts);
  const estimateExcerptSize = useCallback(
    (index: number) => estimateSearchExcerptHeight(excerpts[index], typography.lineHeight),
    [excerpts, typography.lineHeight],
  );
  const excerptVirtualizer = useVirtualizer({
    count: excerpts.length,
    enabled: shouldVirtualize,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => excerpts[index]?.id ?? index,
    estimateSize: estimateExcerptSize,
    overscan: VIRTUALIZATION_OVERSCAN,
  });
  const scrollToExcerpt = useCallback<SearchExcerptScroller>(
    (index, align = "auto") => {
      if (index < 0 || index >= excerpts.length) return;

      if (shouldVirtualize) {
        excerptVirtualizer.scrollToIndex(index, { align, behavior: "auto" });
        return;
      }

      const excerptElement = scrollElement?.querySelector<HTMLElement>(
        `[data-excerpt-index="${index}"]`,
      );
      excerptElement?.scrollIntoView({
        behavior: "auto",
        block: align === "auto" ? "nearest" : align,
      });
    },
    [excerptVirtualizer, excerpts.length, scrollElement, shouldVirtualize],
  );

  useEffect(() => {
    scrollToExcerptRef.current = scrollToExcerpt;
    return () => {
      if (scrollToExcerptRef.current === scrollToExcerpt) {
        scrollToExcerptRef.current = null;
      }
    };
  }, [scrollToExcerpt, scrollToExcerptRef]);

  const renderExcerpt = (excerpt: SearchExcerpt, index: number, stickyHeader: boolean) => (
    <SearchExcerptItem
      key={excerpt.id}
      excerpt={excerpt}
      index={index}
      selectedItemKey={excerpt.id === selectedExcerptId ? selectedItemKey : null}
      onOpen={onOpen}
      onExpandContext={onExpandContext}
      onCollapseContext={onCollapseContext}
      isContextExpanded={isContextExpanded}
      typography={typography}
      stickyHeader={stickyHeader}
    />
  );

  if (!shouldVirtualize) {
    return (
      <div className="min-w-0 max-w-full">
        {excerpts.map((excerpt, index) => renderExcerpt(excerpt, index, true))}
      </div>
    );
  }

  const virtualItems = excerptVirtualizer.getVirtualItems();
  const stickyExcerptIndex = getStickySearchExcerptIndex(
    virtualItems,
    excerptVirtualizer.scrollOffset ?? scrollElement?.scrollTop ?? 0,
  );
  const stickyExcerpt = excerpts[stickyExcerptIndex];
  return (
    <div
      className="relative min-w-0 max-w-full"
      style={{ height: excerptVirtualizer.getTotalSize() }}
      data-virtualized-search-results=""
    >
      {stickyExcerpt ? (
        <div className="pointer-events-none sticky top-0 z-50 h-0 min-w-0 max-w-full">
          <div className="pointer-events-auto">
            <SearchExcerptFileHeader
              excerpt={stickyExcerpt}
              selectedItemKey={stickyExcerpt.id === selectedExcerptId ? selectedItemKey : null}
              onOpen={onOpen}
              onExpandContext={onExpandContext}
              onCollapseContext={onCollapseContext}
              isContextExpanded={isContextExpanded}
              sticky={false}
            />
          </div>
        </div>
      ) : null}
      {virtualItems.map((virtualItem) => {
        const excerpt = excerpts[virtualItem.index];
        if (!excerpt) return null;

        return (
          <div
            key={virtualItem.key}
            className="absolute inset-x-0 top-0 min-w-0"
            style={{
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderExcerpt(excerpt, virtualItem.index, false)}
          </div>
        );
      })}
    </div>
  );
});
