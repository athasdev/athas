import { forwardRef, memo, type ReactNode, useMemo, useRef } from "react";
import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  FileCodeIcon as FileJson2,
  FileTextIcon as FileText,
} from "@/ui/icons";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import type { InlayHint } from "@/features/editor/lsp/use-inlay-hints";
import type { ResolvedEditorViewZone } from "@/features/editor/view-model/view-layout";
import {
  buildDiagnosticDecorations,
  buildDiagnosticDecorationsByLine,
  type DiagnosticDecoration,
} from "@/features/editor/engines/athas/decorations/diagnostic-decorations";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "@/features/editor/utils/html";
import {
  countLines,
  sliceContentLines,
  sliceContentLinesByOffsets,
} from "@/features/editor/utils/large-file";
import {
  buildTokenOverlapIndex,
  findFirstTokenOverlappingOffset,
} from "@/features/editor/engines/athas/utils/token-layers";
import { splitVisibleWhitespaceSegments } from "@/features/editor/engines/athas/utils/visible-whitespace";
import type { RenderWhitespaceMode } from "@/features/settings/types/settings.types";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
}

interface HighlightLayerProps {
  filePath?: string;
  content: string;
  lines?: string[];
  lineCount?: number;
  lineOffsets?: number[];
  lazyLineSlicing?: boolean;
  tokens: Token[];
  foldMarkers?: Map<number, number>;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  wordWrap?: boolean;
  renderWhitespace?: RenderWhitespaceMode;
  viewportRange?: { startLine: number; endLine: number };
  inlayHints?: InlayHint[];
  lineMapping?: LineMapping;
  viewZones?: ResolvedEditorViewZone[];
}

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];
const EMPTY_DIAGNOSTIC_DECORATIONS: DiagnosticDecoration[] = [];
const EMPTY_INLAY_HINTS: InlayHint[] = [];
const EMPTY_TOKENS: Token[] = [];

interface LineTokensCacheEntry {
  tokens: Token[];
}

function getLineLengthFromOffsets(
  content: string,
  lineOffsets: readonly number[],
  lineIndex: number,
): number {
  const lineStart = lineOffsets[lineIndex] ?? content.length;
  const nextLineStart = lineOffsets[lineIndex + 1] ?? content.length;
  let lineEnd = nextLineStart;

  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 10) lineEnd--;
  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) lineEnd--;

  return Math.max(0, lineEnd - lineStart);
}

interface LineProps {
  lineContent: string;
  tokens: Token[];
  foldedCount?: number;
  lineIndex: number;
  inlayHints?: InlayHint[];
  diagnostics?: DiagnosticDecoration[];
  renderWhitespace?: RenderWhitespaceMode;
}

