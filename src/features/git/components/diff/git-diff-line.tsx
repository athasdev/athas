import { memo, useMemo } from "react";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { cn } from "@/utils/cn";
import type { DiffLineProps } from "../../types/git-diff-types";

export const getLineBackground = (type: string) => {
  switch (type) {
    case "added":
      return "bg-git-added/15";
    case "removed":
      return "bg-git-deleted/15";
    default:
      return "";
  }
};

export const getGutterBackground = (type: string) => {
  switch (type) {
    case "added":
      return "bg-git-added/25";
    case "removed":
      return "bg-git-deleted/25";
    default:
      return "bg-primary-bg";
  }
};

export const getContentColor = (type: string) => {
  switch (type) {
    case "added":
      return "text-git-added";
    case "removed":
      return "text-git-deleted";
    default:
      return "text-text";
  }
};

const renderWhitespace = (content: string, showWhitespace: boolean) => {
  if (!showWhitespace) return content;

  return content.split("").map((char, i) => {
    if (char === " ") {
      return (
        <span key={i} className="text-text-lighter opacity-30">
          ·
        </span>
      );
    }
    if (char === "\t") {
      return (
        <span key={i} className="text-text-lighter opacity-30">
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
) => {
  if (!tokens || tokens.length === 0) {
    return <span>{renderWhitespace(content, showWhitespace)}</span>;
  }

  const result: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const [tokenIndex, token] of tokens.entries()) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    if (start > lastEnd) {
      const text = content.slice(lastEnd, start);
      result.push(
        <span key={`plain-${lastEnd}-${tokenIndex}`}>
          {renderWhitespace(text, showWhitespace)}
        </span>,
      );
    }

    const tokenText = content.slice(start, end);
    const scopeClass = token.type;

    result.push(
      <span key={`token-${start}-${end}-${tokenIndex}`} className={scopeClass}>
        {renderWhitespace(tokenText, showWhitespace)}
      </span>,
    );

    lastEnd = end;
  }

  if (lastEnd < content.length) {
    const text = content.slice(lastEnd);
    result.push(
      <span key={`plain-tail-${lastEnd}`}>{renderWhitespace(text, showWhitespace)}</span>,
    );
  }

  return <>{result}</>;
};

export function renderDiffLineContent(
  content: string,
  tokens: HighlightToken[] | undefined,
  showWhitespace: boolean,
) {
  return renderHighlightedContent(content, tokens, showWhitespace);
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
      return renderHighlightedContent(line.content, tokens, showWhitespace);
    }, [line.content, tokens, showWhitespace]);

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
        <div className={cn("flex min-w-max", getLineBackground(diffType))} style={rowStyle}>
          <div
            className={cn(
              "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
              "editor-font code-editor-font-override text-text-lighter tabular-nums",
              getGutterBackground(diffType),
            )}
            style={gutterStyle}
          >
            {isVisible ? gutterNumber : ""}
          </div>
          <div
            className={cn(
              "editor-font code-editor-font-override m-0 min-w-0 flex-1 px-2.5 py-0.5 antialiased",
              diffType === "added"
                ? getContentColor("added")
                : diffType === "removed"
                  ? getContentColor("removed")
                  : "text-text",
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
        <div className="flex min-w-0 w-full" style={rowStyle}>
          <div
            className={cn(
              "flex min-h-0 min-w-0 basis-1/2 overflow-hidden border-border border-r",
              line.line_type === "removed" ? getLineBackground("removed") : "",
            )}
          >
            <div
              className={cn(
                "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
                "editor-font code-editor-font-override text-text-lighter tabular-nums",
                getGutterBackground(line.line_type === "removed" ? "removed" : ""),
              )}
              style={gutterStyle}
            >
              {line.line_type !== "added" ? line.old_line_number : ""}
            </div>
            <div
              className={cn(
                "editor-font code-editor-font-override m-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2.5 py-0.5 antialiased",
                line.line_type === "removed" ? getContentColor("removed") : "text-text",
              )}
              style={contentStyle}
            >
              {line.line_type !== "added" ? lineContent : ""}
            </div>
          </div>

          <div
            className={cn(
              "flex min-h-0 min-w-0 basis-1/2 overflow-hidden",
              line.line_type === "added" ? getLineBackground("added") : "",
            )}
          >
            <div
              className={cn(
                "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
                "editor-font code-editor-font-override text-text-lighter tabular-nums",
                getGutterBackground(line.line_type === "added" ? "added" : ""),
              )}
              style={gutterStyle}
            >
              {line.line_type !== "removed" ? line.new_line_number : ""}
            </div>
            <div
              className={cn(
                "editor-font code-editor-font-override m-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2.5 py-0.5 antialiased",
                line.line_type === "added" ? getContentColor("added") : "text-text",
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
        className={cn("flex min-w-full w-fit", getLineBackground(line.line_type))}
        style={rowStyle}
      >
        <div
          className={cn(
            "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
            "editor-font code-editor-font-override text-text-lighter tabular-nums",
            getGutterBackground(line.line_type),
          )}
          style={gutterStyle}
        >
          {line.old_line_number}
        </div>
        <div
          className={cn(
            "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right",
            "editor-font code-editor-font-override text-text-lighter tabular-nums",
            getGutterBackground(line.line_type),
          )}
          style={gutterStyle}
        >
          {line.new_line_number}
        </div>

        <div
          className={cn(
            "editor-font code-editor-font-override m-0 min-w-0 flex-1 px-2.5 py-0.5 antialiased",
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
