import { forwardRef, memo, type ReactNode, useMemo } from "react";
import { ChevronDown, ChevronRight, FileJson2, FileText } from "lucide-react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../../utils/html";

interface HighlightLayerProps {
  content: string;
  tokens: Token[];
  foldMarkers?: Map<number, number>;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  wordWrap?: boolean;
  viewportRange?: { startLine: number; endLine: number };
}

interface LineProps {
  lineContent: string;
  tokens: Token[];
  foldedCount?: number;
  lineStart: number;
  lineIndex: number;
}

const Line = memo<LineProps>(
  ({ lineContent, tokens, foldedCount, lineStart, lineIndex }) => {
    const accordionMeta = useMemo(() => parseDiffAccordionLine(lineContent), [lineContent]);

    const spans = useMemo((): ReactNode[] => {
      if (accordionMeta) {
        return [];
      }

      if (tokens.length === 0) {
        return [];
      }

      const result: ReactNode[] = [];
      let lastIndex = 0;
      let spanKey = 0;
      let lastTokenClass: string | undefined;

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

        // Add text before token - use last token's class to avoid flash
        if (tokenStartInLine > lastIndex) {
          const text = lineContent.substring(lastIndex, Math.max(lastIndex, tokenStartInLine));
          result.push(
            <span key={`${lineIndex}-${spanKey++}`} className={lastTokenClass}>
              {text}
            </span>,
          );
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
        lastTokenClass = token.class_name;
      }

      // Add remaining text - use the last token's class to avoid white flash
      // This handles the case where content is added but tokens haven't updated yet
      if (lastIndex < lineContent.length) {
        const text = lineContent.substring(lastIndex);
        result.push(
          <span key={`${lineIndex}-${spanKey++}`} className={lastTokenClass}>
            {text}
          </span>,
        );
      }

      return result;
    }, [lineContent, tokens, lineStart, lineIndex]);

    if (accordionMeta) {
      const Icon = accordionMeta.name.endsWith(".json") ? FileJson2 : FileText;

      return (
        <div className="diff-accordion-line">
          <div className="diff-accordion-card">
            <span className="diff-accordion-chevron">
              {accordionMeta.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span className="diff-accordion-icon">
              <Icon size={16} />
            </span>
            <span className="diff-accordion-name">{accordionMeta.name}</span>
            <span className="diff-accordion-path">{accordionMeta.path}</span>
            {accordionMeta.hiddenCount ? (
              <span className="diff-accordion-count">{accordionMeta.hiddenCount} hidden</span>
            ) : null}
          </div>
        </div>
      );
    }

    if (foldedCount) {
      return (
        <div className="highlight-layer-line folded-preview-line">
          {lineContent || `${foldedCount} lines hidden`}
        </div>
      );
    }

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
      prev.tokens === next.tokens &&
      prev.foldedCount === next.foldedCount
    );
  },
);

Line.displayName = "HighlightLayerLine";

const HighlightLayerComponent = forwardRef<HTMLDivElement, HighlightLayerProps>(
  (
    {
      content,
      tokens,
      foldMarkers,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize = 2,
      wordWrap = false,
      viewportRange,
    },
    ref,
  ) => {
    // Normalize line endings first to ensure consistent rendering with textarea
    const normalizedContent = useMemo(() => normalizeLineEndings(content), [content]);

    const lines = useMemo(() => normalizedContent.split("\n"), [normalizedContent]);

    const sortedTokens = useMemo(() => [...tokens].sort((a, b) => a.start - b.start), [tokens]);

    // Calculate line offsets once when content changes, independent of viewport
    const lineOffsets = useMemo(() => buildLineOffsetMap(normalizedContent), [normalizedContent]);

    const lineTokensMap = useMemo(() => {
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
    }, [lines, sortedTokens, lineOffsets, viewportRange]);

    const renderedLines = useMemo(() => {
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lines.length;

      const result: ReactNode[] = [];

      // Add spacer for lines before viewport
      if (startLine > 0) {
        result.push(
          <div
            key="spacer-top"
            style={{ height: `${startLine * lineHeight}px` }}
            className="highlight-layer-spacer"
          />,
        );
      }

      // Render only visible lines with full content
      for (let i = startLine; i < Math.min(endLine, lines.length); i++) {
        const line = lines[i];
        const lineTokens = lineTokensMap.get(i) || [];
        const lineStart = lineOffsets[i];
        const foldedCount = foldMarkers?.get(i);

        result.push(
          <Line
            key={i}
            lineContent={line}
            tokens={lineTokens}
            foldedCount={foldedCount}
            lineStart={lineStart}
            lineIndex={i}
          />,
        );
      }

      // Add spacer for lines after viewport
      const remainingLines = lines.length - Math.min(endLine, lines.length);
      if (remainingLines > 0) {
        result.push(
          <div
            key="spacer-bottom"
            style={{ height: `${remainingLines * lineHeight}px` }}
            className="highlight-layer-spacer"
          />,
        );
      }

      return result;
    }, [lines, lineTokensMap, lineOffsets, viewportRange, lineHeight, foldMarkers]);

    return (
      <div
        className="highlight-layer"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize: tabSize,
          whiteSpace: wordWrap ? "pre-wrap" : "pre",
          overflowWrap: wordWrap ? "anywhere" : "normal",
          wordBreak: wordWrap ? "break-word" : "normal",
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
      prev.content === next.content &&
      prev.fontSize === next.fontSize &&
      prev.fontFamily === next.fontFamily &&
      prev.lineHeight === next.lineHeight &&
      prev.tabSize === next.tabSize &&
      prev.wordWrap === next.wordWrap
    );
  }

  const tokensUnchanged =
    prev.tokens === next.tokens ||
    (prev.tokens.length === next.tokens.length &&
      (prev.tokens.length === 0 ||
        (prev.tokens[0]?.start === next.tokens[0]?.start &&
          prev.tokens[prev.tokens.length - 1]?.end === next.tokens[prev.tokens.length - 1]?.end)));

  // If only content changed but tokens haven't updated yet, skip the intermediate render.
  // The tokenizer will produce new tokens shortly, triggering a proper re-render then.
  // This prevents the flash of unhighlighted text between keystroke and tokenization.
  if (prev.content !== next.content && tokensUnchanged) {
    return true;
  }

  const shouldSkipRender =
    prev.content === next.content &&
    tokensUnchanged &&
    prev.foldMarkers === next.foldMarkers &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.wordWrap === next.wordWrap;

  return shouldSkipRender;
});
