import { memo, useMemo } from "react";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { cn } from "@/utils/cn";
import type { DiffLineProps } from "../../types/git-diff-types";

const getLineBackground = (type: string) => {
  switch (type) {
    case "added":
      return "bg-git-added/15";
    case "removed":
      return "bg-git-deleted/15";
    default:
      return "";
  }
};

const getGutterBackground = (type: string) => {
  switch (type) {
    case "added":
      return "bg-git-added/25";
    case "removed":
      return "bg-git-deleted/25";
    default:
      return "bg-primary-bg";
  }
};

const getContentColor = (type: string) => {
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

  for (const token of tokens) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    if (start > lastEnd) {
      const text = content.slice(lastEnd, start);
      result.push(<span key={`plain-${lastEnd}`}>{renderWhitespace(text, showWhitespace)}</span>);
    }

    const tokenText = content.slice(start, end);
    const scopeClass = token.type;

    result.push(
      <span key={`token-${start}`} className={scopeClass}>
        {renderWhitespace(tokenText, showWhitespace)}
      </span>,
    );

    lastEnd = end;
  }

  if (lastEnd < content.length) {
    const text = content.slice(lastEnd);
    result.push(<span key={`plain-${lastEnd}`}>{renderWhitespace(text, showWhitespace)}</span>);
  }

  return <>{result}</>;
};

const DiffLine = memo(
  ({ line, viewMode, showWhitespace, tokens, fontSize, lineHeight, tabSize }: DiffLineProps) => {
    const rowStyle = { height: `${lineHeight}px` };
    const gutterStyle = { fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` };
    const contentStyle = {
      fontSize: `${fontSize}px`,
      lineHeight: `${lineHeight}px`,
      tabSize,
    };

    const lineContent = useMemo(() => {
      return renderHighlightedContent(line.content, tokens, showWhitespace);
    }, [line.content, tokens, showWhitespace]);

    if (viewMode === "split") {
      return (
        <div className="flex" style={rowStyle}>
          <div
            className={cn(
              "flex w-1/2 border-border border-r",
              line.line_type === "removed" ? getLineBackground("removed") : "",
            )}
          >
            <div
              className={cn(
                "w-10 shrink-0 select-none border-border border-r px-2 text-right",
                "editor-font text-text-lighter tabular-nums",
                getGutterBackground(line.line_type === "removed" ? "removed" : ""),
              )}
              style={gutterStyle}
            >
              {line.line_type !== "added" ? line.old_line_number : ""}
            </div>
            <div
              className={cn(
                "editor-font m-0 flex-1 whitespace-pre px-2",
                line.line_type === "removed" ? getContentColor("removed") : "text-text",
              )}
              style={contentStyle}
            >
              {line.line_type !== "added" ? lineContent : ""}
            </div>
          </div>

          <div
            className={cn(
              "flex w-1/2",
              line.line_type === "added" ? getLineBackground("added") : "",
            )}
          >
            <div
              className={cn(
                "w-10 shrink-0 select-none border-border border-r px-2 text-right",
                "editor-font text-text-lighter tabular-nums",
                getGutterBackground(line.line_type === "added" ? "added" : ""),
              )}
              style={gutterStyle}
            >
              {line.line_type !== "removed" ? line.new_line_number : ""}
            </div>
            <div
              className={cn(
                "editor-font m-0 flex-1 whitespace-pre px-2",
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
      <div className={cn("flex", getLineBackground(line.line_type))} style={rowStyle}>
        <div
          className={cn(
            "w-10 shrink-0 select-none border-border border-r px-2 text-right",
            "editor-font text-text-lighter tabular-nums",
            getGutterBackground(line.line_type),
          )}
          style={gutterStyle}
        >
          {line.old_line_number}
        </div>
        <div
          className={cn(
            "w-10 shrink-0 select-none border-border border-r px-2 text-right",
            "editor-font text-text-lighter tabular-nums",
            getGutterBackground(line.line_type),
          )}
          style={gutterStyle}
        >
          {line.new_line_number}
        </div>

        <div
          className={cn(
            "editor-font m-0 flex-1 whitespace-pre px-2",
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
