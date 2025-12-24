import { forwardRef, memo, type ReactNode, useMemo } from "react";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../../utils/html";

interface HighlightLayerProps {
  content: string;
  tokens: Token[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  viewportRange?: { startLine: number; endLine: number };
}

interface LineProps {
  lineContent: string;
  tokens: Token[];
  lineStart: number;
  lineIndex: number;
}

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

        // Skip tokens that are entirely within already-rendered text (overlapping tokens)
        if (tokenEndInLine <= lastIndex) {
          continue;
        }

        // Add text before token
        if (tokenStartInLine > lastIndex) {
          const text = lineContent.substring(lastIndex, Math.max(lastIndex, tokenStartInLine));
          result.push(<span key={`${lineIndex}-${spanKey++}`}>{text}</span>);
        }

        // Add token (start from lastIndex if token overlaps with previous)
        const start = Math.max(lastIndex, Math.max(0, tokenStartInLine));
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
  ({ content, tokens, fontSize, fontFamily, lineHeight, tabSize = 2, viewportRange }, ref) => {
    // Normalize line endings first to ensure consistent rendering with textarea
    const normalizedContent = useMemo(() => normalizeLineEndings(content), [content]);

    const lines = useMemo(() => normalizedContent.split("\n"), [normalizedContent]);

    const sortedTokens = useMemo(() => [...tokens].sort((a, b) => a.start - b.start), [tokens]);

    const lineTokensMap = useMemo(() => {
      const lineOffsets = buildLineOffsetMap(normalizedContent);
      const map = new Map<number, Token[]>();
      let tokenIndex = 0;

      // Only process lines in viewport if viewportRange is provided
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lines.length;

      for (let lineIndex = startLine; lineIndex < Math.min(endLine, lines.length); lineIndex++) {
        const offset = lineOffsets[lineIndex];
        const lineLength = lines[lineIndex].length;
        const lineEnd = offset + lineLength;
        const lineTokens: Token[] = [];

        // Find first token that might overlap with this line
        while (tokenIndex < sortedTokens.length && sortedTokens[tokenIndex].end <= offset) {
          tokenIndex++;
        }

        // Collect tokens that overlap with this line
        const startTokenIndex = tokenIndex;
        while (tokenIndex < sortedTokens.length && sortedTokens[tokenIndex].start < lineEnd) {
          const token = sortedTokens[tokenIndex];
          if (token.end > offset) {
            lineTokens.push(token);
          }
          tokenIndex++;
        }

        // Reset token index for next line
        tokenIndex = startTokenIndex;

        map.set(lineIndex, lineTokens);
      }

      return map;
    }, [lines, sortedTokens, normalizedContent, viewportRange]);

    const renderedLines = useMemo(() => {
      const lineOffsets = buildLineOffsetMap(normalizedContent);
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lines.length;

      const result: ReactNode[] = [];

      // Add empty divs for lines before viewport (for correct positioning)
      for (let i = 0; i < startLine; i++) {
        result.push(
          <div key={i} className="highlight-layer-line">
            {"\u00A0"}
          </div>,
        );
      }

      // Render only visible lines with full content
      for (let i = startLine; i < Math.min(endLine, lines.length); i++) {
        const line = lines[i];
        const lineTokens = lineTokensMap.get(i) || [];
        const lineStart = lineOffsets[i];

        result.push(
          <Line
            key={i}
            lineContent={line}
            tokens={lineTokens}
            lineStart={lineStart}
            lineIndex={i}
          />,
        );
      }

      // Add empty divs for lines after viewport (for correct positioning)
      for (let i = Math.min(endLine, lines.length); i < lines.length; i++) {
        result.push(
          <div key={i} className="highlight-layer-line">
            {"\u00A0"}
          </div>,
        );
      }

      return result;
    }, [lines, lineTokensMap, normalizedContent, viewportRange]);

    return (
      <div
        className="highlight-layer"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize: tabSize,
        }}
        aria-hidden="true"
      >
        <div ref={ref} className="highlight-layer-content">
          {renderedLines}
        </div>
      </div>
    );
  },
);

HighlightLayerComponent.displayName = "HighlightLayer";

export const HighlightLayer = memo(HighlightLayerComponent, (prev, next) => {
  if (prev.content !== next.content) {
    return false;
  }

  // Check viewport range changes
  const viewportUnchanged =
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine;

  if (!viewportUnchanged) {
    return false;
  }

  if (!prev.tokens || !next.tokens) {
    return (
      !prev.tokens &&
      !next.tokens &&
      prev.fontSize === next.fontSize &&
      prev.fontFamily === next.fontFamily &&
      prev.lineHeight === next.lineHeight &&
      prev.tabSize === next.tabSize
    );
  }

  const tokensUnchanged =
    prev.tokens === next.tokens ||
    (prev.tokens.length === next.tokens.length &&
      (prev.tokens.length === 0 ||
        (prev.tokens[0]?.start === next.tokens[0]?.start &&
          prev.tokens[prev.tokens.length - 1]?.end === next.tokens[prev.tokens.length - 1]?.end)));

  const shouldSkipRender =
    tokensUnchanged &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize;

  return shouldSkipRender;
});
