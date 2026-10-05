import type {
  AutocompleteDiagnostic,
  AutocompleteRecentEdit,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";

const MAX_RECENT_EDITS = 5;
const MAX_SNIPPET_CHARS = 400;
const SNIPPET_CONTEXT_LINES = 1;
const MAX_DIAGNOSTICS = 5;
const DIAGNOSTIC_LINE_WINDOW = 20;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 300;

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

export const SENSITIVE_FILE_PATTERN =
  /(?:^|[/\\])(?:\.env(?:\..*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i;

interface RecentEditEntry extends AutocompleteRecentEdit {
  line: number;
}

/** The lines of a document, one-based, as the edit tracker reads them. */
export interface RecentEditDocument {
  lineCount: number;
  lineText(lineNumber: number): string;
}

const recentEdits: RecentEditEntry[] = [];

/**
 * Records the lines around an edit as a short snippet for completion context. `startLine` is the
 * one-based line where the edit starts and `insertedText` is the text it inserted.
 */
export function recordRecentEdit(
  filePath: string,
  document: RecentEditDocument,
  startLine: number,
  insertedText: string,
) {
  if (!filePath || SENSITIVE_FILE_PATTERN.test(filePath)) return;

  const insertedLines = insertedText.split(/\r?\n/).length - 1;
  const firstLine = Math.max(1, startLine - SNIPPET_CONTEXT_LINES);
  const lastLine = Math.min(document.lineCount, startLine + insertedLines + SNIPPET_CONTEXT_LINES);
  const lines: string[] = [];
  for (let line = firstLine; line <= lastLine; line += 1) lines.push(document.lineText(line));
  const snippet = lines.join("\n").slice(0, MAX_SNIPPET_CHARS);
  if (!snippet.trim()) return;

  const last = recentEdits[recentEdits.length - 1];
  if (last && last.filePath === filePath && Math.abs(last.line - startLine) <= 2) {
    recentEdits.pop();
  }
  recentEdits.push({ filePath, snippet, line: startLine });
  if (recentEdits.length > MAX_RECENT_EDITS) recentEdits.shift();
}

/**
 * Recent edits other than the one at the cursor, oldest first. The edit being typed right
 * now is already in the prefix, so sending it again only costs tokens.
 */
export function getRecentEdits(filePath: string, line: number): AutocompleteRecentEdit[] {
  return recentEdits
    .filter((edit) => edit.filePath !== filePath || Math.abs(edit.line - line) > 2)
    .map(({ filePath: path, snippet }) => ({ filePath: path, snippet }));
}

export function clearRecentEdits() {
  recentEdits.length = 0;
}

/** Errors and warnings near a one-based line, closest and most severe first. */
export function getNearbyDiagnostics(
  diagnostics: readonly Pick<Diagnostic, "severity" | "message" | "line">[],
  line: number,
): AutocompleteDiagnostic[] {
  return diagnostics
    .map((diagnostic) => ({ ...diagnostic, line: diagnostic.line + 1 }))
    .filter(
      (diagnostic) =>
        SEVERITY_RANK[diagnostic.severity] >= SEVERITY_RANK.warning &&
        Math.abs(diagnostic.line - line) <= DIAGNOSTIC_LINE_WINDOW,
    )
    .sort(
      (a, b) =>
        Math.abs(a.line - line) - Math.abs(b.line - line) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) => ({
      line: diagnostic.line,
      severity: diagnostic.severity,
      message: diagnostic.message.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS),
    }));
}
