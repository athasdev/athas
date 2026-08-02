import { memo, useMemo } from "react";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { cn } from "@/utils/cn";
import type { DiffLineProps, DiffSearchHighlight } from "../../types/git-diff.types";
import { getDiffLineVisualState, getDiffLineVisualType } from "../../utils/git-diff-helpers";

export const getLineBackground = (type: string) => {
  return getDiffLineVisualState(getDiffLineVisualType(type as DiffLineProps["line"]["line_type"]))
    .lineBackground;
};

export const getGutterBackground = (type: string) => {
  return getDiffLineVisualState(getDiffLineVisualType(type as DiffLineProps["line"]["line_type"]))
    .gutterBackground;
};

export const getRailClassName = (type: string) => {
  return getDiffLineVisualState(getDiffLineVisualType(type as DiffLineProps["line"]["line_type"]))
    .railClassName;
};

export const getGutterTextColor = (type: string) => {
  return getDiffLineVisualState(getDiffLineVisualType(type as DiffLineProps["line"]["line_type"]))
    .gutterTextColor;
};

export const getContentColor = (type: string) => {
  return getDiffLineVisualState(getDiffLineVisualType(type as DiffLineProps["line"]["line_type"]))
    .contentColor;
};

const renderWhitespace = (content: string, showWhitespace: boolean) => {
  if (!showWhitespace) return content;

  return content.split("").map((char, i) => {
    if (char === " ") {
      return (
        <span key={i} className="text-subtle-foreground opacity-30">
          ·
        </span>
      );
    }
    if (char === "\t") {
      return (
        <span key={i} className="text-subtle-foreground opacity-30">
          →{"   "}
        </span>
      );
    }
    return char;
  });
};

const renderHighlightedContent = (
  content: string,
  tokens: HighlightToken[] | undefined,
  showWhitespace: boolean,
  searchHighlights: DiffSearchHighlight[] = [],
) => {
  const renderSegment = (
    start: number,
    end: number,
    key: string,
    className?: string,
  ): React.ReactNode => {
    const matchingRanges = searchHighlights.filter(
      (highlight) => highlight.end > start && highlight.start < end,
    );

    if (matchingRanges.length === 0) {
      return (
        <span key={key} className={className}>
          {renderWhitespace(content.slice(start, end), showWhitespace)}
        </span>
      );
    }

    const parts: React.ReactNode[] = [];
    let cursor = start;

    for (const [rangeIndex, highlight] of matchingRanges.entries()) {
      const highlightStart = Math.max(start, highlight.start);
      const highlightEnd = Math.min(end, highlight.end);

      if (highlightStart > cursor) {
        parts.push(
          <span key={`${key}-plain-${cursor}`}>
            {renderWhitespace(content.slice(cursor, highlightStart), showWhitespace)}
          </span>,
        );
      }

      parts.push(
        <mark
          key={`${key}-match-${rangeIndex}-${highlightStart}`}
          className={cn(
            "rounded-sm bg-primary/25 text-inherit",
            highlight.isCurrent && "bg-primary/55 outline outline-1 outline-primary/70",
          )}
        >
          {renderWhitespace(content.slice(highlightStart, highlightEnd), showWhitespace)}
        </mark>,
      );
      cursor = Math.max(cursor, highlightEnd);
    }

    if (cursor < end) {
      parts.push(
        <span key={`${key}-tail-${cursor}`}>
          {renderWhitespace(content.slice(cursor, end), showWhitespace)}
        </span>,
      );
    }

    return (
      <span key={key} className={className}>
        {parts}
      </span>
    );
  };

  if (!tokens || tokens.length === 0) {
    return renderSegment(0, content.length, "plain");
  }

  const result: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const [tokenIndex, token] of tokens.entries()) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    if (start > lastEnd) {
      result.push(renderSegment(lastEnd, start, `plain-${lastEnd}-${tokenIndex}`));
    }

    result.push(renderSegment(start, end, `token-${start}-${end}-${tokenIndex}`, token.type));

    lastEnd = end;
  }

  if (lastEnd < content.length) {
    result.push(renderSegment(lastEnd, content.length, `plain-tail-${lastEnd}`));
  }

  return <>{result}</>;
};

export function renderDiffLineContent(
  content: string,
  tokens: HighlightToken[] | undefined,
  showWhitespace: boolean,
  searchHighlights?: DiffSearchHighlight[],
) {
  return renderHighlightedContent(content, tokens, showWhitespace, searchHighlights);
}

export function getSplitLineMeta(line: DiffLineProps["line"], splitSide: "left" | "right") {
  const isLeft = splitSide === "left";
  const isVisible = isLeft ? line.line_type !== "added" : line.line_type !== "removed";
  const gutterNumber = isLeft ? line.old_line_number : line.new_line_number;
  const diffType = isLeft
    ? line.line_type === "removed"
      ? "removed"
      : "context"
    : line.line_type === "added"
      ? "added"
      : "context";

  return {
    isVisible,
    gutterNumber,
    diffType,
  };
}

function getUnifiedLineGutterLabel(line: DiffLineProps["line"]) {
  if (line.line_type === "removed") return "-";
  return line.new_line_number ?? line.old_line_number ?? "";
}

