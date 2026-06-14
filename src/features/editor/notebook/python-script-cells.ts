export interface PythonScriptCell {
  index: number;
  markerLine: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  title: string;
  code: string;
  setupCode: string;
}

interface PythonCellMarker {
  line: number;
  offset: number;
  endOffset: number;
  title: string;
}

const PYTHON_CELL_MARKER_PATTERN = /^\s*#\s*%%(?:\s*(.*))?$/;

function lineStartOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function lineEndOffset(content: string, lineStart: number): number {
  const newlineIndex = content.indexOf("\n", lineStart);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}

function lineAtOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= offset) {
      line = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return line;
}

function findMarkers(content: string, offsets: number[]): PythonCellMarker[] {
  const markers: PythonCellMarker[] = [];
  const lines = content.split("\n");

  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line].match(PYTHON_CELL_MARKER_PATTERN);
    if (!match) continue;

    const offset = offsets[line] ?? 0;
    markers.push({
      line,
      offset,
      endOffset: lineEndOffset(content, offset),
      title: match[1]?.trim() || `Cell ${markers.length + 1}`,
    });
  }

  return markers;
}

export function getPythonScriptCells(content: string): PythonScriptCell[] {
  const offsets = lineStartOffsets(content);
  const markers = findMarkers(content, offsets);
  if (markers.length === 0) return [];

  const cells: PythonScriptCell[] = [];
  let setupParts: string[] = [];

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarker = markers[index + 1];
    const startOffset = marker.endOffset;
    const endOffset = nextMarker?.offset ?? content.length;
    const code = content.slice(startOffset, endOffset).replace(/\s+$/, "");
    const endLine = lineAtOffset(offsets, Math.max(startOffset, endOffset - 1));

    cells.push({
      index,
      markerLine: marker.line,
      startLine: marker.line + 1,
      endLine,
      startOffset,
      endOffset,
      title: marker.title,
      code,
      setupCode: setupParts.filter((part) => part.trim().length > 0).join("\n"),
    });

    setupParts = [...setupParts, code];
  }

  return cells;
}

export function getPythonScriptCellAtOffset(
  content: string,
  offset: number,
): PythonScriptCell | null {
  const cells = getPythonScriptCells(content);
  return (
    cells.find((cell) => offset >= cell.startOffset && offset <= cell.endOffset) ??
    [...cells].reverse().find((cell) => offset >= cell.startOffset) ??
    null
  );
}
