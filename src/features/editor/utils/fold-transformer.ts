import type { FoldRegion } from "../stores/fold.store";
import type { Token } from "./html";
import { buildLineOffsetMap } from "./html";
import {
  createCollapsedDiffAccordionLine,
  parseDiffAccordionLine,
} from "@/features/git/utils/diff-editor-content";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
  foldedRanges: Array<{ start: number; end: number; virtualLine: number }>;
}

interface TransformResult {
  virtualContent: string;
  virtualLines: string[];
  mapping: LineMapping;
  foldMarkers: Map<number, number>;
}

function createCollapsedLinePreview(lineContent: string, kind?: FoldRegion["kind"]): string {
  if (kind === "diff-file") {
    const meta = parseDiffAccordionLine(lineContent);
    if (meta) {
      return createCollapsedDiffAccordionLine(meta);
    }
  }

  return lineContent;
}

export function transformContentForFolding(
  actualContent: string,
  collapsedLines: Set<number>,
  foldRegions: FoldRegion[],
  actualLinesOverride?: readonly string[],
): TransformResult {
  const actualLines = actualLinesOverride ?? actualContent.split("\n");
  const virtualLines: string[] = [];
  const actualToVirtual = new Map<number, number>();
  const virtualToActual = new Map<number, number>();
  const foldedRanges: Array<{ start: number; end: number; virtualLine: number }> = [];
  const foldMarkers = new Map<number, number>();

  const hiddenLines = new Set<number>();
  const collapsedRegions = new Map<number, FoldRegion>();

  for (const region of foldRegions) {
    if (collapsedLines.has(region.startLine)) {
      collapsedRegions.set(region.startLine, region);
      for (let i = region.startLine + 1; i <= region.endLine; i++) {
        hiddenLines.add(i);
      }
    }
  }

  let virtualLineIndex = 0;

  for (let actualLine = 0; actualLine < actualLines.length; actualLine++) {
    if (hiddenLines.has(actualLine)) {
      actualToVirtual.set(actualLine, virtualLineIndex - 1);
      continue;
    }

    const collapsedRegion = collapsedRegions.get(actualLine);

    if (collapsedRegion) {
      const lineContent = actualLines[actualLine];
      const hiddenCount = collapsedRegion.endLine - collapsedRegion.startLine;
      virtualLines.push(createCollapsedLinePreview(lineContent, collapsedRegion.kind));

      foldMarkers.set(virtualLineIndex, hiddenCount);
      foldedRanges.push({
        start: collapsedRegion.startLine,
        end: collapsedRegion.endLine,
        virtualLine: virtualLineIndex,
      });
    } else {
      virtualLines.push(actualLines[actualLine]);
    }

    actualToVirtual.set(actualLine, virtualLineIndex);
    virtualToActual.set(virtualLineIndex, actualLine);
    virtualLineIndex++;
  }

  return {
    virtualContent: virtualLines.join("\n"),
    virtualLines,
    mapping: {
      actualToVirtual,
      virtualToActual,
      foldedRanges,
    },
    foldMarkers,
  };
}

/**
 * Check if an actual line is visible (not hidden in a fold)
 */
function isLineVisible(actualLine: number, mapping: LineMapping): boolean {
  // A line is visible if it maps to a unique virtual line
  // Hidden lines map to the fold start line's virtual index
  const virtualLine = mapping.actualToVirtual.get(actualLine);
  if (virtualLine === undefined) return true;

  // Check if multiple actual lines map to this virtual line
  const actualLineForVirtual = mapping.virtualToActual.get(virtualLine);
  return actualLineForVirtual === actualLine;
}

/**
 * Apply an edit in virtual content space back to actual content
 * This handles the complex case of edits happening in folded regions
 */
export function applyVirtualEdit(
  actualContent: string,
  newVirtualContent: string,
  mapping: LineMapping,
  actualLinesOverride?: readonly string[],
): string {
  const actualLines = actualLinesOverride ?? actualContent.split("\n");
  const newVirtualLines = newVirtualContent.split("\n");
  const newActualLines: string[] = [];

  let virtualLineIndex = 0;
  let actualLineIndex = 0;

  while (actualLineIndex < actualLines.length) {
    const isVisible = isLineVisible(actualLineIndex, mapping);

    if (!isVisible) {
      // This line is hidden, keep it as-is
      newActualLines.push(actualLines[actualLineIndex]);
      actualLineIndex++;
      continue;
    }

    // This line is visible, use the new virtual content
    if (virtualLineIndex < newVirtualLines.length) {
      newActualLines.push(newVirtualLines[virtualLineIndex]);
      virtualLineIndex++;
    }
    actualLineIndex++;
  }

  // Handle case where new content has more lines than before
  while (virtualLineIndex < newVirtualLines.length) {
    newActualLines.push(newVirtualLines[virtualLineIndex]);
    virtualLineIndex++;
  }

  return newActualLines.join("\n");
}

function getLineLengthFromOffsets(
  content: string,
  lineOffsets: readonly number[],
  line: number,
): number {
  const lineStart = lineOffsets[line];
  if (lineStart === undefined) return 0;

  const nextLineStart = lineOffsets[line + 1] ?? content.length;
  let lineEnd = Math.max(lineStart, nextLineStart);

  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 10) lineEnd--;
  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) lineEnd--;

  return lineEnd - lineStart;
}

/**
 * Remap tokens from actual content offsets into folded virtual content offsets.
 * This avoids re-tokenizing on fold toggle and keeps syntax highlighting stable.
 */
export function transformTokensForFolding(
  actualContent: string,
  virtualLines: string[],
  mapping: LineMapping,
  tokens: Token[],
): Token[] {
  if (tokens.length === 0) return [];

  const actualLineOffsets = buildLineOffsetMap(actualContent);
  const virtualContent = virtualLines.join("\n");
  const virtualLineOffsets = buildLineOffsetMap(virtualContent);
  const transformed: Token[] = [];
  let tokenIndex = 0;

  for (let virtualLine = 0; virtualLine < virtualLines.length; virtualLine++) {
    const actualLine = mapping.virtualToActual.get(virtualLine);
    if (actualLine === undefined) continue;

    const actualLineStart = actualLineOffsets[actualLine] ?? 0;
    const actualLineLength = getLineLengthFromOffsets(actualContent, actualLineOffsets, actualLine);
    const actualLineEnd = actualLineStart + actualLineLength;
    const virtualLineContent = virtualLines[virtualLine] ?? "";
    const virtualLineStart = virtualLineOffsets[virtualLine] ?? 0;
    const maxVirtualContentLength = Math.min(virtualLineContent.length, actualLineLength);

    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= actualLineStart) {
      tokenIndex++;
    }

    let currentTokenIndex = tokenIndex;
    while (currentTokenIndex < tokens.length) {
      const token = tokens[currentTokenIndex];
      if (token.start >= actualLineEnd) break;

      const startInLine = Math.max(0, token.start - actualLineStart);
      const endInLine = Math.min(actualLineLength, token.end - actualLineStart);
      const clampedEndInVirtual = Math.min(endInLine, maxVirtualContentLength);

      if (startInLine >= clampedEndInVirtual) {
        currentTokenIndex++;
        continue;
      }

      transformed.push({
        start: virtualLineStart + startInLine,
        end: virtualLineStart + clampedEndInVirtual,
        class_name: token.class_name,
      });

      currentTokenIndex++;
    }
  }

  return transformed;
}
