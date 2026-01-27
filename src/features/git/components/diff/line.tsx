import { memo, useMemo } from "react";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { cn } from "@/utils/cn";
import type { DiffLineProps } from "../../types/diff";

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
    const scopeClass = token.type
      ?.split(".")
      .map((s: string) => `syntax-${s}`)
      .join(" ");

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

const DiffLine = memo(({ line, viewMode, showWhitespace, tokens }: DiffLineProps) => {
  const lineContent = useMemo(() => {
    return renderHighlightedContent(line.content, tokens, showWhitespace);
  }, [line.content, tokens, showWhitespace]);

  if (viewMode === "split") {
    return (
      <div className="flex min-h-[1.4em]">
        <div
          className={cn(
            "flex w-1/2 border-border border-r",
            line.line_type === "removed" ? getLineBackground("removed") : "",
          )}
        >
          <div
            className={cn(
              "w-10 shrink-0 select-none border-border border-r px-2 text-right",
              "editor-font text-text-lighter text-xs",
              getGutterBackground(line.line_type === "removed" ? "removed" : ""),
            )}
          >
            {line.line_type !== "added" ? line.old_line_number : ""}
          </div>
          <pre
            className={cn(
              "editor-font flex-1 whitespace-pre-wrap px-2 text-xs",
              line.line_type === "removed" ? getContentColor("removed") : "text-text",
            )}
          >
            {line.line_type !== "added" ? lineContent : ""}
          </pre>
        </div>

        <div
          className={cn("flex w-1/2", line.line_type === "added" ? getLineBackground("added") : "")}
        >
          <div
            className={cn(
              "w-10 shrink-0 select-none border-border border-r px-2 text-right",
              "editor-font text-text-lighter text-xs",
              getGutterBackground(line.line_type === "added" ? "added" : ""),
            )}
          >
            {line.line_type !== "removed" ? line.new_line_number : ""}
          </div>
          <pre
            className={cn(
              "editor-font flex-1 whitespace-pre-wrap px-2 text-xs",
              line.line_type === "added" ? getContentColor("added") : "text-text",
            )}
          >
            {line.line_type !== "removed" ? lineContent : ""}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-[1.4em]", getLineBackground(line.line_type))}>
      <div
        className={cn(
          "w-10 shrink-0 select-none border-border border-r px-2 text-right",
          "editor-font text-text-lighter text-xs",
          getGutterBackground(line.line_type),
        )}
      >
        {line.old_line_number}
      </div>
      <div
        className={cn(
          "w-10 shrink-0 select-none border-border border-r px-2 text-right",
          "editor-font text-text-lighter text-xs",
          getGutterBackground(line.line_type),
        )}
      >
        {line.new_line_number}
      </div>
      <div
        className={cn(
          "w-4 shrink-0 select-none text-center",
          "editor-font text-xs",
          line.line_type === "added" && "text-git-added",
          line.line_type === "removed" && "text-git-deleted",
        )}
      >
        {line.line_type === "added" ? "+" : line.line_type === "removed" ? "-" : " "}
      </div>
      <pre
        className={cn(
          "editor-font flex-1 whitespace-pre-wrap px-2 text-xs",
          getContentColor(line.line_type),
        )}
      >
        {lineContent}
      </pre>
    </div>
  );
});

DiffLine.displayName = "DiffLine";

export default DiffLine;
