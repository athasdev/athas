export interface IndentGuide {
  column: number;
  active: boolean;
}

const MAX_INDENT_GUIDES_PER_LINE = 80;

function nextTabStop(column: number, tabSize: number): number {
  const safeTabSize = Math.max(1, Math.trunc(tabSize));
  const remainder = column % safeTabSize;
  return column + (remainder === 0 ? safeTabSize : safeTabSize - remainder);
}

export function getIndentGuideColumns(line: string, tabSize: number): number[] {
  const safeTabSize = Math.max(1, Math.trunc(tabSize));
  const columns: number[] = [];
  let visualColumn = 0;
  let nextGuideColumn = safeTabSize;

  for (const char of line) {
    if (char === " ") {
      visualColumn++;
    } else if (char === "\t") {
      visualColumn = nextTabStop(visualColumn, safeTabSize);
    } else {
      break;
    }

    while (nextGuideColumn <= visualColumn && columns.length < MAX_INDENT_GUIDES_PER_LINE) {
      columns.push(nextGuideColumn);
      nextGuideColumn += safeTabSize;
    }
  }

  return columns;
}

export function getIndentGuidesForLine(
  line: string,
  tabSize: number,
  activeColumn?: number,
): IndentGuide[] {
  const columns = getIndentGuideColumns(line, tabSize);
  const activeGuideCandidates =
    activeColumn === undefined ? [] : columns.filter((column) => column <= activeColumn);
  const activeGuideColumn = activeGuideCandidates[activeGuideCandidates.length - 1];

  return columns.map((column) => ({
    column,
    active: activeGuideColumn === column,
  }));
}
