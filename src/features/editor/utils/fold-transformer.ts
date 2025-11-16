interface FoldRegion {
  startLine: number;
  endLine: number;
}

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
  const collapsedRegions: FoldRegion[] = [];

  for (const region of foldRegions) {
    if (collapsedLines.has(region.startLine)) {
      collapsedRegions.push(region);
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

    const collapsedRegion = collapsedRegions.find((r) => r.startLine === actualLine);

    if (collapsedRegion) {
      const lineContent = actualLines[actualLine];
      const hiddenCount = collapsedRegion.endLine - collapsedRegion.startLine;
      virtualLines.push(lineContent);

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
