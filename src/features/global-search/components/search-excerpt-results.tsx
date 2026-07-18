import { MinusIcon as Minus, PlusIcon as Plus } from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { MultibufferFileHeader } from "@/features/editor/components/multibuffer/multibuffer-file-header";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { Button } from "@/ui/button";
import type { SearchExcerpt } from "../utils/search-excerpts";
import { SearchExcerptCode, type SearchExcerptTypography } from "./search-excerpt-code";

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
  typography: SearchExcerptTypography;
}

const SYNTAX_PREFETCH_MARGIN = "240px 0px";
const INITIAL_SYNTAX_HIGHLIGHT_COUNT = 1;

function SearchExcerptItemComponent({
  excerpt,
  index,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
  typography,
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
  const isExpanded = isContextExpanded?.(excerpt.filePath) ?? false;

  const openTarget = useCallback(() => {
    if (!selectedMatch) return;
    onOpen(excerpt.filePath, selectedMatch.targetLine, selectedMatch.targetColumn);
  }, [excerpt.filePath, onOpen, selectedMatch]);

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
    <section
      ref={sectionRef}
      data-excerpt-index={index}
      className="relative isolate min-w-0 max-w-full rounded-xl bg-primary-bg"
    >
      <MultibufferFileHeader
        filePath={excerpt.filePath}
        fileName={excerpt.fileName}
        directoryPath={excerpt.directoryPath}
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
              className="shrink-0 text-text-lighter"
              size="icon-xs"
            >
              {isExpanded ? <Minus size={14} /> : <Plus size={14} />}
            </Button>
          ) : null
        }
      />
      <div className="-mt-px min-w-0 max-w-full overflow-hidden rounded-b-xl border-border/70 border-x border-b">
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
    previous.typography === next.typography
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

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 rounded-xl">
      {excerpts.map((excerpt, index) => (
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
        />
      ))}
    </div>
  );
});