const Line = memo<LineProps>(
  ({
    lineContent,
    tokens,
    foldedCount,
    lineIndex,
    inlayHints = [],
    diagnostics = [],
    renderWhitespace = "none",
  }) => {
    const accordionMeta = useMemo(() => parseDiffAccordionLine(lineContent), [lineContent]);

    const spans = useMemo((): ReactNode[] => {
      if (accordionMeta) {
        return [];
      }

      const result: ReactNode[] = [];
      let lastIndex = 0;
      let spanKey = 0;
      let lastTokenClass: string | undefined;
      let hintIndex = 0;

      const lineHints = [...inlayHints]
        .map((hint) => ({
          ...hint,
          character: Math.max(0, Math.min(lineContent.length, hint.character)),
        }))
        .sort((a, b) => a.character - b.character || a.label.localeCompare(b.label));

      const appendHint = (hint: InlayHint) => {
        result.push(
          <span
            key={`${lineIndex}-hint-${hint.character}-${spanKey++}`}
            className="inlay-hint font-mono"
          >
            {hint.label}
          </span>,
        );
      };

      const appendHintsThrough = (character: number) => {
        while (hintIndex < lineHints.length && lineHints[hintIndex].character <= character) {
          appendHint(lineHints[hintIndex]);
          hintIndex++;
        }
      };

      const getDiagnosticClassName = (diagnostic: DiagnosticDecoration) => {
        if (diagnostic.severity === "error") return "diagnostic-decoration diagnostic-error";
        if (diagnostic.severity === "warning") return "diagnostic-decoration diagnostic-warning";
        return "diagnostic-decoration diagnostic-info";
      };

      const appendDecoratedText = (start: number, end: number, className: string) => {
        if (end <= start) return;

        const boundaries = new Set([start, end]);
        for (const diagnostic of diagnostics) {
          const overlapStart = Math.max(start, diagnostic.startColumn);
          const overlapEnd = Math.min(end, diagnostic.endColumn);
          if (overlapEnd > overlapStart) {
            boundaries.add(overlapStart);
            boundaries.add(overlapEnd);
          }
        }

        const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
        for (let index = 0; index < sortedBoundaries.length - 1; index++) {
          const segmentStart = sortedBoundaries[index];
          const segmentEnd = sortedBoundaries[index + 1];
          if (segmentEnd <= segmentStart) continue;

          const activeDiagnostic = diagnostics.find(
            (diagnostic) =>
              segmentStart >= diagnostic.startColumn && segmentStart < diagnostic.endColumn,
          );
          const diagnosticClassName = activeDiagnostic
            ? `${className} ${getDiagnosticClassName(activeDiagnostic)}`
            : className;

          const segments = splitVisibleWhitespaceSegments(
            lineContent,
            segmentStart,
            segmentEnd,
            renderWhitespace,
          );

          for (const segment of segments) {
            if (segment.kind) {
              result.push(
                <span
                  key={`${lineIndex}-${spanKey++}`}
                  className={`${diagnosticClassName} editor-visible-whitespace editor-visible-whitespace-${segment.kind}`}
                >
                  {segment.text}
                </span>,
              );
              continue;
            }

            if (segment.text.length > 0) {
              result.push(
                <span key={`${lineIndex}-${spanKey++}`} className={diagnosticClassName}>
                  {segment.text}
                </span>,
              );
            }
          }
        }
      };

      const appendText = (start: number, end: number, className: string) => {
        if (end <= start) return;

        appendHintsThrough(start);

        let cursor = start;
        while (hintIndex < lineHints.length && lineHints[hintIndex].character < end) {
          const hint = lineHints[hintIndex];
          if (hint.character > cursor) {
            appendDecoratedText(cursor, hint.character, className);
          }
          appendHint(hint);
          hintIndex++;
          cursor = hint.character;
        }

        if (cursor < end) {
          appendDecoratedText(cursor, end, className);
        }
      };

      if (lineContent.length === 0 && diagnostics.length > 0) {
        const emptyLineDiagnostic = diagnostics[0];
        if (emptyLineDiagnostic) {
          result.push(
            <span
              key={`${lineIndex}-${spanKey++}`}
              className={`token-text ${getDiagnosticClassName(emptyLineDiagnostic)}`}
            >
              {"\u00A0"}
            </span>,
          );
        }
      }

      if (tokens.length === 0) {
        appendText(0, lineContent.length, "token-text");
        appendHintsThrough(lineContent.length);
        return result;
      }

      for (const token of tokens) {
        const tokenStartInLine = token.start;
        const tokenEndInLine = token.end;

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
          appendText(
            lastIndex,
            Math.max(lastIndex, tokenStartInLine),
            lastTokenClass ?? "token-text",
          );
        }

        // Add token (start from lastIndex if token overlaps with previous)
        const start = Math.max(lastIndex, Math.max(0, tokenStartInLine));
        const end = Math.min(lineContent.length, tokenEndInLine);
        appendText(start, end, token.class_name);

        lastIndex = end;
        lastTokenClass = token.class_name;
      }

      // Add remaining text - use the last token's class to avoid white flash
      // This handles the case where content is added but tokens haven't updated yet
      if (lastIndex < lineContent.length) {
        appendText(lastIndex, lineContent.length, lastTokenClass ?? "token-text");
      }

      appendHintsThrough(lineContent.length);

      return result;
    }, [accordionMeta, lineContent, renderWhitespace, tokens, lineIndex, inlayHints, diagnostics]);

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
          </div>
        </div>
      );
    }

    if (foldedCount) {
      return (
        <div className="highlight-layer-line folded-preview-line token-text">
          {lineContent || "\u00A0"}
        </div>
      );
    }

    return (
      <div className="highlight-layer-line">
        {spans.length > 0 ? spans : <span className="token-text">{lineContent || "\u00A0"}</span>}
      </div>
    );
  },
  (prev, next) => {
    // Only re-render if line content or tokens changed
    return (
      prev.lineContent === next.lineContent &&
      prev.tokens === next.tokens &&
      prev.inlayHints === next.inlayHints &&
      prev.diagnostics === next.diagnostics &&
      prev.foldedCount === next.foldedCount &&
      prev.renderWhitespace === next.renderWhitespace
    );
  },
);

