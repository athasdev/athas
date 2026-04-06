import type { FoldRegion } from "../stores/fold-store";
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

function createCollapsedLinePreview(
  lineContent: string,
  hiddenCount: number,
  kind?: FoldRegion["kind"],
): string {
  if (kind === "diff-file") {
    const meta = parseDiffAccordionLine(lineContent);
    if (meta) {
      return createCollapsedDiffAccordionLine(meta, hiddenCount);
    }
  }

  const suffix =
    kind === "diff-file"
      ? ` ... ${hiddenCount} lines hidden in file`
      : kind === "diff-hunk"
        ? ` ... ${hiddenCount} lines hidden in hunk`
        : ` ... ${hiddenCount} lines hidden`;

  return `${lineContent}${suffix}`;
}

export function transformContentForFolding(
  actualContent: string,
  collapsedLines: Set<number>,
  foldRegions: FoldRegion[],
): TransformResult {
  const actualLines = actualContent.split("\n");
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
      virtualLines.push(createCollapsedLinePreview(lineContent, hiddenCount, collapsedRegion.kind));

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
 * Map a cursor position from virtual content back to actual content
 */
export function mapVirtualToActualPosition(
  virtualOffset: number,
  virtualLines: string[],
  mapping: LineMapping,
): { line: number; column: number; offset: number } {
  // Find which virtual line this offset is on
  let currentOffset = 0;
  let virtualLine = 0;

  for (let i = 0; i < virtualLines.length; i++) {
    const lineLength = virtualLines[i].length + 1; // +1 for newline
    if (currentOffset + lineLength > virtualOffset) {
      virtualLine = i;
      break;
    }
    currentOffset += lineLength;
    if (i === virtualLines.length - 1) {
      virtualLine = i;
    }
  }

  const columnInVirtualLine = virtualOffset - currentOffset;
  const actualLine = mapping.virtualToActual.get(virtualLine) ?? virtualLine;

  return {
    line: actualLine,
    column: columnInVirtualLine,
    offset: virtualOffset, // This will need to be recalculated with actual content
  };
}

/**
 * Map an actual line number to its virtual line number
 * Returns -1 if the line is hidden (inside a fold)
 */
export function mapActualToVirtualLine(actualLine: number, mapping: LineMapping): number {
  const virtualLine = mapping.actualToVirtual.get(actualLine);
  if (virtualLine === undefined) {
    // Line doesn't exist in mapping, return -1
    return -1;
  }
  return virtualLine;
}

/**
 * Check if an actual line is visible (not hidden in a fold)
 */
export function isLineVisible(actualLine: number, mapping: LineMapping): boolean {
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
): string {
  const actualLines = actualContent.split("\n");
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

/**
 * Calculate actual cursor offset from actual line and column
 */
export function calculateActualOffset(actualLines: string[], line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line && i < actualLines.length; i++) {
    offset += actualLines[i].length + 1; // +1 for newline
  }
  offset += Math.min(column, actualLines[line]?.length ?? 0);
  return offset;
}

/**
 * Get the actual line numbers that should be displayed in the gutter
 * Returns an array of actual line numbers for each virtual line
 */
export function getActualLineNumbersForGutter(mapping: LineMapping): number[] {
  const result: number[] = [];
  const sortedVirtualLines = Array.from(mapping.virtualToActual.keys()).sort((a, b) => a - b);

  for (const virtualLine of sortedVirtualLines) {
    const actualLine = mapping.virtualToActual.get(virtualLine);
    if (actualLine !== undefined) {
      result.push(actualLine);
    }
  }

  return result;
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

  const actualLines = actualContent.split("\n");
  const actualLineOffsets = buildLineOffsetMap(actualContent);
  const virtualContent = virtualLines.join("\n");
  const virtualLineOffsets = buildLineOffsetMap(virtualContent);
  const transformed: Token[] = [];
  let tokenIndex = 0;

  for (let virtualLine = 0; virtualLine < virtualLines.length; virtualLine++) {
    const actualLine = mapping.virtualToActual.get(virtualLine);
    if (actualLine === undefined) continue;

    const actualLineContent = actualLines[actualLine] ?? "";
    const actualLineStart = actualLineOffsets[actualLine] ?? 0;
    const actualLineEnd = actualLineStart + actualLineContent.length;
    const virtualLineContent = virtualLines[virtualLine] ?? "";
    const virtualLineStart = virtualLineOffsets[virtualLine] ?? 0;
    const maxVirtualContentLength = Math.min(virtualLineContent.length, actualLineContent.length);

    while (tokenIndex < tokens.length && tokens[tokenIndex].end <= actualLineStart) {
      tokenIndex++;
    }

    let currentTokenIndex = tokenIndex;
    while (currentTokenIndex < tokens.length) {
      const token = tokens[currentTokenIndex];
      if (token.start >= actualLineEnd) break;

      const startInLine = Math.max(0, token.start - actualLineStart);
      const endInLine = Math.min(actualLineContent.length, token.end - actualLineStart);
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
