import type React from "react";
import { memo } from "react";
import type { Decoration, LineToken } from "@/features/editor/types/editor";

interface LineRendererProps {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
  decorations: Decoration[];
  searchHighlight?: { start: number; end: number }[];
}

// Memoized line renderer for performance
const LineRendererInternal = ({
  lineNumber,
  content,
  tokens,
  decorations,
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

    // Apply decorations and search highlights by wrapping segments in span elements
    const segments: React.ReactNode[] = [];
    let lastIndex = 0;

    // Combine decorations and search highlights into a sorted array of ranges
    const allRanges = [
      ...inlineDecorations.map((d) => ({
        start: d.range.start.column,
        end: d.range.end.column,
        className: d.className || "",
        type: "decoration" as const,
      })),
      ...searchHighlight.map((h) => ({
        start: h.start,
        end: h.end,
        className: "search-highlight",
        type: "search" as const,
      })),
    ].sort((a, b) => a.start - b.start);

    // Split content into segments with appropriate classes
    allRanges.forEach((range, index) => {
      // Add text before this range
      if (range.start > lastIndex) {
        segments.push(<span key={`text-${index}`}>{content.slice(lastIndex, range.start)}</span>);
      }

      // Add the highlighted range
      segments.push(
        <span key={`${range.type}-${index}`} className={range.className}>
          {content.slice(range.start, range.end)}
        </span>,
      );

      lastIndex = range.end;
    });

    // Add remaining text
    if (lastIndex < content.length) {
      segments.push(<span key="text-end">{content.slice(lastIndex)}</span>);
    }

    return <>{segments}</>;
  };

  return (
    <div className="editor-line" data-line-number={lineNumber}>
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
    prevProps.tokens.length === nextProps.tokens.length &&
    prevProps.decorations.length === nextProps.decorations.length &&
    (prevProps.searchHighlight?.length || 0) === (nextProps.searchHighlight?.length || 0)
  );
});
