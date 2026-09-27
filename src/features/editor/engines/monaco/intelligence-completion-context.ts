import type * as Monaco from "monaco-editor";
import type {
  AutocompleteDiagnostic,
  AutocompleteRecentEdit,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import { filePathFromAthasModelUri } from "./model-uri";

const MAX_RECENT_EDITS = 5;
const MAX_SNIPPET_CHARS = 400;
const SNIPPET_CONTEXT_LINES = 1;
const MAX_DIAGNOSTICS = 5;
const DIAGNOSTIC_LINE_WINDOW = 20;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 300;

// Marker severities from monaco-editor's MarkerSeverity enum.
const SEVERITY_NAMES: Record<number, AutocompleteDiagnostic["severity"]> = {
  8: "error",
  4: "warning",
  2: "info",
  1: "hint",
};

export const SENSITIVE_FILE_PATTERN =
  /(?:^|[/\\])(?:\.env(?:\..*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i;

interface RecentEditEntry extends AutocompleteRecentEdit {
  line: number;
}

const recentEdits: RecentEditEntry[] = [];

export function isAthasEditorModel(model: Monaco.editor.ITextModel) {
  return model.uri.scheme === "athas" && model.uri.authority === "editor";
}

export function getModelFilePath(model: Monaco.editor.ITextModel) {
  return filePathFromAthasModelUri(model.uri.path, model.uri.query);
}

/** Records the lines touched by a content change as a short snippet for completion context. */
export function recordRecentEdit(
  model: Monaco.editor.ITextModel,
  changes: readonly Pick<Monaco.editor.IModelContentChange, "range" | "text">[],
) {
  if (!isAthasEditorModel(model) || model.isDisposed() || changes.length === 0) return;
  const filePath = getModelFilePath(model);
  if (SENSITIVE_FILE_PATTERN.test(filePath)) return;

  const change = changes[changes.length - 1];
  const insertedLines = change.text.split(/\r?\n/).length - 1;
  const lineCount = model.getLineCount();
  const startLine = Math.max(1, change.range.startLineNumber - SNIPPET_CONTEXT_LINES);
  const endLine = Math.min(
    lineCount,
    change.range.startLineNumber + insertedLines + SNIPPET_CONTEXT_LINES,
  );
  const snippet = model
    .getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    })
    .slice(0, MAX_SNIPPET_CHARS);
  if (!snippet.trim()) return;

  const line = change.range.startLineNumber;
  const last = recentEdits[recentEdits.length - 1];
  if (last && last.filePath === filePath && Math.abs(last.line - line) <= 2) {
    recentEdits.pop();
  }
  recentEdits.push({ filePath, snippet, line });
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

export function getNearbyDiagnostics(
  markers: readonly Pick<Monaco.editor.IMarker, "severity" | "message" | "startLineNumber">[],
  line: number,
): AutocompleteDiagnostic[] {
  return markers
    .filter(
      (marker) =>
        marker.severity >= 4 && Math.abs(marker.startLineNumber - line) <= DIAGNOSTIC_LINE_WINDOW,
    )
    .sort(
      (a, b) =>
        Math.abs(a.startLineNumber - line) - Math.abs(b.startLineNumber - line) ||
        b.severity - a.severity,
    )
    .slice(0, MAX_DIAGNOSTICS)
    .map((marker) => ({
      line: marker.startLineNumber,
      severity: SEVERITY_NAMES[marker.severity] ?? "info",
      message: marker.message.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS),
    }));
}
