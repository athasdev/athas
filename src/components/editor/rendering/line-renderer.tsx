import type React from "react";
import type { Decoration, LineToken } from "@/types/editor-types";

interface LineRendererProps {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
  decorations: Decoration[];
  isSelected?: boolean;
  searchHighlight?: { start: number; end: number }[];
}

export const LineRenderer = ({
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

    // TODO: Apply decorations and search highlights
    // For now, just return the base content
    return baseContent;
  };

  return (
    <div className={`editor-line ${isSelected ? "selected" : ""}`} data-line-number={lineNumber}>
      <span className="editor-line-content">{applyDecorations(renderTokenizedContent())}</span>
    </div>
  );
};
