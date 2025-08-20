import type React from "react";
import { memo } from "react";
import type { Decoration, LineToken } from "@/types/editor-types";
import { cn } from "@/utils/cn";

interface LineRendererProps {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
  decorations: Decoration[];
  isSelected?: boolean;
  searchHighlight?: { start: number; end: number }[];
}

// Memoized line renderer for performance
const LineRendererInternal = ({
  lineNumber,
  content,
  tokens,
  decorations,
  isSelected = false,
  searchHighlight = [],
}: LineRendererProps) => {
  const renderTokenizedContent = () => {
    if (!tokens || tokens.length === 0) {
      return <span>{content || "\u00A0"}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    const sortedTokens = [...tokens].sort((a, b) => a.startColumn - b.startColumn);

    sortedTokens.forEach((token, index) => {
      if (token.startColumn > lastEnd) {
        elements.push(
          <span key={`text-${index}`}>{content.slice(lastEnd, token.startColumn)}</span>,
        );
      }

      const tokenContent = content.slice(token.startColumn, token.endColumn);
      elements.push(
        <span key={`token-${index}`} className={token.className}>
          {tokenContent}
        </span>,
      );

      lastEnd = token.endColumn;
    });

    if (lastEnd < content.length) {
      elements.push(<span key="text-end">{content.slice(lastEnd)}</span>);
    }

    if (elements.length === 0 && content.length === 0) {
      elements.push(<span key="empty">{"\u00A0"}</span>);
    }

    return <>{elements}</>;
  };

  const applyDecorations = (baseContent: React.ReactNode) => {
    const inlineDecorations = decorations.filter(
      (d) => d.type === "inline" && d.range.start.line === lineNumber,
    );

    if (inlineDecorations.length === 0 && searchHighlight.length === 0) {
      return baseContent;
    }

    // Convert React elements back to string for processing
    const textContent = content;
    if (!textContent) return baseContent;

    // Collect all highlights to apply
    const highlights: Array<{ start: number; end: number; className: string }> = [];

    // Add decoration highlights
    inlineDecorations.forEach((decoration) => {
      highlights.push({
        start: decoration.range.start.column,
        end: decoration.range.end.column,
        className: decoration.className || "",
      });
    });

    // Add search highlights
    searchHighlight.forEach((highlight) => {
      highlights.push({
        start: highlight.start,
        end: highlight.end,
        className: "search-highlight",
      });
    });

    // If no highlights, return original content
    if (highlights.length === 0) {
      return baseContent;
    }

    // Sort highlights by start position
    highlights.sort((a, b) => a.start - b.start);

    // Apply highlights to text
    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    highlights.forEach((highlight, index) => {
      const start = Math.max(0, highlight.start);
      const end = Math.min(textContent.length, highlight.end);

      // Add text before highlight
      if (start > lastEnd) {
        elements.push(<span key={`text-${index}`}>{textContent.slice(lastEnd, start)}</span>);
      }

      // Add highlighted text
      if (end > start) {
        elements.push(
          <span key={`highlight-${index}`} className={highlight.className}>
            {textContent.slice(start, end)}
          </span>,
        );
      }

      lastEnd = Math.max(lastEnd, end);
    });

    // Add remaining text
    if (lastEnd < textContent.length) {
      elements.push(<span key="text-end">{textContent.slice(lastEnd)}</span>);
    }

    // If no elements were created, return original content
    if (elements.length === 0) {
      return baseContent;
    }

    return <>{elements}</>;
  };

  return (
    <div className={cn("editor-line", isSelected && "selected")} data-line-number={lineNumber}>
      <span className="editor-line-content">{applyDecorations(renderTokenizedContent())}</span>
    </div>
  );
};

// Export memoized version for performance
export const LineRenderer = memo(LineRendererInternal, (prevProps, nextProps) => {
  // Custom comparison for optimal re-rendering
  return (
    prevProps.lineNumber === nextProps.lineNumber &&
    prevProps.content === nextProps.content &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.tokens.length === nextProps.tokens.length &&
    prevProps.decorations.length === nextProps.decorations.length &&
    (prevProps.searchHighlight?.length || 0) === (nextProps.searchHighlight?.length || 0)
  );
});
