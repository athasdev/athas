/**
 * Highlight Layer - Syntax-highlighted background
 * Read-only, updated via React (no innerHTML manipulation)
 */

import { forwardRef, memo, useMemo } from "react";
import type { Token } from "../utils/html";

interface HighlightLayerProps {
  content: string;
  tokens: Token[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
}

/**
 * Render a single line with syntax highlighting as React elements
 */
function renderLine(lineContent: string, tokens: Token[], lineStart: number, lineIndex: number) {
  if (tokens.length === 0) {
    // No tokens, return plain text or &nbsp; for empty lines
    return (
      <div key={lineIndex} className="highlight-layer-line">
        {lineContent || "\u00A0"}
      </div>
    );
  }

  const spans: React.ReactNode[] = [];
  let lastIndex = 0;
  let spanKey = 0;

  for (const token of tokens) {
    // Calculate token position relative to this line
    const tokenStartInLine = token.start - lineStart;
    const tokenEndInLine = token.end - lineStart;

    // Skip tokens that don't overlap with this line
    if (tokenEndInLine <= 0 || tokenStartInLine >= lineContent.length) {
      continue;
    }

    // Add text before token
    if (tokenStartInLine > lastIndex) {
      const text = lineContent.substring(lastIndex, Math.max(lastIndex, tokenStartInLine));
      spans.push(<span key={`${lineIndex}-${spanKey++}`}>{text}</span>);
    }

    // Add token
    const start = Math.max(0, tokenStartInLine);
    const end = Math.min(lineContent.length, tokenEndInLine);
    const tokenText = lineContent.substring(start, end);
    spans.push(
      <span key={`${lineIndex}-${spanKey++}`} className={token.class_name}>
        {tokenText}
      </span>,
    );

    lastIndex = end;
  }

  // Add remaining text
  if (lastIndex < lineContent.length) {
    const text = lineContent.substring(lastIndex);
    spans.push(<span key={`${lineIndex}-${spanKey++}`}>{text}</span>);
  }

  return (
    <div key={lineIndex} className="highlight-layer-line">
      {spans.length > 0 ? spans : "\u00A0"}
    </div>
  );
}

const HighlightLayerComponent = forwardRef<HTMLDivElement, HighlightLayerProps>(
  ({ content, tokens, fontSize, fontFamily, lineHeight }, ref) => {
    const lines = useMemo(() => content.split("\n"), [content]);
    const sortedTokens = useMemo(() => [...tokens].sort((a, b) => a.start - b.start), [tokens]);

    const renderedLines = useMemo(() => {
      let offset = 0;
      return lines.map((line, i) => {
        const rendered = renderLine(line, sortedTokens, offset, i);
        offset += line.length + 1; // +1 for the \n character
        return rendered;
      });
    }, [lines, sortedTokens]);

    return (
      <div
        ref={ref}
        className="highlight-layer"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
        }}
        aria-hidden="true"
      >
        {renderedLines}
      </div>
    );
  },
);

HighlightLayerComponent.displayName = "HighlightLayer";

// Wrap with memo to prevent unnecessary re-renders
export const HighlightLayer = memo(HighlightLayerComponent, (prev, next) => {
  // Return true to SKIP re-render when props haven't changed meaningfully
  const tokensUnchanged =
    prev.tokens.length === next.tokens.length &&
    (prev.tokens.length === 0 ||
      (prev.tokens[0].start === next.tokens[0].start &&
        prev.tokens[prev.tokens.length - 1].end === next.tokens[prev.tokens.length - 1].end));

  return (
    prev.content === next.content &&
    tokensUnchanged &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight
  );
});
