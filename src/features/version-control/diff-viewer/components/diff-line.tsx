import { Copy } from "lucide-react";
import { memo, type ReactNode } from "react";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { cn } from "@/utils/cn";
import { copyLineContent } from "../controllers/diff-helpers";
import type { DiffLineProps } from "../types/diff";

/**
 * Visualize whitespace characters in text
 */
function visualizeWhitespace(text: string, keyPrefix: string): ReactNode[] {
  return text.split("").map((char, i) => {
    if (char === " ") {
      return (
        <span key={`${keyPrefix}-${i}`} className="text-text-lighter/50">
          ·
        </span>
      );
    }
    if (char === "\t") {
      return (
        <span key={`${keyPrefix}-${i}`} className="text-text-lighter/50">
          →
        </span>
      );
    }
    if (char === "\r" || char === "\n") {
      return (
        <span key={`${keyPrefix}-${i}`} className="text-text-lighter/50">
          ↵
        </span>
      );
    }
    return char;
  });
}

/**
 * Render content with syntax highlighting tokens
 */
function renderTokenizedContent(
  content: string,
  tokens: HighlightToken[],
  showWhitespace: boolean,
): ReactNode[] {
  if (!content || tokens.length === 0) {
    return showWhitespace ? visualizeWhitespace(content, "plain") : [content];
  }

  // Sort tokens by start position, then by size (smaller/more specific first)
  const sortedTokens = [...tokens].sort((a, b) => {
    const startDiff = a.startPosition.column - b.startPosition.column;
    if (startDiff !== 0) return startDiff;
    // For same start, prefer smaller (more specific) tokens
    const aSize = a.endPosition.column - a.startPosition.column;
    const bSize = b.endPosition.column - b.startPosition.column;
    return aSize - bSize;
  });

  const result: ReactNode[] = [];
  let currentPos = 0;

  for (const token of sortedTokens) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    // Skip tokens that are out of bounds or already covered
    if (start >= content.length) continue;
    if (start < currentPos) continue; // Skip overlapping tokens

    // Add plain text before this token
    if (start > currentPos) {
      const plainText = content.slice(currentPos, start);
      if (showWhitespace) {
        result.push(...visualizeWhitespace(plainText, `pre-${start}`));
      } else {
        result.push(plainText);
      }
    }

    // Add the tokenized text
    const tokenEnd = Math.min(end, content.length);
    if (tokenEnd > start) {
      const tokenText = content.slice(start, tokenEnd);
      const tokenContent = showWhitespace
        ? visualizeWhitespace(tokenText, `tok-${start}`)
        : tokenText;

      // Skip wrapping for token-text as it should inherit parent color
      if (token.type === "token-text") {
        result.push(tokenContent);
      } else {
        result.push(
          <span key={`${start}-${tokenEnd}`} className={token.type}>
            {tokenContent}
          </span>,
        );
      }
    }

    currentPos = Math.max(currentPos, tokenEnd);
  }

  // Add remaining plain text
  if (currentPos < content.length) {
    const remaining = content.slice(currentPos);
    if (showWhitespace) {
      result.push(...visualizeWhitespace(remaining, "post"));
    } else {
      result.push(remaining);
    }
  }

  return result;
}

