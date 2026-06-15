import type { Token } from "@/features/editor/utils/html";

export interface MinimapRenderMetrics {
  renderScale: number;
  renderHeight: number;
  viewportTop: number;
  viewportHeight: number;
}

export interface MinimapSearchMark {
  top: number;
  active: boolean;
}

export interface MinimapHorizontalMetrics {
  charWidth: number;
  contentWidth: number;
}

export function getLineIndexAtOffset(lineStarts: number[], offset: number): number {
  if (lineStarts.length === 0) return 0;

  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    const nextLineStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = mid - 1;
    } else if (offset >= nextLineStart) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(low, lineStarts.length - 1));
}

export function bucketTokensByLine(
  tokens: Token[],
  lineStarts: number[],
  lines: string[],
): Map<number, Token[]> {
  const tokensByLine = new Map<number, Token[]>();
  if (tokens.length === 0 || lineStarts.length === 0) return tokensByLine;

  for (const token of tokens) {
    const startLine = getLineIndexAtOffset(lineStarts, Math.max(0, token.start));
    const endLine = getLineIndexAtOffset(lineStarts, Math.max(token.start, token.end - 1));

    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
      const lineStart = lineStarts[lineIndex] ?? 0;
      const lineEnd = lineStart + (lines[lineIndex]?.length ?? 0);
      if (token.start < lineEnd && token.end > lineStart) {
        const lineTokens = tokensByLine.get(lineIndex) ?? [];
        lineTokens.push(token);
        tokensByLine.set(lineIndex, lineTokens);
      }
    }
  }

  return tokensByLine;
}

export function getMinimapHorizontalMetrics({
  lines,
  width,
  horizontalPadding = 3,
  minCharWidth = 0.45,
  maxCharWidth = 1.35,
}: {
  lines: string[];
  width: number;
  horizontalPadding?: number;
  minCharWidth?: number;
  maxCharWidth?: number;
}): MinimapHorizontalMetrics {
  const contentWidth = Math.max(1, width - horizontalPadding * 2);
  let maxLineLength = 1;
  for (const line of lines) {
    if (line.length > maxLineLength) {
      maxLineLength = line.length;
    }
  }
  const charWidth = Math.max(minCharWidth, Math.min(maxCharWidth, contentWidth / maxLineLength));

  return {
    charWidth,
    contentWidth,
  };
}

export function getMinimapRenderMetrics({
  preferredScale,
  totalHeight,
  viewportHeight,
  scrollTop,
  containerHeight,
  minViewportHeight = 20,
}: {
  preferredScale: number;
  totalHeight: number;
  viewportHeight: number;
  scrollTop: number;
  containerHeight: number;
  minViewportHeight?: number;
}): MinimapRenderMetrics {
  const safeTotalHeight = Math.max(1, totalHeight);
  const preferredHeight = safeTotalHeight * preferredScale;
  const availableHeight = Math.max(1, containerHeight || preferredHeight);
  const renderScale =
    preferredHeight > availableHeight ? availableHeight / safeTotalHeight : preferredScale;
  const renderHeight = Math.max(1, Math.min(preferredHeight, availableHeight));
  const scaledViewportHeight = viewportHeight * renderScale;
  const viewportIndicatorHeight = Math.min(
    renderHeight,
    Math.max(minViewportHeight, scaledViewportHeight),
  );
  const maxViewportTop = Math.max(0, renderHeight - viewportIndicatorHeight);
  const viewportTop = Math.max(0, Math.min(scrollTop * renderScale, maxViewportTop));

  return {
    renderScale,
    renderHeight,
    viewportTop,
    viewportHeight: viewportIndicatorHeight,
  };
}

export function getScrollTopFromMinimapY({
  y,
  renderScale,
  viewportHeight,
  totalHeight,
}: {
  y: number;
  renderScale: number;
  viewportHeight: number;
  totalHeight: number;
}): number {
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const targetY = y / Math.max(renderScale, Number.EPSILON) - viewportHeight / 2;
  return Math.max(0, Math.min(targetY, maxScroll));
}

export function buildSearchMarks({
  matches,
  currentMatchIndex,
  lineStarts,
  lineHeight,
  renderScale,
}: {
  matches: Array<{ start: number; end: number }>;
  currentMatchIndex: number;
  lineStarts: number[];
  lineHeight: number;
  renderScale: number;
}): MinimapSearchMark[] {
  return matches.map((match, index) => {
    const lineIndex = getLineIndexAtOffset(lineStarts, match.start);
    return {
      top: lineIndex * lineHeight * renderScale,
      active: index === currentMatchIndex,
    };
  });
}