Line.displayName = "HighlightLayerLine";

const HighlightLayerComponent = forwardRef<HTMLDivElement, HighlightLayerProps>(
  (
    {
      content,
      lines: providedLines,
      lineCount: providedLineCount,
      lineOffsets: providedLineOffsets,
      lazyLineSlicing = false,
      tokens,
      foldMarkers,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize = 2,
      wordWrap = false,
      renderWhitespace = "none",
      viewportRange,
      inlayHints = [],
      filePath,
      lineMapping,
      viewZones = [],
    },
    ref,
  ) => {
    const diagnosticsForFile = useDiagnosticsStore((state) =>
      filePath ? (state.diagnosticsByFile.get(filePath) ?? EMPTY_DIAGNOSTICS) : EMPTY_DIAGNOSTICS,
    );
    const hasProvidedLineModel =
      !lazyLineSlicing &&
      providedLines !== undefined &&
      providedLineCount !== undefined &&
      providedLineOffsets !== undefined;
    const normalizedContent = useMemo(
      () => (hasProvidedLineModel ? content : normalizeLineEndings(content)),
      [content, hasProvidedLineModel],
    );

    const lines = useMemo(() => {
      if (providedLines) return providedLines;
      if (lazyLineSlicing) return [];
      return normalizedContent.split("\n");
    }, [lazyLineSlicing, normalizedContent, providedLines]);
    const lineCount =
      providedLineCount ?? (lazyLineSlicing ? countLines(normalizedContent) : lines.length);

    const sortedTokens = useMemo(() => [...tokens].sort((a, b) => a.start - b.start), [tokens]);
    const tokenOverlapIndex = useMemo(() => buildTokenOverlapIndex(sortedTokens), [sortedTokens]);
    const lineTokensCacheRef = useRef<Map<number, LineTokensCacheEntry>>(new Map());

    // Calculate line offsets once when content changes, independent of viewport
    const lineOffsets = useMemo(() => {
      if (providedLineOffsets && providedLineOffsets.length > 0) return providedLineOffsets;
      if (lazyLineSlicing) return [];
      return buildLineOffsetMap(normalizedContent);
    }, [lazyLineSlicing, normalizedContent, providedLineOffsets]);

    const lineTokensMap = useMemo(() => {
      const map = new Map<number, Token[]>();
      const previousCache = lineTokensCacheRef.current;
      const nextCache = new Map<number, LineTokensCacheEntry>();
      let firstCandidateTokenIndex = 0;

      // Only process lines in viewport if viewportRange is provided
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lineCount;

      if (lazyLineSlicing && lineOffsets.length === 0) return map;

      const initialLineOffset = lineOffsets[startLine] ?? 0;
      firstCandidateTokenIndex = findFirstTokenOverlappingOffset(
        tokenOverlapIndex,
        initialLineOffset,
      );

      for (let lineIndex = startLine; lineIndex < Math.min(endLine, lineCount); lineIndex++) {
        const offset = lineOffsets[lineIndex] ?? normalizedContent.length;
        const lineLength = lazyLineSlicing
          ? getLineLengthFromOffsets(normalizedContent, lineOffsets, lineIndex)
          : lines[lineIndex].length;
        const lineEnd = offset + lineLength;
        const lineTokens: Token[] = [];

        // Find first token that might overlap with this line. Keep this pointer moving forward
        // across lines so typing does not repeatedly rescan already-ended tokens.
        while (
          firstCandidateTokenIndex < sortedTokens.length &&
          sortedTokens[firstCandidateTokenIndex].end <= offset
        ) {
          firstCandidateTokenIndex++;
        }

        // Collect tokens that overlap with this line
        let tokenIndex = firstCandidateTokenIndex;
        while (tokenIndex < sortedTokens.length && sortedTokens[tokenIndex].start < lineEnd) {
          const token = sortedTokens[tokenIndex];
          if (token.end > offset) {
            lineTokens.push({
              start: Math.max(0, token.start - offset),
              end: Math.min(lineLength, token.end - offset),
              class_name: token.class_name,
            });
          }
          tokenIndex++;
        }

        if (lineTokens.length > 0) {
          const cached = previousCache.get(lineIndex);
          const canReuseCachedTokens =
            cached?.tokens.length === lineTokens.length &&
            cached.tokens.every((token, index) => {
              const nextToken = lineTokens[index];
              return (
                token.start === nextToken.start &&
                token.end === nextToken.end &&
                token.class_name === nextToken.class_name
              );
            });
          const stableLineTokens = canReuseCachedTokens ? cached.tokens : lineTokens;

          nextCache.set(lineIndex, { tokens: stableLineTokens });
          map.set(lineIndex, stableLineTokens);
        }
      }

      lineTokensCacheRef.current = nextCache;
      return map;
    }, [
      lazyLineSlicing,
      lineCount,
      lines,
      sortedTokens,
      tokenOverlapIndex,
      lineOffsets,
      viewportRange,
    ]);

    const lineHintsMap = useMemo(() => {
      const map = new Map<number, InlayHint[]>();
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lineCount;

      for (const hint of inlayHints) {
        if (hint.line < startLine || hint.line >= endLine) continue;
        const existing = map.get(hint.line) || [];
        existing.push(hint);
        map.set(hint.line, existing);
      }

      return map;
    }, [inlayHints, lineCount, viewportRange]);

    const diagnosticDecorations = useMemo(() => {
      if (!filePath) return [];
      if (diagnosticsForFile.length === 0) return [];
      if (lazyLineSlicing) return [];
      return buildDiagnosticDecorations(diagnosticsForFile, lines, lineMapping);
    }, [diagnosticsForFile, filePath, lazyLineSlicing, lines, lineMapping]);

    const diagnosticDecorationsByLine = useMemo(
      () => buildDiagnosticDecorationsByLine(diagnosticDecorations),
      [diagnosticDecorations],
    );

    const viewZonesByLine = useMemo(() => {
      const byLine = new Map<number, ResolvedEditorViewZone[]>();
      for (const zone of viewZones) {
        const lineZones = byLine.get(zone.afterLine);
        if (lineZones) {
          lineZones.push(zone);
        } else {
          byLine.set(zone.afterLine, [zone]);
        }
      }
      return byLine;
    }, [viewZones]);

    const renderedLines = useMemo(() => {
      const startLine = viewportRange?.startLine ?? 0;
      const endLine = viewportRange?.endLine ?? lineCount;
      const clampedStartLine = Math.max(0, Math.min(startLine, lineCount));
      const clampedEndLine = Math.min(endLine, lineCount);
      const visibleSlice = lazyLineSlicing
        ? providedLineOffsets && providedLineOffsets.length > 0
          ? sliceContentLinesByOffsets(
              normalizedContent,
              providedLineOffsets,
              clampedStartLine,
              clampedEndLine,
            )
          : sliceContentLines(normalizedContent, clampedStartLine, clampedEndLine)
        : null;

      const result: ReactNode[] = [];
      let zonesBeforeStartHeight = 0;
      let zonesAfterEndHeight = 0;
      for (const zone of viewZones) {
        if (zone.afterLine < clampedStartLine) {
          zonesBeforeStartHeight += zone.height;
        } else if (zone.afterLine >= clampedEndLine) {
          zonesAfterEndHeight += zone.height;
        }
      }

      // Add spacer for lines before viewport
      if (clampedStartLine > 0) {
        result.push(
          <div
            key="spacer-top"
            style={{ height: `${clampedStartLine * lineHeight + zonesBeforeStartHeight}px` }}
            className="highlight-layer-spacer"
          />,
        );
      }

      // Render only visible lines with full content
      for (let i = clampedStartLine; i < clampedEndLine; i++) {
        const visibleIndex = i - clampedStartLine;
        const line = visibleSlice ? (visibleSlice.lines[visibleIndex] ?? "") : (lines[i] ?? "");
        const lineTokens = lineTokensMap.get(i) ?? EMPTY_TOKENS;
        const lineHints = lineHintsMap.get(i) ?? EMPTY_INLAY_HINTS;
        const lineDiagnostics = diagnosticDecorationsByLine.get(i) ?? EMPTY_DIAGNOSTIC_DECORATIONS;
        const foldedCount = foldMarkers?.get(i);

        result.push(
          <Line
            key={i}
            lineContent={line}
            tokens={lineTokens}
            inlayHints={lineHints}
            diagnostics={lineDiagnostics}
            foldedCount={foldedCount}
            lineIndex={i}
            renderWhitespace={renderWhitespace}
          />,
        );

        for (const zone of viewZonesByLine.get(i) || []) {
          result.push(
            <div
              key={`zone-${zone.id}`}
              className="highlight-layer-view-zone"
              style={{ height: `${zone.height}px` }}
            />,
          );
        }
      }

      // Add spacer for lines after viewport
      const remainingLines = lineCount - Math.min(endLine, lineCount);
      if (remainingLines > 0) {
        result.push(
          <div
            key="spacer-bottom"
            style={{ height: `${remainingLines * lineHeight + zonesAfterEndHeight}px` }}
            className="highlight-layer-spacer"
          />,
        );
      }

      return result;
    }, [
      diagnosticDecorationsByLine,
      lineCount,
      lazyLineSlicing,
      normalizedContent,
      lines,
      lineTokensMap,
      lineHintsMap,
      lineOffsets,
      providedLineOffsets,
      viewportRange,
      lineHeight,
      foldMarkers,
      renderWhitespace,
      viewZones,
      viewZonesByLine,
    ]);

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
      prev.wordWrap === next.wordWrap &&
      prev.renderWhitespace === next.renderWhitespace
    );
  }

  const shouldSkipRender =
    prev.content === next.content &&
    prev.lines === next.lines &&
    prev.lineCount === next.lineCount &&
    prev.lineOffsets === next.lineOffsets &&
    prev.lazyLineSlicing === next.lazyLineSlicing &&
    prev.tokens === next.tokens &&
    prev.inlayHints === next.inlayHints &&
    prev.filePath === next.filePath &&
    prev.lineMapping === next.lineMapping &&
    prev.viewZones === next.viewZones &&
    prev.foldMarkers === next.foldMarkers &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.wordWrap === next.wordWrap &&
    prev.renderWhitespace === next.renderWhitespace;

  return shouldSkipRender;
});