export const DiffLine = memo(function DiffLine({
  line,
  index,
  hunkId,
  viewMode,
  showWhitespace,
  tokens,
}: DiffLineProps) {
  const renderTextContent = (content: string) => {
    if (!content) return " ";

    // Use syntax highlighting tokens if available, with optional whitespace visualization
    if (tokens && tokens.length > 0) {
      return (
        <span className="whitespace-pre-wrap">
          {renderTokenizedContent(content, tokens, showWhitespace)}
        </span>
      );
    }

    // No tokens - just handle whitespace visualization
    if (showWhitespace) {
      return <span className="whitespace-pre-wrap">{visualizeWhitespace(content, "plain")}</span>;
    }

    // Fallback: preserve original whitespace without highlighting
    return <span className="whitespace-pre-wrap">{content}</span>;
  };

  const getLineClasses = () => {
    const base = "group hover:bg-hover/50 transition-colors border-l-2";
    switch (line.line_type) {
      case "added":
        return cn(base, "bg-green-500/5 border-green-500/30 hover:bg-green-500/10");
      case "removed":
        return cn(base, "bg-red-500/5 border-red-500/30 hover:bg-red-500/10");
      default:
        return cn(base, "border-transparent");
    }
  };

  const getLineNumberBg = () => {
    switch (line.line_type) {
      case "added":
        return "bg-green-500/10";
      case "removed":
        return "bg-red-500/10";
      default:
        return "bg-secondary-bg";
    }
  };

  const oldNum = line.old_line_number?.toString() || "";
  const newNum = line.new_line_number?.toString() || "";

  const renderContent = (content: string, bgClassName: string, textClassName: string) => {
    // Always apply text-text as base color for gaps between tokens, override with textClassName if no tokens
    const hasTokens = tokens && tokens.length > 0;
    const className = cn(bgClassName, hasTokens ? "text-text" : textClassName);
    return <span className={className}>{renderTextContent(content || " ")}</span>;
  };

  if (viewMode === "split") {
    return (
      <div key={`${hunkId}-${index}`} className={cn("flex font-mono text-xs", getLineClasses())}>
        {/* Old/Left Side */}
        <div className="flex flex-1 border-border border-r">
          {/* Old Line Number */}
          <div
            className={cn(
              "w-12 select-none px-2 py-1 text-right text-text-lighter",
              getLineNumberBg(),
              "border-border border-r",
            )}
          >
            {line.line_type !== "added" ? oldNum : ""}
          </div>

          {/* Old Content */}
          <div className="flex-1 overflow-x-auto px-3 py-1">
            {line.line_type === "removed" ? (
              renderContent(line.content, "bg-red-500/10", "text-red-300")
            ) : line.line_type === "context" ? (
              renderContent(line.content, "", "text-text")
            ) : (
              <span className="select-none text-transparent">&nbsp;</span>
            )}
          </div>
        </div>

        {/* New/Right Side */}
        <div className="flex flex-1">
          {/* New Line Number */}
          <div
            className={cn(
              "w-12 select-none px-2 py-1 text-right text-text-lighter",
              getLineNumberBg(),
              "border-border border-r",
            )}
          >
            {line.line_type !== "removed" ? newNum : ""}
          </div>

          {/* New Content */}
          <div className="flex-1 overflow-x-auto px-3 py-1">
            {line.line_type === "added" ? (
              renderContent(line.content, "bg-green-500/10", "text-green-300")
            ) : line.line_type === "context" ? (
              renderContent(line.content, "", "text-text")
            ) : (
              <span className="select-none text-transparent">&nbsp;</span>
            )}
          </div>

          {/* Actions */}
          <div
            className={cn(
              "flex items-center gap-1 px-2 opacity-0",
              "transition-opacity group-hover:opacity-100",
            )}
          >
            <button
              onClick={() => copyLineContent(line.content)}
              className={cn(
                "rounded p-1 text-text-lighter transition-colors",
                "hover:bg-hover hover:text-text",
              )}
              title="Copy line"
            >
              <Copy size={10} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Unified view
  return (
    <div key={`${hunkId}-${index}`} className={cn("flex font-mono text-xs", getLineClasses())}>
      {/* Line Numbers */}
      <div className={cn("flex", getLineNumberBg(), "border-border border-r")}>
        <div className="w-12 select-none px-2 py-1 text-right text-text-lighter">{oldNum}</div>
        <div
          className={cn(
            "w-12 select-none border-border border-l px-2 py-1",
            "text-right text-text-lighter",
          )}
        >
          {newNum}
        </div>
      </div>

      {/* Change Indicator */}
      <div
        className={cn(
          "flex w-8 items-center justify-center border-border",
          "border-r bg-secondary-bg py-1",
        )}
      >
        {line.line_type === "added" && <span className="font-bold text-green-500 text-sm">+</span>}
        {line.line_type === "removed" && <span className="font-bold text-red-500 text-sm">−</span>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-x-auto px-3 py-1">
        {renderContent(
          line.content,
          "",
          line.line_type === "added"
            ? "text-green-300"
            : line.line_type === "removed"
              ? "text-red-300"
              : "text-text",
        )}
      </div>

      {/* Actions */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 opacity-0",
          "transition-opacity group-hover:opacity-100",
        )}
      >
        <button
          onClick={() => copyLineContent(line.content)}
          className={cn(
            "rounded p-1 text-text-lighter transition-colors",
            "hover:bg-hover hover:text-text",
          )}
          title="Copy line"
        >
          <Copy size={10} />
        </button>
      </div>
    </div>
  );
});
