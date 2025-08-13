import type React from "react";
import { memo, useMemo } from "react";
import type { Decoration, LineToken } from "@/types/editor-types";

interface LineRendererProps {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
  decorations: Decoration[];
  isSelected?: boolean;
  searchHighlight?: { start: number; end: number }[];
}

export const LineRenderer = memo<LineRendererProps>(
  ({ lineNumber, content, tokens, decorations, isSelected = false, searchHighlight = [] }) => {
    // Memoize tokenized content to avoid recalculating on every render
    const tokenizedContent = useMemo(() => {
      if (!tokens || tokens.length === 0) {
        return <span>{content || "\u00A0"}</span>;
      }

      const elements: React.ReactNode[] = [];
      let lastEnd = 0;

      // Pre-sort tokens once and cache
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
    }, [content, tokens]);

    // Memoize decoration application
    const decoratedContent = useMemo(() => {
      const inlineDecorations = decorations.filter(
        (d) => d.type === "inline" && d.range.start.line === lineNumber,
      );

      if (inlineDecorations.length === 0 && searchHighlight.length === 0) {
        return tokenizedContent;
      }

      // TODO: Apply decorations and search highlights
      // For now, just return the base content
      return tokenizedContent;
    }, [tokenizedContent, decorations, searchHighlight, lineNumber]);

    return (
      <div className={`editor-line ${isSelected ? "selected" : ""}`} data-line-number={lineNumber}>
        <span className="editor-line-content">{decoratedContent}</span>
      </div>
    );
  },
);

LineRenderer.displayName = "LineRenderer";
