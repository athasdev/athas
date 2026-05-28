import type { Diagnostic } from "@/features/diagnostics/types/diagnostics";

export interface DiagnosticDecoration {
  diagnostic: Diagnostic;
  line: number;
  startColumn: number;
  endColumn: number;
  severity: Diagnostic["severity"];
}

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function isWordCharacter(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_$]/u.test(char);
}

function expandEmptyRange(
  lineText: string,
  column: number,
): { startColumn: number; endColumn: number } {
  if (lineText.length === 0) {
    return { startColumn: 0, endColumn: 1 };
  }

  const anchor = clamp(column, 0, lineText.length);
  let startColumn = anchor;
  let endColumn = anchor;

  while (startColumn > 0 && isWordCharacter(lineText[startColumn - 1])) {
    startColumn--;
  }
  while (endColumn < lineText.length && isWordCharacter(lineText[endColumn])) {
    endColumn++;
  }

  if (startColumn !== endColumn) {
    return { startColumn, endColumn };
  }

  return {
    startColumn: clamp(anchor, 0, lineText.length),
    endColumn: clamp(anchor + 1, 1, Math.max(1, lineText.length)),
  };
}

function toVisualLine(line: number, lineMapping?: LineMapping): number | null {
  if (!lineMapping) return line;
  const visualLine = lineMapping.actualToVirtual.get(line);
  if (visualLine === undefined) return null;
  return lineMapping.virtualToActual.get(visualLine) === line ? visualLine : null;
}

export function formatDiagnosticMessage(diagnostic: Diagnostic): string {
  return [
    diagnostic.message,
    diagnostic.source ? `Source: ${diagnostic.source}` : "",
    diagnostic.code ? `Code: ${diagnostic.code}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildDiagnosticDecorations(
  diagnostics: Diagnostic[],
  lines: string[],
  lineMapping?: LineMapping,
): DiagnosticDecoration[] {
  const decorations: DiagnosticDecoration[] = [];

  for (const diagnostic of diagnostics) {
    const visualStartLine = toVisualLine(diagnostic.line, lineMapping);
    const visualEndLine = toVisualLine(diagnostic.endLine, lineMapping);
    if (visualStartLine === null || visualEndLine === null) continue;

    const startLine = clamp(visualStartLine, 0, Math.max(0, lines.length - 1));
    const endLine = clamp(Math.max(visualStartLine, visualEndLine), startLine, lines.length - 1);

    for (let line = startLine; line <= endLine; line++) {
      const lineText = lines[line] ?? "";
      const isFirstLine = line === startLine;
      const isLastLine = line === endLine;
      let startColumn = isFirstLine ? diagnostic.column : 0;
      let endColumn = isLastLine ? diagnostic.endColumn : lineText.length;

      startColumn = clamp(startColumn, 0, lineText.length);
      endColumn = clamp(endColumn, 0, lineText.length);

      if (endColumn <= startColumn) {
        const expanded = expandEmptyRange(lineText, startColumn);
        startColumn = expanded.startColumn;
        endColumn = expanded.endColumn;
      }

      decorations.push({
        diagnostic,
        line,
        startColumn,
        endColumn,
        severity: diagnostic.severity,
      });
    }
  }

  return decorations;
}

export function getDiagnosticDecorationsForLine(
  decorations: DiagnosticDecoration[],
  line: number,
): DiagnosticDecoration[] {
  return decorations
    .filter((decoration) => decoration.line === line)
    .sort(
      (a, b) =>
        a.startColumn - b.startColumn ||
        b.endColumn - a.endColumn ||
        severityRank(b.severity) - severityRank(a.severity),
    );
}

export function buildDiagnosticDecorationsByLine(
  decorations: DiagnosticDecoration[],
): Map<number, DiagnosticDecoration[]> {
  const byLine = new Map<number, DiagnosticDecoration[]>();

  for (const decoration of decorations) {
    const lineDecorations = byLine.get(decoration.line);
    if (lineDecorations) {
      lineDecorations.push(decoration);
    } else {
      byLine.set(decoration.line, [decoration]);
    }
  }

  for (const lineDecorations of byLine.values()) {
    lineDecorations.sort(
      (a, b) =>
        a.startColumn - b.startColumn ||
        b.endColumn - a.endColumn ||
        severityRank(b.severity) - severityRank(a.severity),
    );
  }

  return byLine;
}

export function getDiagnosticAtPosition(
  diagnostics: Diagnostic[],
  lines: string[],
  line: number,
  column: number,
): Diagnostic | null {
  const decorations = buildDiagnosticDecorations(diagnostics, lines);
  const candidates = decorations
    .filter(
      (decoration) =>
        decoration.line === line &&
        column >= decoration.startColumn &&
        column <= decoration.endColumn,
    )
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        a.endColumn - a.startColumn - (b.endColumn - b.startColumn),
    );

  return candidates[0]?.diagnostic ?? null;
}

function severityRank(severity: Diagnostic["severity"]): number {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}
