import { memo, type MouseEvent, useCallback, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { calculateTotalGutterWidth } from "@/features/editor/utils/gutter";
import { measureTextWidth } from "@/features/editor/utils/position";
import { cn } from "@/utils/cn";
import { useSearchExcerptTokens } from "../hooks/use-search-excerpt-tokens";
import {
  buildSearchExcerptRenderLines,
  findClosestTextColumn,
  type SearchExcerptRenderLine,
} from "../utils/search-excerpt-lines";
import type { SearchExcerpt } from "../utils/search-excerpts";

interface SearchExcerptCodeProps {
  excerpt: SearchExcerpt;
  selectedHighlightIndexes: readonly number[];
  shouldHighlightSyntax: boolean;
  typography: SearchExcerptTypography;
  onOpenLocation: (position: { line: number; column: number }) => void;
}

export interface SearchExcerptTypography {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
}

interface SearchExcerptLineProps {
  line: SearchExcerptRenderLine;
  lineIndex: number;
  mappedLine: number | null | undefined;
  gutterWidth: number;
  selectedHighlightIndexes: readonly number[];
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  showLineNumbers: boolean;
  onOpenLocation: (position: { line: number; column: number }) => void;
}

const SearchExcerptLine = memo(function SearchExcerptLine({
  line,
  lineIndex,
  mappedLine,
  gutterWidth,
  selectedHighlightIndexes,
  fontSize,
  fontFamily,
  tabSize,
  showLineNumbers,
  onOpenLocation,
}: SearchExcerptLineProps) {
  const content = (
    <>
      {showLineNumbers ? (
        <span
          className="shrink-0 select-none border-border border-r pr-3 text-right text-text-lighter tabular-nums"
          style={{ width: `${gutterWidth}px` }}
        >
          {mappedLine ?? ""}
        </span>
      ) : null}
      <span
        data-search-excerpt-code
        className="min-w-0 flex-1 overflow-hidden px-4 whitespace-pre text-text"
      >
        {line.segments.length > 0
          ? line.segments.map((segment) => {
              const isMatch = segment.highlightIndexes.length > 0;
              const isCurrent = segment.highlightIndexes.some((index) =>
                selectedHighlightIndexes.includes(index),
              );
              return (
                <span
                  key={segment.startColumn}
                  className={cn(
                    segment.tokenClassName,
                    isMatch && "rounded-sm bg-warning/20",
                    isCurrent && "bg-warning/40 ring-1 ring-inset ring-warning/60",
                  )}
                >
                  {segment.text}
                </span>
              );
            })
          : "\u00A0"}
      </span>
    </>
  );
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const codeElement = event.currentTarget.querySelector<HTMLElement>(
        "[data-search-excerpt-code]",
      );
      const targetWidth = codeElement
        ? event.clientX -
          codeElement.getBoundingClientRect().left -
          EDITOR_CONSTANTS.EDITOR_PADDING_LEFT
        : 0;
      const column = findClosestTextColumn(line.text, targetWidth, (prefix) =>
        measureTextWidth(prefix, fontSize, fontFamily, tabSize),
      );
      onOpenLocation({ line: lineIndex, column });
    },
    [fontFamily, fontSize, line.text, lineIndex, onOpenLocation, tabSize],
  );

  if (mappedLine === null || mappedLine === undefined) {
    return <div className="flex min-w-0 text-text-lighter">{content}</div>;
  }

  return (
    <button
      type="button"
      className="flex w-full min-w-0 text-left hover:bg-hover/25 focus-visible:bg-hover/35 focus-visible:outline-none"
      onClick={handleClick}
      aria-label={`Open line ${mappedLine}`}
    >
      {content}
    </button>
  );
});

export const SearchExcerptCode = memo(function SearchExcerptCode({
  excerpt,
  selectedHighlightIndexes,
  shouldHighlightSyntax,
  typography,
  onOpenLocation,
}: SearchExcerptCodeProps) {
  const { fontSize, fontFamily, lineHeight, tabSize, showLineNumbers } = typography;
  const tokens = useSearchExcerptTokens({
    filePath: excerpt.filePath,
    content: excerpt.content,
    enabled: shouldHighlightSyntax,
  });
  const lines = useMemo(
    () => buildSearchExcerptRenderLines(excerpt.content, tokens, excerpt.highlights),
    [excerpt.content, excerpt.highlights, tokens],
  );
  const gutterWidth = useMemo(() => {
    const largestMappedLine = excerpt.lineNumberMap.reduce<number>(
      (largest, lineNumber) =>
        typeof lineNumber === "number" ? Math.max(largest, lineNumber) : largest,
      0,
    );
    return calculateTotalGutterWidth(Math.max(lines.length, largestMappedLine));
  }, [excerpt.lineNumberMap, lines.length]);
  const surfaceStyle = useMemo(
    () => ({
      minHeight: "104px",
      fontSize: `${fontSize}px`,
      fontFamily,
      lineHeight: `${lineHeight}px`,
      tabSize,
    }),
    [fontFamily, fontSize, lineHeight, tabSize],
  );

  return (
    <div
      className="font-mono code-editor-font-override overflow-hidden border-border border-t bg-primary-bg py-2"
      style={surfaceStyle}
    >
      {lines.map((line, lineIndex) => (
        <SearchExcerptLine
          key={`${lineIndex}-${excerpt.lineNumberMap[lineIndex] ?? "gap"}`}
          line={line}
          lineIndex={lineIndex}
          mappedLine={excerpt.lineNumberMap[lineIndex]}
          gutterWidth={gutterWidth}
          selectedHighlightIndexes={selectedHighlightIndexes}
          fontSize={fontSize}
          fontFamily={fontFamily}
          tabSize={tabSize}
          showLineNumbers={showLineNumbers}
          onOpenLocation={onOpenLocation}
        />
      ))}
    </div>
  );
});
