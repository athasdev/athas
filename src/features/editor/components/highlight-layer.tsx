/**
 * Highlight Layer - Syntax-highlighted background
 * Read-only, updated via React (no innerHTML manipulation)
 * Optimized with per-line memoization for better performance
 */

import { forwardRef, memo, type ReactNode, useMemo } from "react";
import { buildLineOffsetMap, type Token } from "../utils/html";

interface HighlightLayerProps {
  content: string;
  tokens: Token[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
}

interface LineProps {
  lineContent: string;
  tokens: Token[];
  lineStart: number;
  lineIndex: number;
}

/**
 * Render a single line with syntax highlighting as React elements
 * Memoized to avoid re-rendering unchanged lines
 */
const Line = memo<LineProps>(
  ({ lineContent, tokens, lineStart, lineIndex }) => {
    const spans = useMemo((): ReactNode[] => {
      if (tokens.length === 0) {
        return [];
      }

      const result: ReactNode[] = [];
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
          result.push(<span key={`${lineIndex}-${spanKey++}`}>{text}</span>);
        }

        // Add token
        const start = Math.max(0, tokenStartInLine);
        const end = Math.min(lineContent.length, tokenEndInLine);
        const tokenText = lineContent.substring(start, end);
        result.push(
          <span key={`${lineIndex}-${spanKey++}`} className={token.class_name}>
            {tokenText}
          </span>,
        );

        lastIndex = end;
      }

      // Add remaining text
      if (lastIndex < lineContent.length) {
        const text = lineContent.substring(lastIndex);
        result.push(<span key={`${lineIndex}-${spanKey++}`}>{text}</span>);
      }

      return result;
    }, [lineContent, tokens, lineStart, lineIndex]);

    return (
      <div className="highlight-layer-line">
        {spans.length > 0 ? spans : lineContent || "\u00A0"}
      </div>
    );
  },
  (prev, next) => {
    // Only re-render if line content or tokens changed
    return (
      prev.lineContent === next.lineContent &&
      prev.lineStart === next.lineStart &&
      prev.tokens === next.tokens
    );
  },
);

Line.displayName = "HighlightLayerLine";

const HighlightLayerComponent = forwardRef<HTMLDivElement, HighlightLayerProps>(
  ({ content, tokens, fontSize, fontFamily, lineHeight }, ref) => {
    const lines = useMemo(() => content.split("\n"), [content]);

    // Pre-sort tokens once
    const sortedTokens = useMemo(() => [...tokens].sort((a, b) => a.start - b.start), [tokens]);

    // Build a map of line index to line-specific tokens
    // This avoids passing all tokens to every line
    // Use cached line offset map for O(1) lookups
    const lineTokensMap = useMemo(() => {
      const lineOffsets = buildLineOffsetMap(content);
      const map = new Map<number, Token[]>();
      let tokenIndex = 0;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const offset = lineOffsets[lineIndex];
        const lineLength = lines[lineIndex].length;
        const lineEnd = offset + lineLength;
        const lineTokens: Token[] = [];

        // Collect tokens that overlap with this line
        while (tokenIndex < sortedTokens.length && sortedTokens[tokenIndex].start < lineEnd) {
          const token = sortedTokens[tokenIndex];
          if (token.end > offset) {
            lineTokens.push(token);
          }
          tokenIndex++;
        }

        // Reset tokenIndex for next line if we went past
        if (lineTokens.length > 0) {
          // Find where to start for next line
          while (tokenIndex > 0 && sortedTokens[tokenIndex - 1].end > lineEnd) {
            tokenIndex--;
          }
        }

        map.set(lineIndex, lineTokens);
      }

      return map;
    }, [lines, sortedTokens, content]);

    // Render lines with their specific tokens
    // Use cached line offset map for O(1) lookups
    const renderedLines = useMemo(() => {
      const lineOffsets = buildLineOffsetMap(content);
      return lines.map((line, i) => {
        const lineTokens = lineTokensMap.get(i) || [];
        const lineStart = lineOffsets[i];

        return (
          <Line
            key={i}
            lineContent={line}
            tokens={lineTokens}
            lineStart={lineStart}
            lineIndex={i}
          />
        );
      });
    }, [lines, lineTokensMap, content]);

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

// Wrap with memo to prevent unnecessary re-renders during typing
export const HighlightLayer = memo(HighlightLayerComponent, (prev, next) => {
  // Return true to SKIP re-render when props haven't changed meaningfully

  // Always re-render if content changed significantly (different number of lines)
  // This ensures proper sync when switching buffers or opening new files
  const prevLineCount = prev.content.split("\n").length;
  const nextLineCount = next.content.split("\n").length;
  if (prevLineCount !== nextLineCount) {
    return false; // Force re-render
  }

  // Always re-render if content length changed significantly (>10% difference)
  // This catches major edits like paste, cut, or buffer switches
  const prevLength = prev.content.length;
  const nextLength = next.content.length;
  const lengthDiff = Math.abs(nextLength - prevLength);
  const lengthChangePercent = prevLength > 0 ? lengthDiff / prevLength : lengthDiff > 0 ? 1 : 0;
  if (lengthChangePercent > 0.1) {
    return false; // Force re-render
  }

  // Check if tokens actually changed (with safe null/undefined handling)
  if (!prev.tokens || !next.tokens) {
    // If either is null/undefined, only skip if both are
    return (
      !prev.tokens &&
      !next.tokens &&
      prev.fontSize === next.fontSize &&
      prev.fontFamily === next.fontFamily &&
      prev.lineHeight === next.lineHeight
    );
  }

  // Both tokens arrays exist
  const tokensUnchanged =
    prev.tokens === next.tokens || // Same reference (fast path)
    (prev.tokens.length === next.tokens.length &&
      (prev.tokens.length === 0 || // Both empty
        (prev.tokens[0]?.start === next.tokens[0]?.start &&
          prev.tokens[prev.tokens.length - 1]?.end === next.tokens[prev.tokens.length - 1]?.end)));

  // Always re-render when content changes to show text immediately
  // Tokens can be stale temporarily - that's fine, text must be visible
  const shouldSkipRender =
    prev.content === next.content &&
    tokensUnchanged &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight;

  return shouldSkipRender;
});