const DiffLine = memo(
  ({
    line,
    viewMode,
    splitSide,
    wordWrap,
    showWhitespace,
    tokens,
    fontSize,
    lineHeight,
    tabSize,
    searchHighlights,
    searchLineIndex,
  }: DiffLineProps) => {
    const rowStyle = { minHeight: `${lineHeight}px` };
    const gutterStyle = { fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` };
    const contentStyle = {
      fontSize: `${fontSize}px`,
      lineHeight: `${lineHeight}px`,
      tabSize,
      whiteSpace: wordWrap ? ("pre-wrap" as const) : ("pre" as const),
      overflowWrap: wordWrap ? ("anywhere" as const) : ("normal" as const),
      wordBreak: wordWrap ? ("break-word" as const) : ("normal" as const),
    };

    const lineContent = useMemo(() => {
      return renderHighlightedContent(line.content, tokens, showWhitespace, searchHighlights);
    }, [line.content, searchHighlights, tokens, showWhitespace]);

    if (viewMode === "split" && splitSide) {
      const isLeft = splitSide === "left";
      const isVisible = isLeft ? line.line_type !== "added" : line.line_type !== "removed";
      const gutterNumber = isLeft ? line.old_line_number : line.new_line_number;
      const diffType = isLeft
        ? line.line_type === "removed"
          ? "removed"
          : "context"
        : line.line_type === "added"
          ? "added"
          : "context";

      return (
        <div
          className={cn("flex min-w-max", getLineBackground(diffType), getRailClassName(diffType))}
          style={rowStyle}
          data-diff-search-line={searchLineIndex}
        >
          <div
            className={cn(
              "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
              "font-mono code-editor-font-override tabular-nums",
              getGutterBackground(diffType),
              getGutterTextColor(diffType),
            )}
            style={gutterStyle}
            data-selection-scope-exclude="true"
          >
            {isVisible ? gutterNumber : ""}
          </div>
          <div
            className={cn(
              "font-mono code-editor-font-override m-0 min-w-0 flex-1 px-2.5 py-0.5 antialiased",
              diffType === "added"
                ? getContentColor("added")
                : diffType === "removed"
                  ? getContentColor("removed")
                  : "text-foreground",
            )}
            style={contentStyle}
          >
            {isVisible ? lineContent : ""}
          </div>
        </div>
      );
    }

    if (viewMode === "split") {
      return (
        <div
          className="flex min-w-0 w-full"
          style={rowStyle}
          data-diff-search-line={searchLineIndex}
        >
          <div
            className={cn(
              "flex min-h-0 min-w-0 basis-1/2 overflow-hidden border-border border-r",
              line.line_type === "removed"
                ? cn(getLineBackground("removed"), getRailClassName("removed"))
                : "",
            )}
          >
            <div
              className={cn(
                "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
                "font-mono code-editor-font-override tabular-nums",
                getGutterBackground(line.line_type === "removed" ? "removed" : ""),
                getGutterTextColor(line.line_type === "removed" ? "removed" : ""),
              )}
              style={gutterStyle}
              data-selection-scope-exclude="true"
            >
              {line.line_type !== "added" ? line.old_line_number : ""}
            </div>
            <div
              className={cn(
                "font-mono code-editor-font-override m-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2.5 py-0.5 antialiased",
                line.line_type === "removed" ? getContentColor("removed") : "text-foreground",
              )}
              style={contentStyle}
            >
              {line.line_type !== "added" ? lineContent : ""}
            </div>
          </div>

          <div
            className={cn(
              "flex min-h-0 min-w-0 basis-1/2 overflow-hidden",
              line.line_type === "added"
                ? cn(getLineBackground("added"), getRailClassName("added"))
                : "",
            )}
          >
            <div
              className={cn(
                "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
                "font-mono code-editor-font-override tabular-nums",
                getGutterBackground(line.line_type === "added" ? "added" : ""),
                getGutterTextColor(line.line_type === "added" ? "added" : ""),
              )}
              style={gutterStyle}
              data-selection-scope-exclude="true"
            >
              {line.line_type !== "removed" ? line.new_line_number : ""}
            </div>
            <div
              className={cn(
                "font-mono code-editor-font-override m-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2.5 py-0.5 antialiased",
                line.line_type === "added" ? getContentColor("added") : "text-foreground",
              )}
              style={contentStyle}
            >
              {line.line_type !== "removed" ? lineContent : ""}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "flex min-w-full w-fit",
          getLineBackground(line.line_type),
          getRailClassName(line.line_type),
        )}
        style={rowStyle}
        data-diff-search-line={searchLineIndex}
      >
        <div
          className={cn(
            "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
            "font-mono code-editor-font-override tabular-nums",
            getGutterBackground(line.line_type),
            getGutterTextColor(line.line_type),
          )}
          style={gutterStyle}
          data-selection-scope-exclude="true"
        >
          {getUnifiedLineGutterLabel(line)}
        </div>

        <div
          className={cn(
            "font-mono code-editor-font-override m-0 min-w-0 flex-1 px-2.5 py-0.5 antialiased",
            getContentColor(line.line_type),
          )}
          style={contentStyle}
        >
          {lineContent}
        </div>
      </div>
    );
  },
);

DiffLine.displayName = "DiffLine";

export default DiffLine;
