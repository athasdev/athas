import { Copy } from "lucide-react";
import { memo } from "react";
import { cn } from "@/utils/cn";
import { copyLineContent } from "./utils/diff-helpers";
import type { DiffLineProps } from "./utils/types";

export const DiffLine = memo(function DiffLine({
  line,
  index,
  hunkId,
  viewMode,
  showWhitespace,
}: DiffLineProps) {
  const renderTextContent = (content: string) => {
    if (!content) return " ";

    if (showWhitespace) {
      // When showWhitespace is true, replace whitespace with visual indicators
      const processedContent = content.split("").map((char, index) => {
        if (char === " ") {
          return (
            <span key={index} className="text-text-lighter/50">
              ·
            </span>
          );
        } else if (char === "\t") {
          return (
            <span key={index} className="text-text-lighter/50">
              →
            </span>
          );
        } else if (char === "\r") {
          return (
            <span key={index} className="text-text-lighter/50">
              ↵
            </span>
          );
        } else if (char === "\n") {
          return (
            <span key={index} className="text-text-lighter/50">
              ↵
            </span>
          );
        } else {
          return char;
        }
      });

      return <span className="whitespace-pre-wrap">{processedContent}</span>;
    }

    // When showWhitespace is false, preserve original whitespace
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

  const renderContent = (content: string, className: string) => (
    <span className={className}>{renderTextContent(content || " ")}</span>
  );

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
              renderContent(line.content, "bg-red-500/10 text-red-300")
            ) : line.line_type === "context" ? (
              renderContent(line.content, "text-text")
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
              renderContent(line.content, "bg-green-500/10 text-green-300")
            ) : line.line_type === "context" ? (
              renderContent(line.content, "text-text")
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
