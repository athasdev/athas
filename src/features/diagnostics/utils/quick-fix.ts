import type { Diagnostic, DiagnosticCodeAction } from "../types/diagnostics";

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

function diagnosticRangeLength(diagnostic: Diagnostic): number {
  if (diagnostic.line !== diagnostic.endLine) {
    return (diagnostic.endLine - diagnostic.line) * 10_000 + diagnostic.endColumn;
  }

  return Math.max(0, diagnostic.endColumn - diagnostic.column);
}

function diagnosticContainsPosition(diagnostic: Diagnostic, line: number, column: number): boolean {
  if (line < diagnostic.line || line > diagnostic.endLine) return false;
  if (line === diagnostic.line && column < diagnostic.column) return false;
  if (line === diagnostic.endLine && column > diagnostic.endColumn) return false;
  return true;
}

function diagnosticLineDistance(diagnostic: Diagnostic, line: number, column: number): number {
  if (line < diagnostic.line) return (diagnostic.line - line) * 10_000 + diagnostic.column;
  if (line > diagnostic.endLine) return (line - diagnostic.endLine) * 10_000 + diagnostic.endColumn;

  if (line === diagnostic.line && column < diagnostic.column) return diagnostic.column - column;
  if (line === diagnostic.endLine && column > diagnostic.endColumn) {
    return column - diagnostic.endColumn;
  }

  return 0;
}

function compareDiagnosticsForQuickFix(
  cursorLine: number,
  cursorColumn: number,
  left: Diagnostic,
  right: Diagnostic,
): number {
  const leftContains = diagnosticContainsPosition(left, cursorLine, cursorColumn);
  const rightContains = diagnosticContainsPosition(right, cursorLine, cursorColumn);
  if (leftContains !== rightContains) return leftContains ? -1 : 1;

  const leftDistance = diagnosticLineDistance(left, cursorLine, cursorColumn);
  const rightDistance = diagnosticLineDistance(right, cursorLine, cursorColumn);
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;

  const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
  if (severityDelta !== 0) return severityDelta;

  return diagnosticRangeLength(left) - diagnosticRangeLength(right);
}

export function selectDiagnosticForQuickFix(
  diagnostics: Diagnostic[],
  cursor: { line: number; column: number },
): Diagnostic | null {
  const sameLineDiagnostics = diagnostics.filter(
    (diagnostic) => cursor.line >= diagnostic.line && cursor.line <= diagnostic.endLine,
  );
  if (sameLineDiagnostics.length === 0) return null;

  return [...sameLineDiagnostics].sort((left, right) =>
    compareDiagnosticsForQuickFix(cursor.line, cursor.column, left, right),
  )[0];
}

export function selectPreferredCodeAction(
  actions: DiagnosticCodeAction[],
): DiagnosticCodeAction | null {
  const enabledActions = actions.filter((action) => !action.disabledReason);
  if (enabledActions.length === 0) return null;

  return (
    enabledActions.find((action) => action.isPreferred) ??
    enabledActions.find((action) => action.kind?.includes("quickfix")) ??
    enabledActions[0]
  );
}
